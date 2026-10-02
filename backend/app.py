from flask import Flask, jsonify, request, Response, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from flask_cors import CORS
from functools import wraps
import json
import os
import queue
import sqlite3
import tempfile
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

app = Flask(__name__)
# Staff sign-in uses Flask's signed session cookie. Set SECRET_KEY in the
# environment for anything other than local development.
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-change-me"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
CORS(app, supports_credentials=True)
DB_PATH = Path(__file__).with_name("restaurant.db")
MENU_PATH = Path(__file__).with_name("menu.json")
menu_lock = threading.Lock()
subscribers = []
# Allowed status changes. Orders can only move forward (or be cancelled before they are ready).
TRANSITIONS = {
    "pending": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"completed"},
    "completed": set(),
    "cancelled": set(),
}
MAX_TABLE = 999
MAX_QUANTITY = 50
HEARTBEAT_SECONDS = 15
TABLE_COUNT = int(os.environ.get("TABLE_COUNT", 12))
# Guests can only order at a table a staff member has opened. Set OPEN_TABLE_FIRST=0
# to let the first order open the table by itself (handy while developing).
OPEN_TABLE_FIRST = os.environ.get("OPEN_TABLE_FIRST", "1") == "1"
PAYMENT_METHODS = {"cash": "Tiền mặt", "transfer": "Chuyển khoản", "card": "Thẻ"}
ROLES = {"kitchen": "Bếp", "cashier": "Thu ngân", "manager": "Quản lý"}
# Demo accounts, created on first run. Change the PINs before any real use.
DEFAULT_STAFF = [("Bếp", "kitchen", "1111"), ("Thu ngân", "cashier", "2222"), ("Quản lý", "manager", "3333")]

# Stable IDs 1–6 preserve existing carts and order history.
MENU = json.loads(MENU_PATH.read_text(encoding="utf-8"))
MENU_BY_ID = {item["id"]: item for item in MENU}
MENU_FIELDS = ("name", "category", "description", "price", "image", "imageSource", "available", "popular")

def save_menu(items):
    """Replace the menu on disk atomically, then refresh the in-memory copy."""
    global MENU, MENU_BY_ID
    handle, temp_name = tempfile.mkstemp(dir=str(MENU_PATH.parent), suffix=".json")
    with os.fdopen(handle, "w", encoding="utf-8") as file:
        json.dump(items, file, ensure_ascii=False, indent=2)
    os.replace(temp_name, MENU_PATH)
    MENU = items
    MENU_BY_ID = {item["id"]: item for item in items}

def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection

def pos_int(value, max_value):
    # type() instead of isinstance(): True/False are ints in Python and must be rejected
    return type(value) is int and 0 < value <= max_value

