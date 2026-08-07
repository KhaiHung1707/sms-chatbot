# 🚀 Deploy — OBP SMS Bot (VPS) + Inventory Plugin

> Tài liệu deploy DUY NHẤT. Gồm 2 phần độc lập:
> - **A. Bot** (Node middleware) — chạy trên VPS bằng Docker Compose.
> - **B. Plugin inventory** — chạy trên WordPress (oaklandbodyparts.com), không SSH.
>
> Kiến trúc bot trên VPS: `bot` (web) + `cron` (hết hạn hold / đóng hội thoại) +
> `caddy` (HTTPS tự động cho webhook Quo). Xem docker-compose.prod.yml.

---

# A. BOT — deploy lên VPS

## A0. Yêu cầu (lần đầu)
- VPS (Hostinger/Hetzner/DO...) có Docker + Docker Compose.
- DNS: bản ghi A của `sms.oaklandbodyparts.com` trỏ về IP VPS.
- File `.env` đầy đủ (xem `.env.example`).

## A1. Lần đầu — clone + cấu hình
```bash
ssh <user>@<vps-ip>
git clone https://github.com/KhaiHung1707/sms-chatbot.git obp-sms-bot
cd obp-sms-bot
cp .env.example .env
nano .env        # điền TẤT CẢ giá trị thật (xem bảng biến bên dưới)
```

## A2. Cập nhật (đã deploy rồi, đẩy code mới)
```bash
ssh <user>@<vps-ip>
cd obp-sms-bot
git pull origin main
nano .env        # CHỈ khi có biến MỚI (xem changelog cuối file)
docker compose -f docker-compose.prod.yml up -d --build
```

## A3. Biến .env bắt buộc
| Biến | Ghi chú |
|---|---|
| ANTHROPIC_API_KEY | Key Claude. **Hết credit = bot ngừng trả lời** — nạp ở console.anthropic.com |
| LLM_MODEL | claude-haiku-4-5 |
| QUO_API_KEY / QUO_WEBHOOK_SECRET / QUO_PHONE_NUMBER | Từ Quo (OpenPhone) |
| INVENTORY_API_URL | https://oaklandbodyparts.com/wp-json/obp/v1 |
| INVENTORY_API_KEY | Khớp key đặt trong plugin (phần B) |
| DATABASE_URL | Chuỗi Supabase Postgres |
| SHOP_TIMEZONE / SHOP_ADDRESS / CONVERSATION_TTL_HOURS / HOLD_EXPIRY_HOUR | Cấu hình shop |
| **ADMIN_USERNAME** | Đăng nhập /admin (mặc định `brandon`) |
| **ADMIN_PASSWORD** | ⚠️ **BẮT BUỘC ở production** — thiếu là bot KHÔNG khởi động. ≥12 ký tự. Tạo: `openssl rand -base64 18` |
| NODE_ENV | `production` |
| PORT | 3000 (Caddy publish 443 → bot:3000) |

## A4. Kiểm tra sau deploy
```bash
docker compose -f docker-compose.prod.yml ps            # 3 service Up
docker compose -f docker-compose.prod.yml logs bot --tail 30
```
Log kỳ vọng: `migration applied`, `seeded instruction_versions v1`, `Listening`.
KHÔNG được thấy: `ADMIN_PASSWORD is required in production`.

