# Việc cần làm thủ công — OBP SMS Assistant

> Danh sách các việc **không code được** — cần con người thao tác: tạo tài khoản,
> đăng ký dịch vụ, cấu hình bảng điều khiển, chạy migration, test với số thật.
> Middleware (repo này) đã sẵn sàng; những mục dưới đây là điều kiện để go-live.
>
> Ký hiệu: 🔴 chặn go-live · 🟡 cần trước Phase 2/production · 🟢 nên làm

---

## 1. Quo (SMS gateway) — 🔴 chặn go-live

- [ ] 🔴 **Lấy API key Quo** → điền `QUO_API_KEY` trong `.env`.
      Lưu ý: khi middleware gửi, header là `Authorization: <key>` **KHÔNG có
      `Bearer`** (đã code đúng, chỉ cần key hợp lệ).
- [ ] 🔴 **Đăng ký A2P 10DLC và chờ DUYỆT.** Nếu chưa duyệt, mọi tin gửi đi trả
      lỗi `400` (A2P Registration Not Approved). Đây là quy trình của nhà mạng,
      mất vài ngày–vài tuần. **Bắt đầu sớm nhất có thể.**
- [ ] 🔴 **Tạo webhook trong Quo** trỏ tới `https://<domain>/webhooks/quo`, sự kiện
      `message.received`. Để phát hiện staff tiếp quản tự động, đăng ký thêm
      `message.delivered` (xem mục Auto-handoff bên dưới).
- [ ] 🔴 **Lấy webhook signing secret** (base64) từ cấu hình webhook Quo →
      điền `QUO_WEBHOOK_SECRET`. Chữ ký xác thực trên `timestamp + "." + raw_body`.
- [ ] 🔴 **Xác nhận số điện thoại cửa hàng** `+15104512800` → điền `QUO_PHONE_NUMBER`
      (E.164, không dấu cách).
- [ ] 🟡 **Xác nhận credit/subscription còn hạn.** Prepaid — hết credit trả `402`,
      tin gửi fail (middleware log CRITICAL). Thiết lập cảnh báo số dư.
- [ ] 🟢 Xác nhận với Quo về **rate limit** (docs không nêu số cụ thể). Middleware
      đã xử lý phòng thủ (retry 429/5xx với backoff), nhưng nên biết ngưỡng thật.
- [ ] 🟡 **Xác minh payload `message.delivered` thật (auto-handoff C-01).**
      Middleware phân biệt tin bot gửi vs staff gửi bằng `provider_message_id`
      (tín hiệu tự kiểm soát — không đoán `userId`). Khi có sandbox Quo: capture
      1 event outbound do BOT gửi + 1 do STAFF gửi tay, đối chiếu với
      `parseInboundMessage`. Xác nhận cả hai đều mang `id` (provider_message_id).
      Nếu shape khác giả định → điều chỉnh `handleOutbound` trong pipeline.

## 2. Inventory API plugin (WordPress/WooCommerce) — 🔴 chặn go-live

> Deliverable PHP riêng. Spec đầy đủ ở [`docs/inventory-api-spec.md`](docs/inventory-api-spec.md).

- [ ] 🔴 **Bên PHP implement plugin** theo spec: bảng lookup denormalized có index
      `(make, model, year, part_type)`, endpoint `GET /wp-json/obp/v1/parts/search`.
- [ ] 🔴 **KHÔNG query `wp_postmeta` trực tiếp.** Với 74k sản phẩm, đây là yêu cầu
      cứng — nếu không sẽ timeout >8s trên Hostinger (xem rủi ro R-11).
- [ ] 🔴 **Nạp dữ liệu vào bảng lookup** (bulk import lần đầu qua WP-CLI, lưu mỗi
      năm áp dụng một dòng, chuẩn hoá lowercase).
- [ ] 🔴 **Chạy `EXPLAIN`** trên truy vấn tra cứu với bản sao dữ liệu 74k thật,
      xác nhận dùng index (không `type: ALL`). Đo p95 < 2s.
- [ ] 🔴 **Lấy Inventory API key** → điền `INVENTORY_API_KEY`; xác nhận URL
      `INVENTORY_API_URL`.
- [ ] 🟡 **Cơ chế re-sync bảng lookup** sau import CSV/ERP (import thường bypass
      CRUD hooks → bảng stale). Đặt lịch WP-Cron rebuild.
- [ ] 🟡 **Kiểm tra gói Hostinger.** Shared không có Redis; nếu truy vấn vẫn chậm,
      cân nhắc lên Cloud/VPS (mở khoá Redis, bỏ quota CPU fair-use). Xem R-11.
- [ ] 🟢 Cân nhắc dữ liệu fitment chuẩn ACES/PIES (submodel/engine/vị trí) nếu cần
      độ chính xác cao hơn YMM — cần subscription VCdb/PCdb (xem R-03).
