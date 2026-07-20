# Update 002 — Plan implement (5 yêu cầu Brandon)

> Ngày: 2026-07-18 · Trạng thái: **CHỜ DUYỆT / IMPLEMENT**
> Nguồn: feedback Brandon sau khi test bot với khách thật.
> Tóm tắt: 2 việc tầng prompt, 2 việc tầng logic, 1 việc tầng webhook filter.

---

## Yêu cầu #1 — Chỉ trả lời khi CHẮC CHẮN 100%, không thì IM 🔴

**Triết lý mới:** SMS ≠ chat. Bot **mặc định KHÔNG trả lời**; chỉ trả lời khi chắc
chắn tuyệt đối. Không chắc → im lặng, để office trả lời thủ công. (Đã chốt: im HOÀN
TOÀN, không hỏi lại.)

**Định nghĩa "chắc chắn 100%" = bot chỉ gửi tin khi:**
- Trích xuất được ĐỦ year + make + model + part, VÀ
- `search_inventory` trả về khớp CHÍNH XÁC (xem #4 về model mơ hồ), VÀ
- Có giá + SKU thật.

**Mọi trường hợp KHÁC → IM (không gửi gì):**
- Thiếu year/make/model/part.
- Model mơ hồ (nhiều CIVIC_*) → xem #4 (đây là ngoại lệ: HỎI, không im — cần Brandon
  xác nhận, vì #4 nói "hỏi lại").
- Tra không ra / API lỗi / ngoài phạm vi (chào hỏi, hỏi giờ...).
- Confidence thấp.

**Cách làm:**
- Thêm cơ chế: pipeline chỉ `reply()` khi agent đạt trạng thái "confident answer".
  Không đạt → không gửi (bot im, office thấy tin chưa trả lời trong Quo → xử lý tay).
- System prompt: đổi từ "hỏi lại thông tin thiếu" sang "nếu không chắc chắn tuyệt đối,
  KHÔNG trả lời" — nhưng cần một tín hiệu máy đọc được (vd tool trả `confident:true`
  hoặc một sentinel để pipeline biết im).

**⚠️ Mâu thuẫn cần Brandon chốt:** #1 nói "im hoàn toàn", nhưng #4 nói "hỏi lại khi
model mơ hồ". Vậy disambiguation (#4) là NGOẠI LỆ được phép hỏi, còn thiếu
year/make/part thì im? Cần xác nhận ranh giới.

**Rủi ro:** nếu định nghĩa "chắc chắn" quá ngặt → bot im gần như mọi tin → office
quá tải. Nếu quá lỏng → trả lời sai. Cần tinh chỉnh + theo dõi tỉ lệ im/trả lời.

---

## Yêu cầu #2 — Fix thông tin cửa hàng (hardcode) 🟢

Bot đang trả sai giờ/địa chỉ. Hardcode vào system prompt + config:

```
Giờ mở cửa: Mon–Fri 9am–5pm, Sat 9am–3pm (đóng cửa Chủ nhật)
Địa chỉ:    1911 Union St, Oakland, CA 94607
Phone:      510-451-2800
```

**Cách làm:** cập nhật `SHOP_ADDRESS` trong config + thêm block "Store info" vào
systemPrompt.ts với giờ/địa chỉ/phone chính xác. Nhắc bot CHỈ dùng thông tin này,
không tự bịa giờ.

**Lưu ý:** phone 510-451-2800 — nhưng yêu cầu #3 (Brandon trước) là "không khuyên
gọi điện". Vậy phone chỉ để trong info khi khách HỎI, bot không chủ động bảo gọi.

---

## Yêu cầu #3 — Format trả lời sản phẩm CỐ ĐỊNH 🟢

Khi tìm được part chắc chắn 100%, trả đúng template (không tự do diễn đạt):

```
TÊN SẢN PHẨM
Current price is: $XXX
SKU: XXX
FITS [năm, hãng, model]
[các thuộc tính]
Order link: [URL]
```

