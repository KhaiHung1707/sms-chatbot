# OBP SMS Assistant — Báo cáo tiến độ

> Bản gửi khách hàng · Cập nhật: 2026-07-22
> ✏️ **File này cho phép điều chỉnh mọi chi tiết** — sửa nội dung/độ chi tiết
> tùy ý trước khi gửi khách. Xóa các dòng bắt đầu bằng ✏️ khi hoàn thiện.

---

## Mục tiêu tổng thể (House goal)

<!-- ✏️ Điền/sửa mục tiêu tổng của dự án theo lời khách -->
Trợ lý SMS tự động cho Oakland Body Parts: trả lời khách hỏi giá/tồn phụ tùng,
giữ hàng, và **chỉ trả lời khi chắc chắn 100%** — còn lại để nhân viên xử lý tay.

---

## 1. Đã hoàn thành gần nhất — Update 002 (5 yêu cầu)

| # | Yêu cầu | Trạng thái |
|---|---|---|
| 1 | Bot chỉ trả lời khi chắc chắn 100%, không thì im để nhân viên xử lý | ✅ Xong |
| 2 | Sửa thông tin cửa hàng bị sai (giờ, địa chỉ, số điện thoại) | ✅ Xong |
| 3 | Format trả lời sản phẩm cố định (tên/giá/SKU/xe/link) | ✅ Xong* |
| 4 | Xử lý khi model xe mơ hồ | ✅ Xong |
| 5 | Chỉ trả lời hội thoại đang mở, bỏ hội thoại đã đóng | ✅ Xử lý* |

<!-- ✏️ * = có ghi chú, xem mục "Lưu ý" bên dưới -->

**Cách hoạt động mới (triết lý #1):**
- Bot **mặc định im lặng**. Chỉ nhắn khi: tìm được **đúng 1 sản phẩm** / khách
  hỏi **giờ-địa chỉ** / **xác nhận giữ hàng**.
- Tin thiếu thông tin, mơ hồ, ngoài phạm vi, chào hỏi → **bot im, nhân viên lo**.
- Nhân viên nhắn tay vào cuộc → **bot tự ngừng**, không chen vào.

**Thông tin cửa hàng đã cố định trong bot:**
<!-- ✏️ Kiểm lại đúng chưa, sửa nếu cần -->
- Giờ: Thứ 2–6 9am–5pm, Thứ 7 9am–3pm, đóng cửa Chủ nhật
- Địa chỉ: 1911 Union St, Oakland, CA 94607
- Điện thoại: 510-451-2800 (chỉ nêu khi khách hỏi, không khuyên gọi)

---

## 2. Các lỗi quan trọng đã sửa (đợt trước)

<!-- ✏️ Giữ/bớt mục tùy mức chi tiết muốn cho khách thấy -->
| Nhóm | Nội dung |
|---|---|
| Chống bán trùng | Sửa lỗi 2 khách cùng giữ được món cuối — kiểm chứng 10 yêu cầu đồng thời |
| Giữ hàng buổi tối | Sửa lỗi hold sau 6PM bị hết hạn ngay |
| Tin nhắn lặp | Sửa lỗi bot gửi ~10 tin trùng khi khách gửi ảnh |
| Giọng điệu | Nhắn tự nhiên như người thật, bỏ "Reply STOP", không khuyên gọi điện |
| Trạng thái hội thoại | Sửa các lỗi bot trả lời chồng lên nhân viên |

<!-- ✏️ Con số: tổng 18 lỗi kỹ thuật + 9 yêu cầu chỉnh sửa đã xử lý. Sửa nếu muốn -->

---

## 3. Hệ thống đã lên server (production)

| Thành phần | Trạng thái |
|---|---|
| Bot chạy 24/7 trên server riêng, HTTPS bảo mật | ✅ |
| Kết nối kho hàng thật (74.000 sản phẩm) | ✅ |
| Đăng ký A2P (bắt buộc gửi SMS tại Mỹ) | ✅ Đã duyệt |
| Webhook (nhận tin từ số cửa hàng) | ✅ Đã trỏ đúng |

---

## 4. Còn lại trước khi bật cho khách thật

<!-- ✏️ Sửa theo tiến độ thực tế -->
| Việc | Ghi chú |
|---|---|
| Cập nhật plugin để hiện "link đặt hàng" trong tin | Đang chờ upload |
| Kiểm tra cuối — nhắn thử vài kịch bản với số thật | Cần làm chung với khách |

---

## Lưu ý (ghi chú kỹ thuật — có thể xóa khi gửi khách)

<!-- ✏️ Phần này cho nội bộ, cân nhắc xóa trước khi gửi khách -->
- **#3 (\*)**: "link đặt hàng" cần cập nhật plugin trên web mới hiển thị được;
  hiện đang rỗng, không ảnh hưởng bot chạy.
- **#5 (\*)**: hệ thống SMS (Quo) không cung cấp trạng thái Open/Done qua API,
  nên bot dùng cơ chế tự-chuyển-giao thay thế (nhân viên nhắn tay → bot ngừng).
- **Bảo mật cần làm:** đổi mật khẩu server + thu hồi khóa API cũ.

---

## Tóm tắt 1 câu

> Bot đã hoàn thành toàn bộ 5 yêu cầu chỉnh sửa gần nhất, đã lên server chạy thật
> với triết lý "chỉ trả lời khi chắc chắn 100%, không thì để nhân viên xử lý", và
> đang ở bước kiểm tra cuối trước khi bật cho khách hàng.
