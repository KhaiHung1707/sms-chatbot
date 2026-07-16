# OBP SMS Assistant — Báo cáo tình trạng & Roadmap module

> Cập nhật: 2026-07-16 · Đánh giá dựa trên rà soát toàn bộ 27 file source + test thật (Level 3).

## Tóm tắt điều hành

Bot **~85% sẵn sàng go-live**. Phần lõi (AI, inventory thật, holds, handoff) đã hoàn
thiện và được kiểm chứng end-to-end với dịch vụ THẬT (Claude + Postgres + WooCommerce
74k sản phẩm). Đã deploy chạy 24/7 trên Fly.io. Còn lại là các module vận hành & an
toàn — trong đó **1 module chặn go-live thật** (cron/expiry).

**59 test tự động pass · typecheck sạch · deploy Fly.io hoạt động.**

---

## ✅ Module đã hoàn thiện (verified với dịch vụ thật)

| Module | Trạng thái | Kiểm chứng |
|---|---|---|
| Core pipeline (agentic loop, Claude Haiku) | ✅ Xong | Level 3, cap 3 tool rounds |
| Inventory API (74k sản phẩm thật) | ✅ Xong | Giá/tồn thật từ WooCommerce |
| Holds + chống bán-trùng | ✅ Xong | Transaction atomic, DB xác nhận đúng 1 hold |
| **Auto-handoff** (nhân viên tiếp quản → bot im) | ✅ Xong | Bug đã sửa 16/07, verified 3 bước |
| Confidence gate (xác nhận xe trước báo giá) | ✅ Xong | Test đa lượt |
| Update 001 — Rule 1/2/3 (no-cache, effective_qty, honest stock) | ✅ Xong | "1 left as of right now" verified |
| STOP/HELP, dedupe webhook, đa ngôn ngữ (VI/ES/typo) | ✅ Xong | 59 test |
| Quo SMS (retry/backoff, 402 out-of-credit) | ✅ Xong | Unit test |
| Deploy Fly.io (24/7, HTTPS, secrets) | ✅ Xong | /health 200, webhook 401 chữ ký |
| Plugin WooCommerce (no-SSH admin, rebuild qua web) | ✅ Xong | 68.9k SP → 110k lookup rows |

---

## 🔴 Module cần làm — theo ưu tiên

### 🔴 P0 — CHẶN GO-LIVE

#### 1. Cron/expiry không chạy trên Fly  ⚠️ nghiêm trọng nhất
- **Hiện trạng:** logic hold-expiry + đóng conversation TTL nằm ở `src/jobs/expiry.ts`,
  thiết kế chạy như container riêng (`cron` service trong docker-compose). Nhưng Fly.io
  chỉ chạy `index.ts` (web server) → **cron KHÔNG chạy**.
- **Hậu quả thật:**
  - Hold không tự hết hạn 6PM → tồn kho bị khóa sai, khách khác không mua được.
  - Conversation không bao giờ đóng → **sau khi nhân viên tiếp quản, bot im VĨNH VIỄN**
    (kể cả khách quay lại tuần sau hỏi việc khác). Đây là hệ quả trực tiếp, khách gặp ngay.
- **Đề xuất:** gộp expiry sweep vào `index.ts` (chạy `setInterval` ngay trong web
  process). ~15-20 dòng. Đơn giản, 1 process, hợp mô hình Fly.
- **Ước lượng:** nhỏ (nửa buổi gồm test).

#### 2. Trả bot lại sau handoff
- **Hiện trạng:** handoff một chiều — nhân viên nhảy vào thì bot im tới khi TTL đóng (2h).
  Phụ thuộc #1; nếu cron không chạy thì im vĩnh viễn.
- **Đề xuất:** (a) sửa #1 để TTL tự đóng (đủ cho MVP), hoặc (b) thêm lệnh nội bộ để nhân
  viên chủ động trả bot. Tối thiểu (a) bắt buộc.

### 🟡 P1 — Nên có trước khi khách dùng nhiều

#### 3. Dashboard/route cho nhân viên
- **Hiện trạng:** chỉ có `/health` + `/webhooks/quo`. Không có nơi xem hội thoại đang
  hoạt động / đã handoff / lịch sử.
- **Đề xuất:** route `GET /conversations` (có auth) hiển thị trạng thái + tin gần nhất.
- **Ước lượng:** vừa.

#### 4. Verify payload Quo thật cho handoff
- **Hiện trạng:** cách Quo gắn `provider_message_id`/`userId` trên `message.delivered`
  MỚI test bằng payload giả, chưa đối chiếu payload Quo THẬT.
- **Đề xuất:** khi test với Brandon, nhân viên nhắn tay 1 tin → capture event thật →
  đối chiếu giả định. Nếu khác → chỉnh `handleOutbound`.
- **Rủi ro nếu bỏ qua:** handoff có thể không kích hoạt trên production.

### 🟢 P2 — Cải thiện vận hành

#### 5. Monitoring & cảnh báo
- Token cost, lỗi API inventory, số dư Quo (402 hết credit → tin fail). Hiện chỉ log,
  chưa có cảnh báo chủ động.
- **Đề xuất:** ngưỡng cảnh báo (email/Slack) cho 402, api_error, chi phí bất thường.

#### 6. Rate limit outbound
- Có sẵn `countOutboundToCustomer` nhưng chưa dùng để chặn. Nên đảm bảo không spam 1
  khách (an toàn + tuân thủ carrier).

---

## Rủi ro vận hành ngoài code (nhắc lại)

- **A2P 10DLC:** ✅ đã duyệt trong tài khoản Quo của Brandon.
- **Subdomain:** đang dùng `sms-chatbot.fly.dev`. Có thể trỏ `sms.oaklandbodyparts.com`
  → Fly cho chuyên nghiệp (tùy chọn, không chặn).
- **Bảo mật:** credentials dev đã dán trong chat (khóa Anthropic + DB) — nên rotate;
  production dùng credentials riêng của Brandon. Chi tiết `docs/SECURITY-URGENT.md`.
- **Bot đang TẮT trên Fly** (`fly scale count 0`) để tiết kiệm — bật bằng `fly scale count 1`.

---

## Đề xuất thứ tự làm tiếp

1. **#1 + #2 (cron)** — chặn go-live, fix nhỏ, gỡ 2 vấn đề cùng lúc. **Làm trước.**
2. **#4 (verify payload Quo)** — làm trong buổi test cùng Brandon.
3. **#3 (dashboard)** — trước khi lượng khách tăng.
4. **#5, #6** — sau go-live, cải thiện dần.

Sau #1, #2, #4 → **đủ điều kiện go-live an toàn**.