**Cách làm:**
- System prompt: định nghĩa template cứng này cho ca "found".
- Cần `Order link` (URL sản phẩm) — hiện API inventory trả về gì? Cần thêm field
  `permalink`/`url` vào response plugin nếu chưa có (xem "Cần bổ sung" bên dưới).
- "Các thuộc tính" = variants/attributes đã có trong response.

**⚠️ Cần bổ sung:** endpoint inventory hiện trả product_id, sku, title, price,
variants, inventory — CHƯA có URL sản phẩm. Phải thêm `permalink` vào plugin +
InventoryClient schema để có "Order link".

---

## Yêu cầu #4 — Disambiguation model mơ hồ 🟡

Khách nhắn "2007 honda civic front bumper", DB có nhiều model bắt đầu "CIVIC"
(CIVIC_COUPE, CIVIC_HYBRID, CIVIC_SEDAN) → bot HỎI khách chọn model nào, KHÔNG đoán.

**Logic:** match theo TỪ ĐẦU của model name. Nếu search khớp >1 model base khác
nhau (coupe vs sedan vs hybrid) → liệt kê cho khách chọn.

**Cách làm:**
- Sau `search_inventory`, nếu kết quả có nhiều biến thể model từ cùng base → bot
  hỏi "Civic Coupe, Sedan, hay Hybrid?" thay vì chọn bừa.
- Đây là NGOẠI LỆ của #1 (được phép hỏi lại, không im) — cần Brandon xác nhận.
- Bot đã lưu model đa biến thể trong lookup (accord_sedan, accord...) → tận dụng.

---

## Yêu cầu #5 — Chỉ trả lời conversation "OPEN" (bỏ "DONE") 🟡

Quo/OpenPhone đánh dấu conversation "DONE" = đã đóng → bot phải BỎ QUA, không
auto-reply. Check status trước khi xử lý webhook.

**Cách làm:**
- **P1 (thám thính):** capture 1 webhook Quo thật → xem payload có field trạng thái
  conversation (OPEN/DONE) không. Chưa verify (giống message.delivered trước đây).
- Nếu webhook CÓ status → filter ngay trong webhook.ts trước khi xử lý.
- Nếu webhook KHÔNG có → phải gọi Quo API hỏi status conversation (thêm 1 call).

**⚠️ Chưa biết Quo gửi status thế nào — P1 bắt buộc trước khi code.**

---

## Phân tầng & thứ tự làm

| # | Tầng | Phụ thuộc |
|---|---|---|
| 2 | prompt (store info) | không — làm ngay |
| 3 | prompt (format) + plugin (thêm permalink) | cần URL sản phẩm |
| 1 | logic (confidence gate → im) | cần chốt ranh giới với #4 |
| 4 | logic (disambiguation) | liên quan #1 |
| 5 | webhook filter | cần thám thính Quo payload (P1) |

**Đề xuất thứ tự:**
1. **#2** (store info) — dễ, làm ngay, sửa lỗi khách gặp.
2. **#3** (format) — cần thêm `permalink` vào plugin trước.
3. **#1 + #4** (confidence + disambiguation) — làm cùng nhau vì #4 là ngoại lệ của #1.
4. **#5** (OPEN/DONE) — sau khi thám thính Quo payload.

---

## Cần Brandon/bạn xác nhận trước khi code

1. **Ranh giới #1 vs #4:** thiếu year/make/part → IM hoàn toàn? Còn model mơ hồ → được
   HỎI? (nếu không, #4 mâu thuẫn #1).
2. **#3 Order link:** URL sản phẩm là link WooCommerce chuẩn
   (`oaklandbodyparts.com/product/...`)? Xác nhận format.
3. **#5:** cần capture 1 webhook Quo thật khi conversation ở trạng thái DONE.
4. Giờ mở cửa có đóng Chủ nhật không? (yêu cầu chỉ ghi T2-T7).

---

## Không phá cái đang chạy

- 18 bug đã sửa + 63 test phải vẫn pass sau Update 002.
- Confidence-gate mới (#1) là thay đổi hành vi lớn → cần test kỹ + regression test
  cho "im khi không chắc".
