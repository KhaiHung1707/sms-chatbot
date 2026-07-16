# 🚀 Deploy bot lên Koyeb (thay Fly.io)

> Fly.io bỏ free trial → chuyển sang Koyeb: free 1 web service chạy 24/7 KHÔNG ngủ,
> HTTPS sẵn, deploy thẳng từ GitHub. Repo đã sẵn sàng (Dockerfile + bind 0.0.0.0).
> Không cần đổi code. Không cần thẻ để bắt đầu free tier.

## Chuẩn bị (đã xong)
- ✅ Code trên GitHub: `github.com/KhaiHung1707/sms-chatbot` (branch `main`)
- ✅ Dockerfile (multi-stage, `CMD node dist/index.js`)
- ✅ Bot bind `0.0.0.0`, đọc `PORT` env
- ✅ 8 secrets sẵn trong `.env.local` (KHÔNG commit — nhập tay trên Koyeb)

---

## Bước 1 — Tạo tài khoản + app

1. Vào <https://app.koyeb.com> → đăng ký (login bằng GitHub cho tiện)
2. **Create App** → **GitHub** → chọn repo `sms-chatbot`, branch `main`
3. Koyeb tự phát hiện **Dockerfile** → chọn **Dockerfile** làm build method
   (KHÔNG chọn Buildpack)

## Bước 2 — Cấu hình service

| Mục | Giá trị |
|---|---|
| **Instance type** | `Free` (Nano) |
| **Regions** | `Washington, D.C.` (us-east) hoặc gần nhất |
| **Port** | **3000** ⚠️ (khớp Dockerfile — xem lưu ý dưới) |
| **Health check path** | `/health` |
| **Scaling** | Min 1 / Max 1 (luôn chạy, không ngủ) |

⚠️ **Port PHẢI = 3000.** Koyeb mặc định 8000 — sửa trong phần **Exposing your service /
Ports** thành `3000`, health check path `/health`. Nếu để 8000, health check fail
(giống lỗi port 8080 ở Fly trước đây).

## Bước 3 — Nhập secrets (Environment variables)

Trong phần **Environment variables**, thêm **8 biến** (lấy value từ `.env.local`).
Đánh dấu các biến nhạy cảm là **Secret** (Koyeb mã hóa):

```
DATABASE_URL          = <từ .env.local>   [Secret]
ANTHROPIC_API_KEY     = <từ .env.local>   [Secret]
LLM_MODEL             = claude-haiku-4-5
QUO_API_KEY           = <từ .env.local>   [Secret]
QUO_WEBHOOK_SECRET    = <từ .env.local>   [Secret]
QUO_PHONE_NUMBER      = +15104512800
INVENTORY_API_URL     = https://oaklandbodyparts.com/wp-json/obp/v1
INVENTORY_API_KEY     = <từ .env.local>   [Secret]
```

> ⚠️ Thiếu bất kỳ biến bắt buộc nào → bot fail-fast, thoát code 1 (như lỗi Fly lần đầu).
> Phải đủ cả 8.

## Bước 4 — Deploy

Bấm **Deploy**. Koyeb build Docker + chạy. Xem tab **Logs**, chờ dòng:
```
{"...","port":3000,"msg":"obp-sms-bot listening"}
```

## Bước 5 — Lấy URL + verify

Koyeb cấp URL dạng `https://<app>-<org>.koyeb.app`. Kiểm:
```
https://<app>.koyeb.app/health   →  {"status":"ok"}
```
Nếu ra `{"status":"ok"}` → bot sống trên Koyeb ✓

## Bước 6 — Trỏ webhook Quo sang Koyeb

Trong Quo → Webhook → đổi URL thành:
```
https://<app>.koyeb.app/webhooks/quo
```
Events: `message.received` + `message.delivered` (cho auto-handoff). Save.

---

## Test không cần điện thoại

Từ máy bạn (script ký bằng secret thật):
```bash
URL=https://<app>.koyeb.app ./scripts/send-prod.sh "+15105559100" "front bumper for a 2015 Honda Accord"
```
→ `{"status":"accepted"}` = bot nhận + verify chữ ký OK. Xem xử lý trong Koyeb Logs.

---

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Health check fail, app restart | Port sai (không phải 3000) hoặc chưa bind 0.0.0.0 | Đặt Port=3000; code đã bind 0.0.0.0 (commit mới) |
| `exited with code 1` trong log | Thiếu env var | Kiểm đủ 8 biến |
| Webhook Quo báo lỗi | Bot chưa sống / URL sai | Verify /health trước, đúng đuôi /webhooks/quo |
| Tin thật bị 401 | QUO_WEBHOOK_SECRET lệch | Đúng value từ .env.local |

---

## So với Fly (tham chiếu)

- Koyeb đọc **Dockerfile trực tiếp** → KHÔNG cần `fly.toml`.
- Free tier Koyeb **không ngủ** (khác Render free) → webhook Quo không bị miss.
- Nếu sau này chuyển nền tảng lần nữa: cùng Dockerfile + repo, chỉ nhập lại 8 env.

## ⚠️ Vẫn còn: cron/expiry (module #1 trong STATUS-REPORT)

Koyeb chạy 1 process (web) — hold-expiry + đóng TTL vẫn CHƯA chạy (giống Fly). Cần gộp
cron vào web process trước khi go-live thật. Xem `docs/STATUS-REPORT.md` module #1.
