# A2P 10DLC — Checklist đăng ký (cho Quo)

> **Mục đích:** đăng ký brand + campaign để gửi SMS thương mại tại US qua Quo.
> **Ai làm:** Brandon / người có tài khoản Quo + thông tin doanh nghiệp.
> **🔴 Đây là đường tới hạn (critical path) — bắt đầu SỚM NHẤT.**

## Vì sao gấp

Từ **1/2/2025**, các nhà mạng lớn US **BLOCK 100%** tin 10DLC chưa đăng ký — không
throttle nữa, mà chặn hẳn. Chưa đăng ký = tin **không tới** khách. Timeline 2026:
- Brand approval: **1–3 ngày làm việc**
- Campaign review: **~10–15 ngày** (tồn đọng cao giữa 2026)

→ Tổng ~2–3 tuần. Không thể go-live trước khi campaign được duyệt.

---

## Bước 1 — Thông tin doanh nghiệp cần chuẩn bị (Brand)

- [ ] **Tên pháp lý** doanh nghiệp (đúng như trên giấy tờ thuế)
- [ ] **EIN** (Employer Identification Number) — mã số thuế liên bang
- [ ] **Địa chỉ đăng ký** kinh doanh
- [ ] **Website** chính thức (oaklandbodyparts.com)
- [ ] **Ngành nghề** (auto parts retail)
- [ ] **Người liên hệ** (tên, email, số điện thoại)
- [ ] Loại hình (LLC / Corp / Sole Proprietor…)

> Lưu ý: tên + EIN + địa chỉ phải **khớp chính xác** hồ sơ IRS, sai một chữ có thể
> bị từ chối brand.

---

## Bước 2 — Đăng ký Campaign (use case)

- [ ] **Use case:** chọn **Customer Care** (chăm sóc khách hàng) — nhận trust score
      cao hơn, là "essential business communication". **KHÔNG chọn Marketing/Promo**
      vì bot chỉ trả lời hỏi giá/tồn/pickup, không gửi khuyến mãi.

- [ ] **Campaign description — PHẢI cụ thể.** Mô tả chung chung ("notifications",
      "customer updates") **bị từ chối**. Dùng bản dưới (chỉnh nếu cần):

  > *"Two-way customer support for an auto parts store. Customers text our
  > published number to ask about part availability, prices, and in-store pickup.
  > An automated assistant replies with real inventory information and can place
  > a same-day hold on an item at the customer's request. All conversations are
  > customer-initiated."*

- [ ] **Sample messages** — cung cấp 2–4 tin mẫu ĐÚNG với bot thật gửi. Ví dụ:

  1. *"Front bumper for a 1995 Honda Accord is $129.95, 4 available for pickup at 1911 Union St, Oakland. Reply STOP to opt out."*
  2. *"Got it — front bumper for a 1995 Honda Accord? Reply yes to check price."*
  3. *"1 left as of right now — stock changes through the day, so I'd recommend a hold. Want me to hold it until 6 PM today?"*
  4. *"You have been unsubscribed. Reply HELP for contact info."*

- [ ] **Opt-in mô tả** — khách nhắn trước (customer-initiated), tin đầu tiên có
      "Reply STOP to opt out" (đã code sẵn trong bot). Mô tả rõ luồng consent:

  > *"Consent is obtained when the customer initiates contact by texting our
  > number, which is published in-store and on our website. Every first reply
  > includes opt-out instructions (Reply STOP)."*

- [ ] **Opt-out & HELP** — xác nhận với reviewer: STOP → im lặng vĩnh viễn,
      HELP → thông tin cửa hàng (đã code sẵn — guardrail R-15).

- [ ] **Volume ước tính** — số tin/ngày dự kiến (khai thật, không phóng đại).

---

## Bước 3 — Sau khi được duyệt

- [ ] Xác nhận số **510-451-2800** đã gắn với campaign đã duyệt trong Quo.
- [ ] Test gửi 1 tin thật qua số đó — nếu vẫn trả `400 A2P Registration Not
      Approved` nghĩa là số chưa link đúng campaign.
- [ ] Chỉ khi gửi thành công mới chuyển sang test thủ công cuối (GĐ4) với khách thật.

---

## Bẫy thường gặp (tránh bị từ chối / suspend)

- **Mô tả chung chung** → từ chối. Phải nêu cụ thể "AI assistant trả lời hỏi giá/tồn
  phụ tùng ô tô", không phải "gửi thông báo".
- **Gửi sai use case** → suspend. Đã đăng ký Customer Care thì **không được gửi
  khuyến mãi**. Bot hiện chỉ trả lời trong phạm vi — giữ nguyên, đừng thêm promo.
- **Opt-in URL/consent chết** → carrier re-verify bất cứ lúc nào; nếu trang consent
  hoặc mô tả thay đổi lớn → campaign bị suspend. Giữ thông tin ổn định.
- **Tên/EIN lệch hồ sơ IRS** → từ chối brand.

---

## Nguồn tham khảo

- [Quo — What Is A2P 10DLC and How to Get Registered in 2026](https://www.quo.com/blog/what-is-a2p-10dlc/)
- [10DLC Registration Guide (2026) — txtimpact](https://www.txtimpact.com/blog/a2p-10dlc-registration-guide)
- [A2P 10DLC Compliance in 2026 — Apten](https://www.apten.ai/blog/a2p-dlc-compliance-2026)
- [Twilio — A2P 10DLC quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart)
