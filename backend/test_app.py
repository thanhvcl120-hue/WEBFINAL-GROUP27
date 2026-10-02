import tempfile
import unittest
from pathlib import Path
import app as server
from collections import Counter

class OrderingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_db = server.DB_PATH
        server.DB_PATH = Path(self.temp.name) / "test.db"
        server.init_db()
        self.client = server.app.test_client()
        self.menu_backup = [dict(item) for item in server.MENU]

    def sign_in(self, pin):
        response = self.client.post("/api/auth/login", json={"pin": pin})
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def order(self, table, items, token=None):
        self.open_table(table)
        payload = {"tableNumber": table, "items": items}
        if token:
            payload["clientToken"] = token
        response = self.client.post("/api/orders", json=payload)
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    def open_table(self, table):
        """Seat guests at a table, keeping whoever is signed in signed in."""
        before = self.client.get("/api/auth/me")
        self.client.post("/api/auth/login", json={"pin": "2222"})
        self.client.post("/api/tables/" + str(table) + "/open")
        if before.status_code == 200:
            self.client.post("/api/auth/login", json={"pin": {
                "kitchen": "1111", "cashier": "2222", "manager": "3333"}[before.get_json()["role"]]})
        else:
            self.client.post("/api/auth/logout")

    def tearDown(self):
        server.DB_PATH = self.previous_db
        server.save_menu(self.menu_backup)
        self.temp.cleanup()

    def test_catalog(self):
        response = self.client.get("/api/menu")
        self.assertEqual(response.status_code, 200)
        menu = response.get_json()
        self.assertEqual(len(menu), 31)
        self.assertEqual(len({item["id"] for item in menu}), 31)
        self.assertEqual(Counter(item["category"] for item in menu), {
            "Khai vị":4, "Nộm và salad":3, "Món chính":9, "Món chay":4,
            "Món ăn kèm":2, "Tráng miệng":3, "Đồ uống":6,
        })
        for item in menu:
            self.assertTrue(item["image"].startswith("https://"))
            self.assertTrue(item["imageSource"].startswith("https://"))
            self.assertNotIn("sold", item)

    def test_orders_and_kitchen(self):
        self.sign_in("1111")
        created = self.order(5, [{"menuItemId":1,"quantity":3}, {"menuItemId":4,"quantity":2}])
        self.assertEqual(created["total"], 279000)
        for item in created["items"]:
            self.assertEqual(item["image"], server.MENU_BY_ID[item["menu_item_id"]]["image"])
        endpoint = "/api/orders/" + str(created["id"]) + "/status"
        self.assertEqual(self.client.patch(endpoint, json={"status":"ready"}).status_code, 409)
        for status in ["preparing", "ready", "completed"]:
            self.assertEqual(self.client.patch(endpoint, json={"status":status}).status_code, 200)
        fetched = self.client.get("/api/orders?ids=" + str(created["id"])).get_json()
        self.assertEqual(fetched[0]["status"], "completed")
        self.assertEqual(fetched[0]["total"], 279000)

    def test_new_dish_and_cancellation(self):
        self.sign_in("1111")
        created = self.order(5, [{"menuItemId":31,"quantity":2,"price":1}])
        self.assertEqual(created["total"], server.MENU_BY_ID[31]["price"] * 2)
        response = self.client.patch("/api/orders/" + str(created["id"]) + "/status", json={"status":"cancelled"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "cancelled")

    # ------------------------------------------------------------ new tests

    def test_staff_login_and_guards(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/api/orders").status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"pin": "0000"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"pin": "ab"}).status_code, 400)
        self.assertEqual(self.sign_in("2222")["role"], "cashier")
        # A cashier may not touch order status; the kitchen may not open the till.
        created = self.order(3, [{"menuItemId": 1, "quantity": 1}])
        endpoint = "/api/orders/" + str(created["id"]) + "/status"
        self.assertEqual(self.client.patch(endpoint, json={"status": "preparing"}).status_code, 403)
        self.sign_in("1111")
        self.assertEqual(self.client.get("/api/tables").status_code, 403)
        self.assertEqual(self.client.patch(endpoint, json={"status": "preparing"}).status_code, 200)
        self.client.post("/api/auth/logout")
        self.assertEqual(self.client.get("/api/orders").status_code, 401)

    def test_table_session_groups_rounds_until_payment(self):
        first = self.order(7, [{"menuItemId": 1, "quantity": 2}])
        second = self.order(7, [{"menuItemId": 1, "quantity": 1}, {"menuItemId": 4, "quantity": 1}])
        self.sign_in("2222")
        tables = self.client.get("/api/tables").get_json()
        cell = next(entry for entry in tables if entry["tableNumber"] == 7)
        bill = cell["session"]
        self.assertEqual(len(bill["orders"]), 2)
        # Both rounds of pho collapse into one line.
        pho = next(line for line in bill["items"] if line["menuItemId"] == 1)
        self.assertEqual(pho["quantity"], 3)
        self.assertEqual(bill["total"], first["total"] + second["total"])

        paid = self.client.post("/api/sessions/" + str(bill["id"]) + "/pay", json={"method": "cash"})
        self.assertEqual(paid.status_code, 200)
        closed = paid.get_json()
        self.assertEqual(closed["status"], "closed")
        self.assertEqual(closed["total"], bill["total"])
        self.assertEqual(closed["closedBy"], "Thu ngân")
        # Paying serves every live order and cannot be repeated.
        self.assertTrue(all(order["status"] == "completed" for order in closed["orders"]))
        self.assertEqual(self.client.post("/api/sessions/" + str(bill["id"]) + "/pay", json={"method": "cash"}).status_code, 409)
        self.assertEqual(self.client.post("/api/sessions/" + str(bill["id"]) + "/pay", json={"method": "vang"}).status_code, 400)

        # The next guests at table 7 start a fresh bill.
        self.order(7, [{"menuItemId": 4, "quantity": 1}])
        again = next(entry for entry in self.client.get("/api/tables").get_json() if entry["tableNumber"] == 7)
        self.assertNotEqual(again["session"]["id"], bill["id"])
        self.assertEqual(len(again["session"]["orders"]), 1)

    def test_cancelled_round_is_not_billed(self):
        self.sign_in("1111")
        keep = self.order(2, [{"menuItemId": 1, "quantity": 1}])
        drop = self.order(2, [{"menuItemId": 4, "quantity": 5}])
        self.client.patch("/api/orders/" + str(drop["id"]) + "/status", json={"status": "cancelled"})
        self.sign_in("2222")
        cell = next(entry for entry in self.client.get("/api/tables").get_json() if entry["tableNumber"] == 2)
        self.assertEqual(cell["session"]["total"], keep["total"])
        self.assertEqual([line["menuItemId"] for line in cell["session"]["items"]], [1])

    def test_menu_management_roles(self):
        self.sign_in("1111")
        sold_out = self.client.patch("/api/menu/1", json={"available": False})
        self.assertEqual(sold_out.status_code, 200)
        self.assertFalse(sold_out.get_json()["available"])
        self.assertFalse(server.MENU_BY_ID[1]["available"])
        # A sold-out dish cannot be ordered any more.
        self.open_table(1)
        self.assertEqual(self.client.post("/api/orders", json={
            "tableNumber": 1, "items": [{"menuItemId": 1, "quantity": 1}]}).status_code, 400)
        # The kitchen may not change prices, and may not add or remove dishes.
        self.assertEqual(self.client.patch("/api/menu/1", json={"price": 1000}).status_code, 403)
        self.assertEqual(self.client.post("/api/menu", json={"name": "X", "category": "Y", "price": 1000}).status_code, 403)

        self.sign_in("3333")
        created = self.client.post("/api/menu", json={
            "name": "Món mới", "category": "Khai vị", "price": 45000, "description": "Mô tả"})
        self.assertEqual(created.status_code, 201)
        new_id = created.get_json()["id"]
        self.assertEqual(len(self.client.get("/api/menu").get_json()), 32)
        self.assertEqual(self.client.patch("/api/menu/" + str(new_id), json={"price": 0}).status_code, 400)
        self.assertEqual(self.client.patch("/api/menu/" + str(new_id), json={"price": 50000}).get_json()["price"], 50000)
        # A dish ordered before its price changed keeps the price it was sold at.
        order = self.order(4, [{"menuItemId": new_id, "quantity": 1}])
        self.client.patch("/api/menu/" + str(new_id), json={"price": 99000})
        self.assertEqual(self.client.get("/api/orders/" + str(order["id"])).get_json()["total"], 50000)
        self.assertEqual(self.client.delete("/api/menu/" + str(new_id)).status_code, 200)
        self.assertEqual(len(self.client.get("/api/menu").get_json()), 31)
        self.assertEqual(self.client.delete("/api/menu/" + str(new_id)).status_code, 404)

    def test_order_needs_an_open_table(self):
        closed_table = {"tableNumber": 11, "items": [{"menuItemId": 1, "quantity": 1}]}
        blocked = self.client.post("/api/orders", json=closed_table)
        self.assertEqual(blocked.status_code, 409)
        self.assertIn("chưa được mở", blocked.get_json()["error"])
        # Guests cannot open a table themselves.
        self.assertEqual(self.client.post("/api/tables/11/open").status_code, 401)
        self.sign_in("1111")
        self.assertEqual(self.client.post("/api/tables/11/open").status_code, 403)
        self.sign_in("2222")
        self.assertEqual(self.client.post("/api/tables/11/open").status_code, 201)
        self.assertEqual(self.client.post("/api/tables/11/open").status_code, 409)
        self.assertEqual(self.client.post("/api/orders", json=closed_table).status_code, 201)

    def test_close_table_opened_by_mistake(self):
        self.sign_in("2222")
        opened = self.client.post("/api/tables/12/open").get_json()
        self.assertEqual(self.client.post("/api/sessions/" + str(opened["id"]) + "/close").status_code, 200)
        # Reopened and used: closing without payment is refused once food is on the bill.
        self.client.post("/api/tables/12/open")
        self.order(12, [{"menuItemId": 1, "quantity": 1}])
        self.sign_in("2222")
        live = next(entry for entry in self.client.get("/api/tables").get_json() if entry["tableNumber"] == 12)
        self.assertEqual(self.client.post("/api/sessions/" + str(live["session"]["id"]) + "/close").status_code, 409)

    def test_double_tap_creates_one_order(self):
        self.open_table(6)
        payload = {"tableNumber": 6, "items": [{"menuItemId": 1, "quantity": 1}], "clientToken": "abc12345-token"}
        first = self.client.post("/api/orders", json=payload)
        second = self.client.post("/api/orders", json=payload)
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.get_json()["id"], second.get_json()["id"])
        self.sign_in("2222")
        bill = next(entry for entry in self.client.get("/api/tables").get_json() if entry["tableNumber"] == 6)
        self.assertEqual(len(bill["session"]["orders"]), 1)
        self.assertEqual(bill["session"]["total"], server.MENU_BY_ID[1]["price"])
        # A different token is a genuine second round.
        self.client.post("/api/auth/logout")
        again = self.client.post("/api/orders", json={**payload, "clientToken": "def67890-token"})
        self.assertEqual(again.status_code, 201)
        self.assertEqual(self.client.post("/api/orders", json={**payload, "clientToken": "x"}).status_code, 400)

    def test_order_reports_its_session_and_whether_it_is_paid(self):
        created = self.order(8, [{"menuItemId": 1, "quantity": 1}])
        self.assertEqual(created["sessionStatus"], "open")
        self.assertIsNotNone(created["sessionId"])
        # A guest's phone can still read the order after payment, but it is
        # now marked closed so the next seating's bill starts empty.
        self.sign_in("2222")
        self.client.post("/api/sessions/" + str(created["sessionId"]) + "/pay", json={"method": "cash"})
        self.client.post("/api/auth/logout")
        after = self.client.get("/api/orders?ids=" + str(created["id"])).get_json()[0]
        self.assertEqual(after["sessionStatus"], "closed")
        self.assertEqual(after["sessionId"], created["sessionId"])
        # The next guests at that table get a different session.
        self.open_table(8)
        fresh = self.order(8, [{"menuItemId": 4, "quantity": 1}])
        self.assertNotEqual(fresh["sessionId"], created["sessionId"])
        self.assertEqual(fresh["sessionStatus"], "open")

    def test_bad_query_parameters_are_rejected_not_crashed(self):
        self.sign_in("2222")
        self.assertEqual(self.client.get("/api/sessions?limit=abc").status_code, 400)
        self.assertEqual(self.client.get("/api/sessions?limit=-5").status_code, 200)
        # An id far larger than SQLite's integer range is just not an order.
        self.assertEqual(self.client.get("/api/orders?ids=" + "9" * 30).status_code, 200)
        self.assertEqual(self.client.get("/api/orders?ids=1,abc").status_code, 400)

    def test_a_token_cannot_be_replayed_against_another_table(self):
        self.open_table(2)
        self.open_table(3)
        payload = {"tableNumber": 2, "items": [{"menuItemId": 1, "quantity": 1}], "clientToken": "replay-token-1"}
        self.assertEqual(self.client.post("/api/orders", json=payload).status_code, 201)
        moved = self.client.post("/api/orders", json={**payload, "tableNumber": 3})
        self.assertEqual(moved.status_code, 409)

    def test_a_bill_cannot_be_paid_or_closed_twice(self):
        self.order(4, [{"menuItemId": 1, "quantity": 1}])
        self.sign_in("2222")
        bill = next(entry for entry in self.client.get("/api/tables").get_json() if entry["tableNumber"] == 4)["session"]
        self.assertEqual(self.client.post("/api/sessions/" + str(bill["id"]) + "/pay", json={"method": "cash"}).status_code, 200)
        self.assertEqual(self.client.post("/api/sessions/" + str(bill["id"]) + "/pay", json={"method": "card"}).status_code, 409)
        self.assertEqual(self.client.post("/api/sessions/" + str(bill["id"]) + "/close").status_code, 409)
        # The recorded payment is the first one, not the second attempt.
        self.assertEqual(self.client.get("/api/sessions/" + str(bill["id"])).get_json()["paymentMethod"], "cash")

    def test_only_kitchen_and_manager_touch_the_menu(self):
        self.sign_in("2222")
        self.assertEqual(self.client.patch("/api/menu/1", json={"available": False}).status_code, 403)
        self.assertTrue(server.MENU_BY_ID[1]["available"])

class ConfigurationTests(unittest.TestCase):
    def run_config(self, overrides):
        import os
        import shutil
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as directory:
            for name in ("app.py", "menu.json"):
                shutil.copy(Path(server.__file__).with_name(name), directory)
            env = {key: value for key, value in os.environ.items()
                   if key not in ("SECRET_KEY", "KITCHEN_PIN", "CASHIER_PIN", "MANAGER_PIN")}
            env.update(overrides)
            script = """
import json
import app
client = app.app.test_client()
roles = []
for _, role, pin in app.DEFAULT_STAFF:
    response = client.post('/api/auth/login', json={'pin': pin})
    assert response.status_code == 200
    roles.append(response.get_json()['role'])
print(json.dumps({'pins': [row[2] for row in app.DEFAULT_STAFF],
                  'roles': roles, 'secret': app.app.config['SECRET_KEY']}))
"""
            result = subprocess.run([sys.executable, "-c", script], cwd=directory,
                                    env=env, capture_output=True, text=True, check=True)
            import json
            return json.loads(result.stdout), result.stderr

    def test_environment_pins_and_secret(self):
        data, logs = self.run_config({"KITCHEN_PIN": "4821", "CASHIER_PIN": "5932",
                                      "MANAGER_PIN": "6043", "SECRET_KEY": "test-private-key"})
        self.assertEqual(data["pins"], ["4821", "5932", "6043"])
        self.assertEqual(data["roles"], ["kitchen", "cashier", "manager"])
        self.assertEqual(data["secret"], "test-private-key")
        self.assertNotIn("SECRET_KEY đang dùng", logs)

    def test_defaults_warn_and_still_login(self):
        data, logs = self.run_config({})
        self.assertEqual(data["pins"], ["1111", "2222", "3333"])
        self.assertIn("SECRET_KEY đang dùng giá trị mặc định", logs)

    def test_explicit_default_secret_also_warns(self):
        _, logs = self.run_config({"SECRET_KEY": "dev-secret-change-me"})
        self.assertIn("SECRET_KEY đang dùng giá trị mặc định", logs)

    def test_no_cors_headers(self):
        client = server.app.test_client()
        for method in ("GET", "OPTIONS"):
            response = client.open("/api/menu", method=method, headers={
                "Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
            self.assertNotIn("Access-Control-Allow-Credentials", response.headers)

if __name__ == "__main__":
    unittest.main()
