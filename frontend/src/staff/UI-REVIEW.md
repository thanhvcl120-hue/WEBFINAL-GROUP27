# Rà soát UI — bản restaurant-ordering (3)

## Phạm vi

Chỉ sửa hoặc thêm tệp trong `frontend/src/staff/`. Không sửa `main.jsx`
(kể cả route), `styles.css`, backend, tên endpoint, package/lockfile, dữ liệu
menu hoặc ảnh. Khi đóng ZIP, so sánh từng byte với ZIP đầu vào cho toàn bộ
tệp ngoài `staff/`.

Đã đọc code giao diện `/demo`, `/menu`, `/cart`, `/order/:id`, `/orders`,
`/kitchen`, `/cashier`, `/menu-admin` và đối chiếu API liên quan. Các màn hình
khách chỉ được rà soát, không chỉnh vì giới hạn phạm vi.

## Thay đổi

- Dùng chung khung nhân viên, thương hiệu Bếp Nhà, điều hướng theo vai trò,
  thông tin tài khoản và đăng xuất có xử lý lỗi. Bếp được bọc bằng
  `RequireStaff` sẵn có; không cần sửa route. Giữ nền tối của bếp cho mục đích
  vận hành, đồng nhất kích thước tiêu đề, điều hướng và nút thao tác.
- Tông kem/xanh/cam theo giao diện khách; cam trên nút có chữ trắng được làm
  đậm hơn để dễ đọc. Khoảng cách, viền, bo góc và trạng thái focus thống nhất.
- PIN hỗ trợ gõ, dán, bàn phím số; nhãn rõ ràng; xử lý lỗi mạng khác lỗi mã PIN.
- Quản lý thực đơn: ảnh có fallback, tìm kiếm không dấu (gồm Đ viết hoa), lọc
  danh mục/trạng thái, phân biệt đang tải/trống/lỗi, thử lại, trạng thái busy.
  Form dùng giá nguyên đúng giới hạn API, không ép bội số 1.000 đồng.
- Form/xác nhận dùng dialog native với nhãn truy cập, Escape, khóa nền và trả
  focus; không cho đóng khi đang gửi. Có bước xác nhận xóa và lời nhắc dùng
  trạng thái hết món nếu chỉ tạm ngừng phục vụ.
- Thu ngân: lọc/tìm số bàn, phân biệt trống/chưa gọi/đang phục vụ bằng chữ,
  bộ đếm thời gian cập nhật mỗi phút. Không gọi tổng các bàn là doanh thu.
- Hóa đơn tách cùng món theo giá và tên lưu trong đơn, loại món bị hủy, giữ
  tổng tiền do server trả. Chọn hình thức thanh toán bằng radio. Xác nhận
  nhận tiền, cảnh báo đơn chưa phục vụ, khóa gửi lặp và đọc lại hóa đơn trước
  khi POST. Nếu hóa đơn đổi, yêu cầu xác nhận lại. Phiên đã đóng từ máy khác
  không còn nút thanh toán. Có in tạm tính và in hóa đơn sau thanh toán.
- Lỗi thao tác không bị sự kiện SSE tự xóa; dữ liệu đọc cũ bị hủy khi tải lại.
  Giữ tải lại khi nhận `connected`. Bổ sung báo kết nối cho thu ngân/thực đơn.
- API nhân viên trả 401 đưa về đăng nhập. Kiểm tra phiên khi quay lại cửa sổ;
  lỗi mạng lúc đang sửa món không làm mất bản nháp.
- CSS responsive ở 1.000/700/420 px, điều khiển chính tối thiểu 44 px,
  hỗ trợ giảm chuyển động, CSS in giới hạn trong màn hình nhân viên.

## Kết quả kiểm tra

- `npm run build`: thành công.
- Test frontend: 9 test qua (3 test lịch sử cũ + 6 test mới về hóa đơn,
  tìm kiếm và API/error/session).
- `python -m unittest test_app.py`: 10 test backend qua, backend giữ nguyên.
- Kiểm tra React trong DOM mô phỏng: 27 điểm qua, gồm đăng nhập sai/đúng,
  nhập PIN bàn phím, phân quyền, điều hướng, SSE reconnect, tìm kiếm, bật/tắt
  món, thêm món, xác nhận/hủy xóa, giữ bản nháp khi mất kết nối, tách giá trên
  hóa đơn, xác nhận lại hóa đơn thay đổi, bấm thanh toán hai lần, trạng thái
  đã đóng, đăng xuất, thử lại và 401. Không còn cảnh báo render/trùng key.
- ZIP không gồm node_modules, dist, database chạy thử hay dữ liệu QA.

Chạy lại các test được kèm trong frontend:

```sh
node --test tests/order-summary.test.mjs src/staff/staff-model.test.mjs src/staff/staff-api.test.mjs
npm run build
```

### Chưa xác nhận bằng trình duyệt thật

Trình duyệt kiểm thử chặn địa chỉ localhost (`ERR_BLOCKED_BY_CLIENT`). Vì
vậy **chưa có kiểm tra ảnh chụp desktop/mobile, đo tràn ngang, native focus
trap hoặc bản in thực tế**. DOM mô phỏng không thay thế các kiểm tra này.
Các breakpoint, độ tương phản và hành vi native dialog mới được rà ở code.

Nên mở thử 320/390/768/1.440 px: đăng nhập, bếp, sơ đồ bàn, hóa đơn, thực đơn,
form món và xác nhận thanh toán; kiểm tra Tab/Shift+Tab/Escape, cuộn form khi
mở bàn phím mobile và Print Preview. Kiểm tra thêm hai máy cùng mở một hóa
đơn và mất/kết nối lại mạng với backend thật.

## Phát hiện ngoài phạm vi — chưa sửa

1. `order-summary.js` vẫn lọc theo số bàn trong sessionStorage; tab mới không
   có số bàn vẫn có thể không thấy lịch sử. Test cũ còn khẳng định hành vi này.
2. Footer tạm tính của `/orders` vẫn hiện khi chưa có món.
3. Theo dõi khách vẫn ghi “Đã nhận món”, không hiện trạng thái chế biến.
   README mô tả đây là chủ ý; cần chốt trước khi thay đổi.
4. `/menu` của khách chỉ tải thực đơn lúc mount, chưa nghe `menu-updated`;
   thay giá/hết món trên staff chưa tự cập nhật màn hình khách đang mở.
5. `/demo` vẫn vào thẳng bàn 5 trong khi backend mặc định yêu cầu mở bàn.
   Khi demo, thu ngân phải mở bàn 5 trước.
6. Kitchen trong `main.jsx` vẫn tự xử lý request/SSE; chưa dùng bộ xử lý
   401/busy mới của staff-api. Không sửa luồng đơn của bếp trong lần này.
7. Ảnh thực đơn vẫn hotlink, không được tải về hoặc thay nguồn. Cảnh báo bản
   quyền trong PHOTO-SOURCES.md giữ nguyên.
8. Các vấn đề bảo mật/backend trong danh sách trước không thuộc bản sửa UI.
   Không coi bản này là đủ điều kiện đưa public hoặc dùng thu tiền thật.

Lưu ý: đọc lại hóa đơn trước POST làm giảm thao tác dựa trên dữ liệu cũ,
nhưng không thể loại bỏ khoảng đua nếu có đơn mới đúng lúc server thanh toán.
Muốn bảo đảm nguyên tử theo phiên bản hóa đơn cần thay backend/API; chưa làm
để giữ đúng phạm vi và hợp đồng API hiện có.
