# Deploy: cập nhật bot lên VPS (thêm trang /admin)

> Cho VPS đã chạy bot. Bạn SSH vào VPS và chạy các lệnh dưới.
> Thay đổi lần này: thêm trang `/admin` + fix nhỏ. Cần thêm 2 biến env mới.

---

## Bước 0 — SSH vào VPS
```bash
ssh <user>@<vps-ip>
cd <thư-mục-chứa-bot>      # nơi có docker-compose.prod.yml, ví dụ ~/obp-sms-bot
```

## Bước 1 — Lấy code mới
```bash
git pull origin main
```
Kỳ vọng: kéo về commit mới nhất (có "Admin instructions" + ".env.example ADMIN_").

## Bước 2 — Thêm 2 biến ADMIN vào .env (QUAN TRỌNG)
Bot sẽ **KHÔNG khởi động** ở production nếu thiếu `ADMIN_PASSWORD`.
Mở .env và thêm 2 dòng (đổi mật khẩu thành chuỗi mạnh ≥12 ký tự của bạn):
```bash
nano .env
```
Thêm vào cuối:
```
ADMIN_USERNAME=brandon
ADMIN_PASSWORD=<đặt-mật-khẩu-mạnh-≥12-ký-tự>
```
Lưu (Ctrl+O, Enter, Ctrl+X).

> 💡 Tạo mật khẩu ngẫu nhiên nhanh: `openssl rand -base64 18`

## Bước 3 — Rebuild + restart container
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Lệnh này build lại image (có code mới) và khởi động lại bot + cron + caddy.
Migration 004 (bảng instruction_versions) tự chạy khi bot boot, seed v1.

## Bước 4 — Kiểm bot sống
```bash
docker compose -f docker-compose.prod.yml ps          # cả 3 service Up
docker compose -f docker-compose.prod.yml logs bot --tail 30
```
Trong log kỳ vọng thấy: "migration applied 004..." (lần đầu), "seeded instruction_versions v1", "Listening". KHÔNG được thấy lỗi "ADMIN_PASSWORD is required".

## Bước 5 — Test trang admin (từ máy bạn hoặc trình duyệt)
Mở: `https://sms.oaklandbodyparts.com/admin`
- Phải hiện trang login (Username + Password).
- Đăng nhập bằng brandon + mật khẩu vừa đặt.
- Thấy editor 7 step + preview + dashboard.

Hoặc test nhanh bằng curl (từ máy bạn):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sms.oaklandbodyparts.com/admin/login
# kỳ vọng 200
curl -s -o /dev/null -w "%{http_code}\n" https://sms.oaklandbodyparts.com/admin
# kỳ vọng 302 (redirect về login khi chưa đăng nhập)
```

## Bước 6 — Xác nhận bot SMS vẫn chạy bình thường
Trang admin không đụng luồng SMS. Nhưng để chắc:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sms.oaklandbodyparts.com/health
# kỳ vọng 200
```
Và gửi 1 tin test tới số Quo (nếu muốn) — bot phải trả lời như cũ.

---

## Nếu lỗi

| Triệu chứng | Xử lý |
|---|---|
| Log: "ADMIN_PASSWORD is required in production" | Chưa thêm vào .env → làm lại Bước 2, rồi `up -d --build` |
| `/admin` trả 404 | ADMIN_PASSWORD rỗng/thiếu (admin bị tắt) → kiểm .env |
| Container bot restart liên tục | `logs bot` xem lỗi; thường do 1 biến .env sai |
| Caddy không cấp HTTPS | DNS A record của sms.oaklandbodyparts.com phải trỏ đúng IP VPS |
| git pull xung đột | `git stash` rồi `git pull` (nếu có sửa tay trên VPS) |

## Rollback (nếu cần quay lại bản cũ)
```bash
git log --oneline -5           # tìm commit cũ
git checkout <commit-cũ>
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Báo tôi sau khi chạy
1. `docker compose ps` — cả 3 service Up chưa?
2. `/admin/login` trả 200 chưa?
3. Đăng nhập được không?
→ Tôi verify cùng bạn.
