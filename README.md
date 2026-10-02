# Bep Nha — QR Restaurant Ordering

Giao diện khách hàng và bếp đã chuyển sang tiếng Việt theo bảng từ ngữ đã chốt.
Khi cập nhật, thay cả frontend và backend; giữ lại `backend/restaurant.db` nếu
muốn giữ các món đã gọi. Khởi động lại cả hai tiến trình. Để mở cùng địa chỉ
đã dùng ở bản trước, chạy `npm run dev -- --port 5180 --strictPort` trong
`frontend`, rồi mở `http://localhost:5180/demo`.

A course project following the lecture stack: React + Vite, React Router, Fetch API, Flask, SQLite and Server-Sent Events.

## Run locally

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py        # runs on http://localhost:5001 (set PORT to change)
```

Frontend (another terminal):

```bash
cd frontend
npm ci
npm run dev
```

Open the address printed by Vite and enter a table number (1–12) and click **Vào bàn …**. Keep `/kitchen` open in another window for the live demo.

### Scanning the QR code with a phone

1. Put the phone and the computer on the same Wi-Fi.
2. Run `npm run dev:lan` instead of `npm run dev`. Vite prints a `Network:` address such as `http://192.168.1.20:5173`.
3. Open `/demo` on the computer **using that network address** (not `localhost`). Choose a table number (1–12). The QR code uses that number, for example `http://192.168.1.20:5173/menu?table=3` for table 3.

If the backend runs on another port, start Vite with `BACKEND_URL=http://localhost:<port> npm run dev`.

Browsers allow only ~6 open connections per site over HTTP/1.1 and every open page keeps one live event stream, so keep at most 4–5 tabs of the app open on the same computer during the demo.

## Main features

1. Table identification through QR-compatible URLs
2. 31 dishes in 7 categories: sticky tabs, accent-insensitive search, quantity stepper and bottom cart preview
3. Cart, notes, validation and ordering
4. Kitchen order management (start, ready, served, cancel)
5. My orders: one combined list, small dish photos, quantities, line amounts and “Tạm tính tiền”
6. SSE keeps the provisional bill up to date; kitchen states remain internal to the kitchen view

## API

- `GET /api/menu` — 31 items; no sold count
- `POST /api/orders`
- `GET /api/orders` — all orders (kitchen); `GET /api/orders?ids=1,4,7` — only those orders (customer history, max 50)
- `GET /api/orders/:id`
- `PATCH /api/orders/:id/status` — only forward moves are allowed: pending → preparing → ready → completed, and pending/preparing → cancelled (otherwise `409`)
- `GET /api/events`

## Presentation demo

1. Open `/demo`, enter a table number (1–12); the QR updates to `/menu?table=<number>`.
2. Click **Vào bàn …**, add food and place the order.
3. Switch to `/kitchen`; the order appears live.
4. Click **Bắt đầu chế biến**, then **Chế biến xong**.
5. Return to the customer screen: **Đã nhận món** remains a simple confirmation without a timeline.
6. Place a second order containing the same dish. **Món đã gọi** combines the quantities and amounts in one row.
7. Cancel an eligible order in Kitchen; its dishes disappear from the provisional bill automatically.

## Data and photos

Catalog: `backend/menu.json`. IDs 1–6 are preserved. There are 4 starters,
3 salads, 9 mains, 4 vegetarian dishes (egg/dairy may be included), 2 sides,
3 desserts and 6 drinks. Prices are demo prices, not current restaurant quotes.
See PHOTO-SOURCES.md for menu inspiration and the source of every internet photo.
No generated photo is shipped. Remote photos require internet and can fail if
the original publisher changes its URL or blocks external embedding.

## Provisional bill scope

My orders uses the saved order IDs on this browser/device (up to 50) and filters
them to the currently selected table. It merges repeated menu IDs, excludes
cancelled orders and includes served orders, using each order's stored prices.
It does not combine other diners' devices and has no dining-session/payment reset.
This is a classroom prototype, not a production billing or access-control system.
Order IDs/statuses remain in the backend and Kitchen but are not shown in My orders.

## Checks

```bash
cd frontend
node --test tests/ src/staff/
npm run build
cd ../backend
python -m unittest test_app
```

Nếu Node không nhận đường dẫn thư mục trong lệnh test (ví dụ Node 24), chạy
`node --test tests/*.test.mjs src/staff/*.test.mjs` trong `frontend` để chạy cùng
bộ test. Kết quả kiểm tra bản sửa: backend 19/19 test, frontend 13/13 test;
`npm run build` thành công.