def init_db():
    with closing(db()) as connection, connection:
        connection.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_number INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                total INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                session_id INTEGER REFERENCES table_sessions(id),
                client_token TEXT
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                menu_item_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                price INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                note TEXT DEFAULT '',
                FOREIGN KEY(order_id) REFERENCES orders(id)
            );
            -- A table session is one seating: every order placed at that table
            -- until the cashier takes payment belongs to the same session.
            CREATE TABLE IF NOT EXISTS table_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_number INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                opened_at TEXT NOT NULL,
                closed_at TEXT,
                payment_method TEXT,
                total INTEGER NOT NULL DEFAULT 0,
                closed_by TEXT,
                opened_by TEXT
            );
            CREATE TABLE IF NOT EXISTS staff (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                pin_hash TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session
                ON table_sessions(table_number) WHERE status = 'open';
            -- Two taps on "Gọi món" send the same token, so only one order is stored.
            CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_token
                ON orders(client_token) WHERE client_token IS NOT NULL;
        """)
        # Older databases created before sessions existed.
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(orders)")}
        if "session_id" not in columns:
            connection.execute("ALTER TABLE orders ADD COLUMN session_id INTEGER")
        if "client_token" not in columns:
            connection.execute("ALTER TABLE orders ADD COLUMN client_token TEXT")
        if "opened_by" not in {row["name"] for row in connection.execute("PRAGMA table_info(table_sessions)")}:
            connection.execute("ALTER TABLE table_sessions ADD COLUMN opened_by TEXT")
        if not connection.execute("SELECT 1 FROM staff LIMIT 1").fetchone():
            connection.executemany(
                "INSERT INTO staff (name, role, pin_hash) VALUES (?, ?, ?)",
                [(name, role, generate_password_hash(pin)) for name, role, pin in DEFAULT_STAFF],
            )

def current_staff():
    staff = session.get("staff")
    return staff if isinstance(staff, dict) and staff.get("role") in ROLES else None

def require_role(*roles):
    """Guard a staff endpoint. No signed-in staff -> 401, wrong role -> 403."""
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            staff = current_staff()
            if not staff:
                return jsonify({"error": "Vui lòng đăng nhập bằng mã PIN."}), 401
            if roles and staff["role"] not in roles:
                return jsonify({"error": "Tài khoản không có quyền thực hiện thao tác này."}), 403
            return view(*args, **kwargs)
        return wrapper
    return decorator

def serialize_order(connection, order_id):
    # The session fields let a guest's phone tell this seating's orders from the
    # ones the previous guests at the same table placed.
    order = connection.execute("""
        SELECT o.*, s.status AS session_status
        FROM orders o LEFT JOIN table_sessions s ON s.id = o.session_id
        WHERE o.id = ?
    """, (order_id,)).fetchone()
    if not order:
        return None
    items = connection.execute("SELECT menu_item_id, name, price, quantity, note FROM order_items WHERE order_id = ?", (order_id,)).fetchall()
    return {"id": order["id"], "tableNumber": order["table_number"], "status": order["status"], "total": order["total"], "createdAt": order["created_at"], "sessionId": order["session_id"], "sessionStatus": order["session_status"], "items": [{**dict(item), "image": MENU_BY_ID.get(item["menu_item_id"], {}).get("image", "")} for item in items]}

def broadcast(event, data):
    message = f"event: {event}\ndata: {json.dumps(data)}\n\n"
    for channel in subscribers.copy():
        channel.put(message)

def find_open_session(connection, table_number):
    row = connection.execute(
        "SELECT id FROM table_sessions WHERE table_number = ? AND status = 'open'", (table_number,)
    ).fetchone()
    return row["id"] if row else None

def start_session(connection, table_number, opened_by):
    existing = find_open_session(connection, table_number)
    if existing:
        return existing
    cursor = connection.execute(
        "INSERT INTO table_sessions (table_number, status, opened_at, opened_by) VALUES (?, 'open', ?, ?)",
        (table_number, datetime.now(timezone.utc).isoformat(), opened_by),
    )
    return cursor.lastrowid

def serialize_session(connection, session_id):
    row = connection.execute("SELECT * FROM table_sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        return None
    order_rows = connection.execute(
        "SELECT id FROM orders WHERE session_id = ? ORDER BY id", (session_id,)
    ).fetchall()
    orders = [serialize_order(connection, order["id"]) for order in order_rows]
    billable = [order for order in orders if order["status"] != "cancelled"]
    # One line per dish across every round the table ordered.
    grouped = {}
    for order in billable:
        for item in order["items"]:
            line = grouped.setdefault(item["menu_item_id"], {
                "menuItemId": item["menu_item_id"], "name": item["name"],
                "price": item["price"], "quantity": 0, "subtotal": 0,
            })
            line["quantity"] += item["quantity"]
            line["subtotal"] += item["price"] * item["quantity"]
    total = sum(line["subtotal"] for line in grouped.values())
    return {
        "id": row["id"], "tableNumber": row["table_number"], "status": row["status"],
        "openedAt": row["opened_at"], "openedBy": row["opened_by"], "closedAt": row["closed_at"],
        "paymentMethod": row["payment_method"], "closedBy": row["closed_by"],
        "total": row["total"] if row["status"] == "closed" else total,
        "orders": orders, "items": list(grouped.values()),
        "pendingCount": sum(1 for order in billable if order["status"] != "completed"),
    }

@app.get("/api/menu")
def get_menu():
    return jsonify(MENU), 200

@app.post("/api/orders")
def create_order():
    payload = request.get_json(silent=True) or {}
    table_number = payload.get("tableNumber")
    requested_items = payload.get("items", [])
    client_token = payload.get("clientToken")
    if client_token is not None and (not isinstance(client_token, str) or not 8 <= len(client_token) <= 64):
        return jsonify({"error": "Mã yêu cầu không hợp lệ."}), 400
    if not pos_int(table_number, MAX_TABLE) or not isinstance(requested_items, list) or not requested_items:
        return jsonify({"error": "Vui lòng chọn bàn hợp lệ và ít nhất một món."}), 400

    normalized, total = [], 0
    for requested in requested_items:
        if not isinstance(requested, dict):
            return jsonify({"error": "Món đã chọn không hợp lệ, đã hết món hoặc có số lượng không hợp lệ."}), 400
        item = MENU_BY_ID.get(requested.get("menuItemId"))
        quantity = requested.get("quantity", 0)
        if not item or not item["available"] or not pos_int(quantity, MAX_QUANTITY):
            return jsonify({"error": "Món đã chọn không hợp lệ, đã hết món hoặc có số lượng không hợp lệ."}), 400
        normalized.append({**item, "quantity": quantity, "note": str(requested.get("note", ""))[:120]})
        total += item["price"] * quantity

    created_at = datetime.now(timezone.utc).isoformat()
    with closing(db()) as connection, connection:
        if client_token:
            # A retry of an order we already stored: hand back the same order.
            existing = connection.execute("SELECT id, table_number FROM orders WHERE client_token = ?", (client_token,)).fetchone()
            if existing and existing["table_number"] != table_number:
                return jsonify({"error": "Mã yêu cầu này đã được dùng cho bàn khác."}), 409
            if existing:
                return jsonify(serialize_order(connection, existing["id"])), 200
        session_id = find_open_session(connection, table_number)
        if not session_id:
            if OPEN_TABLE_FIRST:
                return jsonify({"error": "Bàn chưa được mở. Vui lòng gọi nhân viên để bắt đầu gọi món."}), 409
            session_id = start_session(connection, table_number, None)
        try:
            cursor = connection.execute("INSERT INTO orders (table_number, status, total, created_at, session_id, client_token) VALUES (?, 'pending', ?, ?, ?, ?)", (table_number, total, created_at, session_id, client_token))
        except sqlite3.IntegrityError:
            # The other tap won the race; both taps get that one order.
            existing = connection.execute("SELECT id FROM orders WHERE client_token = ?", (client_token,)).fetchone()
            if existing:
                return jsonify(serialize_order(connection, existing["id"])), 200
            raise
        order_id = cursor.lastrowid
        connection.executemany("INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, note) VALUES (?, ?, ?, ?, ?, ?)", [(order_id, item["id"], item["name"], item["price"], item["quantity"], item["note"]) for item in normalized])
        order = serialize_order(connection, order_id)
        table_state = serialize_session(connection, session_id)
    broadcast("order-created", order)
    broadcast("session-updated", table_state)
    return jsonify(order), 201

MAX_HISTORY_IDS = 50

@app.get("/api/orders")
def get_orders():
    # Customers: /api/orders?ids=3,7,12 returns only the orders placed from their device.
    # Kitchen: /api/orders (no ids) returns every order.
    ids_param = request.args.get("ids")
    if ids_param is None and not current_staff():
        return jsonify({"error": "Vui lòng đăng nhập bằng mã PIN."}), 401
    with closing(db()) as connection:
        if ids_param is None:
            rows = connection.execute("SELECT id FROM orders ORDER BY id DESC").fetchall()
            return jsonify([serialize_order(connection, row["id"]) for row in rows]), 200
        try:
            # SQLite only stores 64-bit integers; anything larger is simply not an id.
            ids = sorted({int(part) for part in ids_param.split(",") if part.strip() and abs(int(part)) < 2**63}, reverse=True)[:MAX_HISTORY_IDS]
        except ValueError:
            return jsonify({"error": "Danh sách mã đơn không hợp lệ."}), 400
        orders = [serialize_order(connection, order_id) for order_id in ids]
    return jsonify([order for order in orders if order]), 200

@app.get("/api/orders/<int:order_id>")
def get_order(order_id):
    with closing(db()) as connection:
        order = serialize_order(connection, order_id)
    if not order:
        return jsonify({"error": "Không tìm thấy đơn gọi món."}), 404
    return jsonify(order), 200

@app.patch("/api/orders/<int:order_id>/status")
@require_role("kitchen", "manager")
def update_status(order_id):
    status = (request.get_json(silent=True) or {}).get("status")
    if status not in TRANSITIONS:
        return jsonify({"error": "Trạng thái đơn không hợp lệ."}), 400
    with closing(db()) as connection, connection:
        current = connection.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not current:
            return jsonify({"error": "Không tìm thấy đơn gọi món."}), 404
        if status not in TRANSITIONS[current["status"]]:
            return jsonify({"error": f"Không thể cập nhật trạng thái đơn theo yêu cầu."}), 409
        connection.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
        order = serialize_order(connection, order_id)
        row = connection.execute("SELECT session_id FROM orders WHERE id = ?", (order_id,)).fetchone()
        table_state = serialize_session(connection, row["session_id"]) if row["session_id"] else None
    broadcast("order-updated", order)
    if table_state:
        broadcast("session-updated", table_state)
    return jsonify(order), 200

# ---------------------------------------------------------------- staff auth

@app.post("/api/auth/login")
def login():
    pin = str((request.get_json(silent=True) or {}).get("pin", ""))
    if not pin.isdigit() or not 4 <= len(pin) <= 8:
        return jsonify({"error": "Mã PIN phải gồm 4 đến 8 chữ số."}), 400
    with closing(db()) as connection:
        for row in connection.execute("SELECT * FROM staff").fetchall():
            if check_password_hash(row["pin_hash"], pin):
                session.permanent = True
                session["staff"] = {"id": row["id"], "name": row["name"], "role": row["role"]}
                return jsonify(session["staff"]), 200
    return jsonify({"error": "Mã PIN không đúng."}), 401

@app.post("/api/auth/logout")
def logout():
    session.pop("staff", None)
    return jsonify({"ok": True}), 200

@app.get("/api/auth/me")
def whoami():
    staff = current_staff()
    if not staff:
        return jsonify({"error": "Chưa đăng nhập."}), 401
    return jsonify({**staff, "roleLabel": ROLES[staff["role"]]}), 200

# ------------------------------------------------------------ cashier screens

@app.get("/api/tables")
@require_role("cashier", "manager")
def list_tables():
    """Grid for the cashier: one cell per table, with its open bill if any."""
    with closing(db()) as connection:
        rows = connection.execute(
            "SELECT id, table_number FROM table_sessions WHERE status = 'open'"
        ).fetchall()
        open_sessions = {row["table_number"]: serialize_session(connection, row["id"]) for row in rows}
    tables = []
    for number in range(1, TABLE_COUNT + 1):
        state = open_sessions.pop(number, None)
        tables.append({"tableNumber": number, "session": state})
    # Tables outside 1..TABLE_COUNT that still have an open bill.
    for number, state in sorted(open_sessions.items()):
        tables.append({"tableNumber": number, "session": state})
    return jsonify(tables), 200

@app.post("/api/tables/<int:table_number>/open")
@require_role("cashier", "manager")
def open_table(table_number):
    """Seat guests: the cashier opens the table before anyone can order."""
    if not pos_int(table_number, MAX_TABLE):
        return jsonify({"error": "Số bàn không hợp lệ."}), 400
    staff = current_staff()
    with closing(db()) as connection, connection:
        if find_open_session(connection, table_number):
            return jsonify({"error": "Bàn này đang có khách."}), 409
        try:
            session_id = start_session(connection, table_number, staff["name"])
        except sqlite3.IntegrityError:
            # Another device opened the same table a moment earlier.
            return jsonify({"error": "Bàn này đang có khách."}), 409
        state = serialize_session(connection, session_id)
    broadcast("session-updated", state)
    return jsonify(state), 201

@app.post("/api/sessions/<int:session_id>/close")
@require_role("cashier", "manager")
def close_empty_session(session_id):
    """Undo a table opened by mistake. Only allowed while nothing is ordered."""
    with closing(db()) as connection, connection:
        state = serialize_session(connection, session_id)
        if not state:
            return jsonify({"error": "Không tìm thấy phiên bàn."}), 404
        if state["status"] != "open":
            return jsonify({"error": "Phiên bàn này đã đóng."}), 409
        if state["items"]:
            return jsonify({"error": "Bàn đã có món, vui lòng thanh toán thay vì đóng bàn."}), 409
        closing_write = connection.execute(
            "UPDATE table_sessions SET status = 'closed', closed_at = ?, total = 0, closed_by = ? WHERE id = ? AND status = 'open'",
            (datetime.now(timezone.utc).isoformat(), current_staff()["name"], session_id),
        )
        if closing_write.rowcount == 0:
            return jsonify({"error": "Phiên bàn này đã đóng."}), 409
        closed = serialize_session(connection, session_id)
    broadcast("session-updated", closed)
    return jsonify(closed), 200

@app.get("/api/sessions/<int:session_id>")
@require_role("cashier", "manager")
def get_session(session_id):
    with closing(db()) as connection:
        state = serialize_session(connection, session_id)
    if not state:
        return jsonify({"error": "Không tìm thấy phiên bàn."}), 404
    return jsonify(state), 200

@app.get("/api/sessions")
@require_role("cashier", "manager")
def list_sessions():
    """Recently closed bills, newest first (?status=closed&limit=20)."""
    status = request.args.get("status", "closed")
    if status not in {"open", "closed"}:
        return jsonify({"error": "Trạng thái phiên không hợp lệ."}), 400
    try:
        limit = min(max(int(request.args.get("limit", 20) or 20), 1), 100)
    except ValueError:
        return jsonify({"error": "Số lượng phiên cần xem không hợp lệ."}), 400
    with closing(db()) as connection:
        rows = connection.execute(
            "SELECT id FROM table_sessions WHERE status = ? ORDER BY id DESC LIMIT ?", (status, limit)
        ).fetchall()
        return jsonify([serialize_session(connection, row["id"]) for row in rows]), 200

@app.post("/api/sessions/<int:session_id>/pay")
@require_role("cashier", "manager")
def pay_session(session_id):
    method = (request.get_json(silent=True) or {}).get("method")
    if method not in PAYMENT_METHODS:
        return jsonify({"error": "Hình thức thanh toán không hợp lệ."}), 400
    staff = current_staff()
    with closing(db()) as connection, connection:
        row = connection.execute("SELECT status FROM table_sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return jsonify({"error": "Không tìm thấy phiên bàn."}), 404
        if row["status"] != "open":
            return jsonify({"error": "Phiên bàn này đã được thanh toán."}), 409
        state = serialize_session(connection, session_id)
        if not state["items"]:
            return jsonify({"error": "Bàn chưa gọi món nên chưa thể thanh toán."}), 409
        # Paying implies the food reached the table: close out every live order.
        served = connection.execute(
            "SELECT id FROM orders WHERE session_id = ? AND status NOT IN ('completed','cancelled')", (session_id,)
        ).fetchall()
        connection.execute(
            "UPDATE orders SET status = 'completed' WHERE session_id = ? AND status NOT IN ('completed','cancelled')",
            (session_id,),
        )
        # Close the session in one conditional statement so a second cashier
        # pressing pay at the same moment is rejected instead of closing it twice.
        closing_write = connection.execute(
            "UPDATE table_sessions SET status = 'closed', closed_at = ?, payment_method = ?, total = ?, closed_by = ? WHERE id = ? AND status = 'open'",
            (datetime.now(timezone.utc).isoformat(), method, state["total"], staff["name"], session_id),
        )
        if closing_write.rowcount == 0:
            return jsonify({"error": "Phiên bàn này đã được thanh toán."}), 409
        closed = serialize_session(connection, session_id)
        updated = [serialize_order(connection, order["id"]) for order in served]
    for order in updated:
        broadcast("order-updated", order)
    broadcast("session-updated", closed)
    return jsonify(closed), 200

# --------------------------------------------------------- menu management

def clean_menu_payload(payload, existing=None):
    """Validate one dish. Returns (item, error)."""
    item = dict(existing or {"available": True, "popular": False, "imageSource": ""})
    for field in ("name", "category", "description", "image", "imageSource"):
        if field in payload:
            value = payload[field]
            if not isinstance(value, str) or len(value) > 500:
                return None, f"Trường {field} không hợp lệ."
            item[field] = value.strip()
    if "price" in payload:
        if not pos_int(payload["price"], 100_000_000):
            return None, "Giá món không hợp lệ."
        item["price"] = payload["price"]
    for field in ("available", "popular"):
        if field in payload:
            if not isinstance(payload[field], bool):
                return None, f"Trường {field} phải là true hoặc false."
            item[field] = payload[field]
    if not item.get("name") or not item.get("category") or not item.get("price"):
        return None, "Món ăn cần có tên, danh mục và giá."
    item.setdefault("description", "")
    item.setdefault("image", "")
    return {field: item.get(field, "") for field in ("id", *MENU_FIELDS) if field in item or field != "id"}, None

@app.patch("/api/menu/<int:item_id>")
@require_role("kitchen", "manager")
def update_menu_item(item_id):
    payload = request.get_json(silent=True) or {}
    staff = current_staff()
    # The kitchen marks dishes sold out; only a manager edits name, price or photo.
    if staff["role"] != "manager" and set(payload) - {"available"}:
        return jsonify({"error": "Chỉ quản lý mới được sửa thông tin món."}), 403
    with menu_lock:
        items = [dict(item) for item in MENU]
        index = next((position for position, item in enumerate(items) if item["id"] == item_id), None)
        if index is None:
            return jsonify({"error": "Không tìm thấy món ăn."}), 404
        updated, error = clean_menu_payload(payload, items[index])
        if error:
            return jsonify({"error": error}), 400
        updated["id"] = item_id
        items[index] = updated
        save_menu(items)
    broadcast("menu-updated", updated)
    return jsonify(updated), 200

@app.post("/api/menu")
@require_role("manager")
def create_menu_item():
    payload = request.get_json(silent=True) or {}
    with menu_lock:
        items = [dict(item) for item in MENU]
        created, error = clean_menu_payload(payload)
        if error:
            return jsonify({"error": error}), 400
        created["id"] = max((item["id"] for item in items), default=0) + 1
        items.append(created)
        save_menu(items)
    broadcast("menu-updated", created)
    return jsonify(created), 201

@app.delete("/api/menu/<int:item_id>")
@require_role("manager")
def delete_menu_item(item_id):
    with menu_lock:
        items = [dict(item) for item in MENU if item["id"] != item_id]
        if len(items) == len(MENU):
            return jsonify({"error": "Không tìm thấy món ăn."}), 404
        save_menu(items)
    broadcast("menu-updated", {"id": item_id, "deleted": True})
    return jsonify({"ok": True, "id": item_id}), 200

@app.get("/api/events")
def events():
    channel = queue.Queue()
    subscribers.append(channel)
    def stream():
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    yield channel.get(timeout=HEARTBEAT_SECONDS)
                except queue.Empty:
                    # SSE comment line: keeps the connection alive and lets Flask
                    # notice closed clients so their queues get cleaned up.
                    yield ": ping\n\n"
        finally:
            subscribers.remove(channel)
    return Response(stream(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.errorhandler(HTTPException)
def http_error(error):
    messages = {400: "Yêu cầu không hợp lệ.", 404: "Không tìm thấy nội dung yêu cầu.", 405: "Thao tác không được hỗ trợ."}
    return jsonify({"error": messages.get(error.code, "Không thể xử lý yêu cầu. Vui lòng thử lại.")}), error.code

@app.errorhandler(Exception)
def server_error(error):
    app.logger.exception(error)
    return jsonify({"error": "Đã xảy ra lỗi. Vui lòng thử lại."}), 500

# Create tables on import so `flask run` works as well as `python app.py`.
init_db()

if __name__ == "__main__":
    # 5001 instead of 5000: on macOS, port 5000 is taken by AirPlay Receiver.
    # Debug is on for development; set DEBUG=0 whenever the app is reachable
    # from the internet.
    app.run(debug=os.environ.get("DEBUG", "1") == "1", threaded=True,
            host="0.0.0.0", port=int(os.environ.get("PORT", 5001)))