Test từ máy bạn:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sms.oaklandbodyparts.com/health        # 200
curl -s -o /dev/null -w "%{http_code}\n" https://sms.oaklandbodyparts.com/admin/login   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://sms.oaklandbodyparts.com/admin         # 302 (chưa login)
```

## A5. Migration
Migration tự chạy khi bot boot (tạo bảng, seed instruction v1). Không cần lệnh riêng.

## A6. Rollback bot
```bash
git log --oneline -5
git checkout <commit-cũ>
docker compose -f docker-compose.prod.yml up -d --build
```

---

# B. PLUGIN INVENTORY — deploy lên WordPress (KHÔNG SSH)

> Hostinger shared hosting không có SSH. Dùng WP Admin + File Manager.
> Plugin có sẵn trang Admin (Tools → OBP Inventory) thay cho wp-cli.

## B1. Upload plugin
1. Nén (hoặc dùng zip có sẵn `obp-inventory-plugin-vX.Y.Z.zip`) — cấu trúc gốc phải là
   thư mục `obp-inventory-plugin/`.
2. WP Admin → **Plugins → Add New → Upload Plugin** → chọn zip → **Install Now** →
   **"Replace current with uploaded"** → **Activate**.
   - Nếu bị chặn dung lượng: **Hostinger File Manager** → giải nén đè lên
     `public_html/wp-content/plugins/obp-inventory-plugin/`.
3. **Kiểm version:** Tools → OBP Inventory → tiêu đề hiện `vX.Y.Z`. Đúng version mới
   = upload thành công.

## B2. Khi nào cần REBUILD lookup table
| Loại thay đổi | Cần rebuild? |
|---|---|
| Đổi cách INDEX part_type (vd thêm keyword title) | ✅ CÓ — Tools → OBP Inventory → **Rebuild now** |
| Chỉ đổi QUERY / RESPONSE (vd thêm features, synonym) | ❌ KHÔNG — upload là đủ |

> ⚠️ **Rebuild KHÔNG upload code** — nó chỉ dựng lại bảng từ code đang có trên server.
> Muốn code mới có hiệu lực: **UPLOAD trước, rồi mới rebuild (nếu cần)**.

## B3. API key (lần đầu)
Tools → OBP Inventory → mục "API key" → dán chuỗi ngẫu nhiên dài → Save.
Chuỗi này phải KHỚP `INVENTORY_API_KEY` trong .env của bot.

## B4. Verify plugin
```bash
# thay <KEY> bằng INVENTORY_API_KEY
curl -s -H "X-OBP-Api-Key: <KEY>" \
  "https://oaklandbodyparts.com/wp-json/obp/v1/parts/search?year=2015&make=toyota&model=camry&part=front%20bumper" | head -c 300
# kỳ vọng: JSON có results[], mỗi item có features[] (từ v1.2.0)
```

---

# Changelog deploy (biến/rebuild cần lưu ý)

| Ngày | Thay đổi | Cần khi cập nhật |
|---|---|---|
| 2026-08 | Bot: trang /admin | Thêm `ADMIN_USERNAME` + `ADMIN_PASSWORD` vào .env |
| 2026-08 | Plugin v1.2.1: synonym "front/rear bumper cover\|assembly" | Upload plugin. **Không rebuild.** |
| 2026-08 | Plugin v1.2.0: search trả `features[]` | Upload plugin. **Không rebuild.** |
| 2026-08 | Plugin v1.1.0: part-match (headlight/grill/side mirror) | Upload plugin + **REBUILD.** |
| 2026-08 | Bot: rule không đoán variant + liệt kê SP trùng + quote có Features | Deploy bot (git pull + rebuild container) |

---

# Sự cố thường gặp
| Triệu chứng | Xử lý |
|---|---|
| Bot log "ADMIN_PASSWORD is required" | Thêm ADMIN_PASSWORD vào .env → `up -d --build` |
| /admin trả 404 | ADMIN_PASSWORD rỗng → admin bị tắt; kiểm .env |
| Preview/bot "Bot stayed quiet" mọi lúc | Hết credit Anthropic → nạp ở console.anthropic.com |
| Container bot restart liên tục | `logs bot` xem biến .env nào sai |
| Caddy không cấp HTTPS | DNS A record sms.oaklandbodyparts.com chưa trỏ đúng IP |
| Plugin: search thiếu features | Chưa upload v1.2.0 (kiểm version ở Tools → OBP Inventory) |
| Plugin: part tìm 0 dù đúng | Chưa rebuild sau v1.1.0, hoặc chưa upload |