## Màn hình nhân viên (mới)

| Đường dẫn | Ai dùng | Làm gì |
|---|---|---|
| `/kitchen` | Bếp, Quản lý | Nhận đơn theo bàn, đổi trạng thái, hủy đơn |
| `/cashier` | Thu ngân, Quản lý | Sơ đồ bàn, hóa đơn gộp theo bàn, đọc lại món, thanh toán |
| `/menu-admin` | Bếp (bật tắt hết món), Quản lý (thêm, sửa, xóa món) | Quản lý thực đơn |

Cả ba màn hình đều yêu cầu đăng nhập bằng mã PIN. Tài khoản mẫu được tạo ở lần chạy đầu tiên:

| Vai trò | PIN | Quyền |
|---|---|---|
| Bếp | 1111 | Đổi trạng thái đơn, đánh dấu hết món |
| Thu ngân | 2222 | Xem sơ đồ bàn, thanh toán, đóng phiên |
| Quản lý | 3333 | Toàn quyền, gồm sửa giá và thêm xóa món |

Đổi PIN và đặt `SECRET_KEY` trước khi dùng thật:

```bash
KITCHEN_PIN="4821" CASHIER_PIN="5932" MANAGER_PIN="6043" \
SECRET_KEY="thay-bang-chuoi-ngau-nhien-bi-mat" DEBUG=0 python app.py
```

Các biến `KITCHEN_PIN`, `CASHIER_PIN`, `MANAGER_PIN` được đọc lúc khởi động,
chỉ dùng để tạo tài khoản khi bảng `staff` chưa có dữ liệu. Nếu không đặt biến,
PIN mặc định lần lượt là `1111`, `2222`, `3333`. Dùng PIN gồm 4–8 chữ số và khác
nhau cho từng vai trò. Thay biến môi trường không đổi PIN đã lưu trong database;
không xóa database đang dùng để đổi PIN vì sẽ mất dữ liệu.

`SECRET_KEY` được đọc từ môi trường; nếu vẫn dùng `dev-secret-change-me`, backend
in cảnh báo vào log. Không đưa PIN hoặc khóa thật vào mã nguồn/repo public.

Backend đã bỏ CORS. Frontend gọi `/api` cùng origin qua proxy Vite; khi triển khai,
cần cấu hình reverse proxy để `/api` trỏ đến Flask trên cùng origin.

### Phiên bàn

Mỗi lượt khách là một **phiên bàn**. Nhân viên dẫn khách vào bàn rồi bấm **Mở bàn** trên màn hình thu ngân; khách chỉ gọi được món khi bàn đã mở, nên người bàn bên cạnh nghịch quét mã của bàn trống cũng không tạo được đơn. Các lần gọi thêm được gộp vào cùng phiên đó. Thu ngân thanh toán thì phiên đóng lại, mọi đơn chưa xong được đánh dấu đã phục vụ, và lượt khách tiếp theo ở bàn đó sẽ bắt đầu một phiên mới.

### API nhân viên

- `POST /api/auth/login` `{pin}`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/tables` — sơ đồ bàn kèm hóa đơn đang mở (thu ngân, quản lý)
- `POST /api/tables/:n/open` — mở bàn khi xếp khách; `POST /api/sessions/:id/close` — đóng bàn mở nhầm (chỉ khi chưa gọi món)
- `GET /api/sessions/:id`, `GET /api/sessions?status=closed` — chi tiết và lịch sử phiên
- `POST /api/sessions/:id/pay` `{method: cash|transfer|card}` — thanh toán và đóng phiên
- `PATCH /api/menu/:id` — bếp chỉ đổi được `available`; quản lý sửa mọi trường
- `POST /api/menu`, `DELETE /api/menu/:id` — quản lý thêm hoặc xóa món
- `GET /api/orders` (không tham số) giờ yêu cầu đăng nhập; `GET /api/orders?ids=` vẫn công khai cho khách
- `POST /api/orders` nhận thêm `clientToken`: gửi lại cùng một token trả về đúng đơn cũ thay vì tạo đơn trùng

Đặt `OPEN_TABLE_FIRST=0` nếu muốn bỏ bước mở bàn khi đang phát triển (đơn đầu tiên sẽ tự mở phiên).

