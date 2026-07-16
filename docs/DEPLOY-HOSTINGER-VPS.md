# 🚀 Deploy bot lên Hostinger VPS (production)

> Dành cho khi Brandon mua Hostinger VPS. Ưu điểm so với Fly/Koyeb:
> - **Cùng nhà với website** oaklandbodyparts.com → gọi API inventory nhanh, quản lý 1 chỗ
> - **Chạy nguyên `docker-compose`** → cả `bot` + `cron` chạy được → GỠ LUÔN module #1
>   (hold-expiry + đóng TTL) mà KHÔNG cần sửa code
> - Toàn quyền kiểm soát, không lo nền tảng đổi chính sách (Fly, Koyeb đều đã đổi)
>
> Repo đã sẵn: Dockerfile + docker-compose.yml (bot + cron). Runbook thêm Caddy cho
> HTTPS (Quo webhook bắt buộc HTTPS).

---

## Bước 0 — Mua VPS + chuẩn bị

1. Hostinger → **VPS** → gói **KVM 1** (~$5-8/th, 4GB RAM — thừa cho bot)
2. Chọn **OS: Ubuntu 24.04** (có sẵn template)
3. Region: **US** (gần Oakland + gần server website)
4. Ghi lại **IP VPS** + mật khẩu root (hoặc SSH key)

## Bước 1 — SSH vào VPS + cài Docker

```bash
ssh root@<IP-VPS>

# Cài Docker + compose plugin (script chính thức)
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version   # xác nhận
```

## Bước 2 — Lấy code về VPS

```bash
apt-get update && apt-get install -y git
git clone https://github.com/KhaiHung1707/sms-chatbot.git
cd sms-chatbot
```

## Bước 3 — Tạo file .env trên server (KHÔNG commit)

```bash
nano .env
```
Dán 8 biến (lấy từ `.env.local` máy bạn — production nên dùng creds RIÊNG của Brandon):
```
DATABASE_URL=...
ANTHROPIC_API_KEY=...
LLM_MODEL=claude-haiku-4-5
QUO_API_KEY=...
QUO_WEBHOOK_SECRET=...
QUO_PHONE_NUMBER=+15104512800
INVENTORY_API_URL=https://oaklandbodyparts.com/wp-json/obp/v1
INVENTORY_API_KEY=...
```
Lưu: `Ctrl+O`, `Enter`, `Ctrl+X`.

## Bước 4 — Trỏ subdomain về VPS (cho HTTPS)

Trong DNS của oaklandbodyparts.com (quản lý ở Hostinger hoặc nhà cung cấp domain),
thêm 1 bản ghi:
```
Type: A    Name: sms    Value: <IP-VPS>    TTL: 3600
```
→ `sms.oaklandbodyparts.com` trỏ về VPS. Website chính KHÔNG bị ảnh hưởng (khác bản ghi).

Chờ DNS lan (vài phút–1h). Kiểm: `ping sms.oaklandbodyparts.com` ra đúng IP VPS.

## Bước 5 — Thêm Caddy cho HTTPS (tự cấp SSL miễn phí)

Dùng file compose production đã kèm sẵn (`docker-compose.prod.yml`) — nó thêm Caddy
đứng trước bot, tự lấy chứng chỉ Let's Encrypt cho subdomain.

Sửa domain trong `Caddyfile` (đã kèm repo) nếu khác `sms.oaklandbodyparts.com`.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Lệnh này chạy 3 container: **bot** (web) + **cron** (hold-expiry) + **caddy** (HTTPS).

## Bước 6 — Verify

```bash
docker compose -f docker-compose.prod.yml ps      # cả 3 "Up"
docker compose -f docker-compose.prod.yml logs bot | grep listening
curl https://sms.oaklandbodyparts.com/health      # {"status":"ok"}
```

## Bước 7 — Trỏ webhook Quo sang domain thật

Quo → Webhook → URL:
```
https://sms.oaklandbodyparts.com/webhooks/quo
```
Events: `message.received` + `message.delivered`. Save.

---

## Vận hành

| Việc | Lệnh (trong thư mục sms-chatbot trên VPS) |
|---|---|
| Xem log | `docker compose -f docker-compose.prod.yml logs -f bot` |
| Cập nhật code mới | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Restart | `docker compose -f docker-compose.prod.yml restart` |
| Tắt | `docker compose -f docker-compose.prod.yml down` |
| Xem cron chạy | `docker compose -f docker-compose.prod.yml logs cron` |

## Bảo mật VPS (nên làm)

```bash
# Firewall: chỉ mở 22 (SSH), 80, 443
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```
Cân nhắc: đổi SSH sang key-only, tạo user non-root.

---

## Vì sao VPS gỡ được module #1 (cron)

Trên Fly/Koyeb chỉ chạy 1 process (web) → cron không chạy → hold không hết hạn + bot im
lâu sau handoff. Trên VPS, `docker compose` chạy **service `cron` riêng** song song với
bot → hold-expiry + đóng TTL hoạt động → **auto-handoff trọn vẹn, hold tự nhả 6PM.**
Không cần sửa code — chỉ cần chạy đúng compose.

## So sánh nhanh (tham chiếu)

| | Hostinger VPS | Fly.io | Koyeb |
|---|---|---|---|
| Cron (compose) | ✅ chạy | ❌ phải gộp code | ❌ phải gộp code |
| Cùng nhà website | ✅ | ❌ | ❌ |
| Ổn định chính sách | ✅ | ⚠️ bỏ trial | ⚠️ Mistral mua |
| Chi phí | ~$5-8/th | ~$2-3/th | free (đang đổi) |
| Bạn đã quen | ✅ | 🟡 | 🟡 |
