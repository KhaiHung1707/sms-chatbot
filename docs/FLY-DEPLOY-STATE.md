# Trạng thái deploy Fly.io — OBP SMS Bot

> Ghi lại để bật/tắt/deploy lại không phải nhớ. Cập nhật khi có thay đổi.

## Thông tin app

| | |
|---|---|
| App name | `sms-chatbot` |
| URL | `https://sms-chatbot.fly.dev` |
| Webhook endpoint | `https://sms-chatbot.fly.dev/webhooks/quo` |
| Health | `https://sms-chatbot.fly.dev/health` → `{"status":"ok"}` |
| Region | `iad` (US East) |
| GitHub | `https://github.com/KhaiHung1707/sms-chatbot` (branch `main`) |
| Port | **3000** (khớp Dockerfile + fly.toml `internal_port`) |

## Trạng thái hiện tại (2026-07-15)

🔴 **TẮT** — `fly scale count 0` (tiết kiệm tài nguyên, chưa go-live).
Đã test thành công: bot sống, nhận webhook có chữ ký thật → `{"status":"accepted"}`,
gọi Claude + inventory thật OK. Xác thực chữ ký hoạt động (tin không ký → 401).

## Chuẩn bị PATH mỗi lần dùng fly (terminal mới)
```bash
cd "/Volumes/Không có tiêu đề/Brandon/obp-sms-bot"
export PATH="$HOME/.fly/bin:$PATH"
```

## Lệnh thường dùng

| Việc | Lệnh |
|---|---|
| **Bật lại bot** | `fly scale count 1` |
| **Tắt bot** | `fly scale count 0` |
| Xem trạng thái | `fly status` |
| Xem log realtime | `fly logs` |
| Deploy code mới | `git push` rồi `fly deploy` |
| Liệt kê secrets (chỉ tên) | `fly secrets list` |
| Nạp lại secrets | `fly secrets import < .env.local` |

## Test không cần điện thoại
```bash
# Gửi tin giả có chữ ký THẬT tới bot production:
./scripts/send-prod.sh "+15105559100" "front bumper for a 2015 Honda Accord"
# Xem bot xử lý: fly logs (terminal khác)
```

## Còn lại để GO-LIVE

1. Bật bot: `fly scale count 1`
2. Trỏ webhook Quo → `https://sms-chatbot.fly.dev/webhooks/quo`
   (events: `message.received` + `message.delivered`)
3. (Tùy chọn) Trỏ subdomain `sms.oaklandbodyparts.com` → Fly thay vì dùng `*.fly.dev`
4. Test với số thật cùng Brandon
5. ⚠️ Service `cron` (hold-expiry) chưa chạy trên Fly — cần xử lý riêng
   (Fly chỉ chạy Dockerfile CMD, không dùng docker-compose). Xem note dưới.

## Note kỹ thuật

- **Cron chưa chạy:** `docker-compose.yml` có service `cron` (`dist/jobs/expiry.js`)
  nhưng Fly.io chỉ chạy `CMD` của Dockerfile (`node dist/index.js`). Hold-expiry +
  đóng conversation TTL sẽ KHÔNG tự chạy. Cách khắc phục khi go-live: dùng Fly
  scheduled machine, hoặc thêm process group trong fly.toml, hoặc chạy cron nội bộ
  trong app. Chưa chặn test, nhưng phải làm trước khi khách dùng thật.
- **Secrets** không nằm trong git (đúng). Nếu tạo app Fly mới phải `fly secrets import`
  lại từ `.env.local`.