- [ ] 🔴 **HỎI CLIENT: bán tại quầy (walk-in) cập nhật WooCommerce thế nào?**
      (Update 001 §6). Dùng POS gì? Trừ tồn tự động real-time hay nhập tay cuối
      ngày? Nếu WooCommerce trễ hàng giờ so với quầy vật lý thì `qty_from_api` đã
      stale ngay khi trả về — Rule 2 (trừ hold) không cứu được, phải phrasing bảo
      thủ hơn (luôn "as of right now", đẩy mạnh hold). Lấy trước go-live, không
      chặn phát triển.

## 3. Claude / Anthropic — 🔴 chặn go-live

- [ ] 🔴 **Lấy Anthropic API key** → điền `ANTHROPIC_API_KEY`.
- [x] 🟡 **Model đã chốt: `claude-haiku-4-5`** (`.env.local` LLM_MODEL). Đã test
      thật ở Mức 2 — Haiku trích xuất year/make/model + đa ngôn ngữ (VI/ES/typo)
      đủ tốt, confidence gate hoạt động → **không cần Sonnet**. Đổi `LLM_MODEL`
      trong `.env` nếu sau này cần tier cao hơn (không cần sửa code).
- [ ] 🟢 **Theo dõi chi phí token.** Middleware đã log token in/out mỗi lần gọi;
      thiết lập dashboard/ngưỡng cảnh báo.

## 4. Supabase (Database) — 🔴 chặn go-live

- [ ] 🔴 **Tạo project Supabase**, lấy connection string → điền `DATABASE_URL`.
- [ ] 🔴 **Chạy migration** `migrations/001_init.sql` trên Supabase:
      `psql "$DATABASE_URL" -f migrations/001_init.sql`
      (hoặc dùng migration runner khi khởi động — xem README).
- [ ] 🟢 Cấu hình backup/retention theo yêu cầu lưu trữ audit (`part_lookups`).

## 5. Deploy — 🔴 chặn go-live

- [ ] 🔴 **Chuẩn bị VPS** (Hetzner/DO), cài Docker + docker-compose.
- [ ] 🔴 **Tạo file `.env` thật** trên server từ `.env.example` (KHÔNG commit).
- [ ] 🔴 **Cấu hình HTTPS + domain** cho endpoint webhook (Quo yêu cầu HTTPS).
      Reverse proxy (Caddy/nginx) hoặc load balancer.
- [ ] 🔴 **`docker compose up -d`** — chạy service `bot` + `cron`.
- [ ] 🟡 Xác nhận **múi giờ container** không ảnh hưởng (hold expiry đã tính qua
      `Intl` + `SHOP_TIMEZONE`, không phụ thuộc giờ hệ thống — nhưng nên set
      `TZ=UTC` cho nhất quán log).
- [ ] 🟢 Thiết lập **giám sát** (uptime, `/health`, log aggregation).

## 6. Test thủ công cuối (cùng client) — 🔴 chặn go-live

> Không thể tự động hoá — cần số thật + người thật chạy checklist.

- [ ] 🔴 **ngrok + Quo sandbox/số thật**: chạy toàn bộ checklist Phase 1 với
      Brandon (happy path, follow-up, STOP, HELP, MMS, staff tiếp quản, đa ngôn ngữ).
- [ ] 🔴 **Test đa ngôn ngữ thật**: nhắn tiếng VI/ES/ZH, xác nhận bot trả đúng
      ngôn ngữ (đây là chỗ sai chính tả + slang bào mòn độ chính xác — R-01/R-04).
- [ ] 🔴 **Test confidence gate**: nhắn "95 Accord bumper" (thiếu front/rear),
      xác nhận bot HỎI LẠI và đọc lại xe trước khi báo giá, không tự đoán.
- [ ] 🟡 **Test giá khớp thật**: so giá bot trả với giá thật trên WooCommerce cho
      vài SKU — guardrail vàng.
- [ ] 🟡 **Test hold hết hạn 6PM Oakland**: tạo hold, xác nhận cron đổi trạng thái
      đúng giờ địa phương (chú ý quanh mốc DST).

## 7. Pháp lý / tuân thủ — 🔴 chặn go-live

- [ ] 🔴 **A2P 10DLC** (đã nêu ở mục Quo) — bắt buộc để gửi SMS thương mại tại US.
- [ ] 🔴 **Xác nhận cơ chế opt-out (STOP)** hoạt động end-to-end trước khi bật cho
      khách thật — bỏ sót có thể vi phạm TCPA (R-15).
- [ ] 🟢 Rà soát nội dung tin tự động với yêu cầu tuân thủ của nhà mạng (không spam,
      có thông tin cửa hàng, có hướng dẫn opt-out ở tin đầu — đã code sẵn).

---

## Ghi chú

- Mọi biến môi trường cần điền nằm trong [`.env.example`](.env.example).
- Middleware **fail an toàn**: thiếu key → crash lúc khởi động (fail-fast, không
  chạy nửa vời); API lỗi → trả lời xin lỗi không chứa số.
- Cập nhật file này khi hoàn thành từng mục.
