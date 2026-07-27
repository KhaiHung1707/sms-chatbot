# Design Brief — OBP Bot Admin Page (Instructions Editor)

> Dùng để nhờ Claude / designer tạo mockup HTML giao diện. Sau khi có HTML duyệt
> xong, dev nối backend (đã thiết kế sẵn — xem ADMIN-INSTRUCTIONS-PLAN.md).
> **Yêu cầu:** mockup HTML tĩnh, self-contained (inline CSS/JS), 1 file.

---

## 1. Bối cảnh (context cho designer)

Trang web nội bộ để **chủ cửa hàng tự sửa cách con bot SMS trả lời khách**. Bot là
trợ lý nhắn tin cho Oakland Body Parts (cửa hàng phụ tùng ô tô ở Mỹ). Hiện cách bot
hỏi/trả lời bị "khóa cứng" trong code — mỗi lần đổi phải nhờ lập trình viên. Trang
này để chủ shop tự đổi **mà không cần biết code**.

## 2. Người dùng — thiết kế XOAY QUANH người này

**Brandon Levan** — chủ cửa hàng, **KHÔNG rành kỹ thuật, không đọc code**.
- Vào trang vài lần/tháng, sửa nhỏ.
- Cần: rõ ràng, khó làm sai, an tâm (thử trước khi áp dụng, hoàn tác được).
- KHÔNG được thấy: JSON, prompt thô, cấu hình kỹ thuật, thuật ngữ lập trình.
- Ngôn ngữ giao diện: **tiếng Anh** (Brandon là người Mỹ).

## 3. Trang gồm những gì (1 trang duy nhất, cuộn dọc)

### A. Header
- Tên: "Bot Instructions" (hoặc tương tự thân thiện).
- Nút **Log out** góc phải.
- **Banner trạng thái:** khi bản nháp khác bản đang chạy → hiện dải màu nổi bật:
  *"You have unpublished changes — customers still see the current version until you Publish."*

### B. Danh sách STEP (phần chính) — "How the bot helps customers"
- Một **danh sách có thứ tự** các bước (mỗi bước = 1 đoạn văn ngắn tiếng Anh).
- Mỗi bước là 1 dòng/thẻ gồm:
  - Số thứ tự (1, 2, 3...)
  - Ô văn bản (textarea) chứa nội dung bước — sửa trực tiếp
  - Nút **↑ Up** / **↓ Down** (đổi thứ tự)
  - Nút **Delete** (xóa bước — có xác nhận)
- Nút **+ Add step** ở cuối danh sách (thêm bước trống).
- Nút **Save draft** (lưu bản nháp).
- Ví dụ nội dung 1 bước (để designer hình dung độ dài):
  *"When a customer's model matches several trims (like Civic Coupe, Sedan, or
  Hybrid), ask which one before quoting the price."*

### C. Ô THỬ NGHIỆM (Preview) — "Try it before you publish"
- Nhãn rõ: *"PREVIEW — nothing is sent to any customer. Uses the steps in the
  editor above."*
- 1 ô nhập: "Type a customer message..." + nút **Run preview**.
- Kết quả hiện dạng **bong bóng chat** (giống tin nhắn) — cho thấy bot sẽ trả lời
  thế nào với bản nháp hiện tại.
- Có thể thử nhiều lần.

### D. PUBLISH
- Nút **Publish changes** (nổi bật, màu chính).
- Bấm → hộp xác nhận: *"Publish these instructions? Customers will start seeing
  this version right away."* (Confirm / Cancel).
- Ô ghi chú tùy chọn: "What changed? (optional note)".

### E. LỊCH SỬ (Version history) — "Previous versions"
- Bảng đơn giản: cột **Version**, **Published**, **Note**, và nút **Restore**.
- Nút **Restore** mỗi dòng → xác nhận → quay về version đó.
- Dòng đang chạy (live) đánh dấu rõ (badge "Live" / màu khác).

### F. Trang đăng nhập (login) — màn hình riêng
- Đơn giản: 1 ô mật khẩu + nút **Log in**. Không có username (1 mật khẩu chung).
- Nếu sai: thông báo nhẹ nhàng "Wrong password, try again."

### G. CẢNH BÁO (Safety check / Lint) — gắn với nút Publish
- Khi bấm **Publish**, hệ thống quét các step tìm cụm nguy hiểm và **cảnh báo trước
  khi cho publish** (Brandon vẫn publish được sau khi xác nhận — cảnh báo, không chặn).
- Hiện dạng danh sách cảnh báo màu vàng, mỗi dòng nêu rõ: *"Step 3 mentions 'eBay' —
  the bot should never link customers to other sites."*
- Ví dụ cụm bị cảnh báo (designer làm demo vài cái): link ebay/amazon, "always say
  in stock", "make up a price", "tell them to call".
- Mục đích: chống Brandon vô tình khiến bot làm sai (bot từng bịa link eBay).

### H. Preview nâng cao — nút tin mẫu + so sánh (Diff)
- **Tin mẫu bấm nhanh:** vài nút gợi ý dưới ô preview để test không cần nghĩ:
  "95 Accord front bumper", "GM1000683", "civic bumper", "what time do you open?".
  Bấm → tự điền vào ô preview.
- **Diff (What changed):** trước khi Publish, 1 khối nhỏ hiện điểm khác giữa bản
  nháp và bản đang chạy (step nào thêm/xóa/sửa) — Brandon thấy rõ mình đổi gì.

### I. Dashboard / Thống kê — khối riêng (có thể là 1 tab/section riêng)
- ⚠️ **LƯU Ý cho designer:** phần này hiện **CHỈ LÀ MOCKUP với dữ liệu GIẢ** — backend
  chưa thu thập thống kê, cần làm sau. Thiết kế giao diện để dành chỗ.
- Nội dung gợi ý (số liệu giả trong mockup):
  - Số tin nhắn khách/ngày (biểu đồ đơn giản 7 ngày)
  - Tỉ lệ: bot tự trả lời vs chuyển nhân viên (handoff)
  - Số lần bot "im" (không chắc → nhân viên xử lý)
  - Vài chỉ số khác: số hold tạo, top phụ tùng được hỏi
- Phong cách: thẻ số liệu (stat cards) + biểu đồ nhẹ. Đừng phức tạp.

---

## 4. Nguyên tắc UX (quan trọng nhất)

1. **Khó làm sai:** mọi hành động phá hoại (Delete, Publish, Restore) đều có **xác nhận**.
2. **Draft ≠ Live rõ ràng:** Brandon phải luôn hiểu "cái tôi đang sửa" vs "cái khách
   đang thấy". Banner + nhãn Preview + badge Live giúp việc này.
3. **Thử trước khi áp dụng:** Preview nổi bật, khuyến khích thử trước Publish.
4. **Hoàn tác dễ:** Version history + Restore luôn nhìn thấy → Brandon an tâm.
5. **Không thuật ngữ kỹ thuật:** không "prompt", "JSON", "config", "deploy". Dùng
   từ đời thường: "instructions", "steps", "publish", "version", "restore".
6. **Ngắn gọn, ít lựa chọn:** 1 trang, cuộn dọc, không menu phức tạp, không tab rối.

## 5. Phong cách hình ảnh
- Sạch, hiện đại, dễ đọc (chủ shop lớn tuổi — font đủ to, tương phản tốt).
- Tông: tin cậy, chuyên nghiệp nhưng thân thiện (không "kỹ thuật lạnh lùng").
- Responsive: dùng được trên laptop VÀ điện thoại (Brandon có thể mở trên phone).
- Hỗ trợ light/dark mode nếu tiện.
- Không cần logo cụ thể — placeholder "Oakland Body Parts" là đủ.

## 6. Ràng buộc kỹ thuật cho mockup
- **1 file HTML self-contained** (CSS + JS inline, không CDN ngoài).
- JS chỉ để **tương tác demo** (thêm/xóa/sắp xếp step, hiện bong bóng preview giả,
  mở hộp confirm) — KHÔNG cần gọi API thật (backend nối sau).
- Dữ liệu mẫu: 5-7 step ví dụ + vài dòng version history giả.
- Đây là **mockup để duyệt giao diện**, không phải bản chạy thật.

## 7. KHÔNG đưa vào giao diện (dev lo, Brandon không thấy)
- Prompt thô / system prompt.
- Định nghĩa tool, quy tắc an toàn (link, honest-stock, [[SILENT]]).
- Thông tin cửa hàng (địa chỉ/giờ) — cái này khóa cứng, không sửa ở đây.
- Bất kỳ JSON/code/config nào.

---

## 8. Tóm tắt màn hình / module cần thiết kế

**Màn hình 1 — Login:** ô mật khẩu.

**Màn hình 2 — Editor (trang chính, cuộn dọc):**
- A. Header + Log out
- B. Banner "draft ≠ live"
- C. Danh sách Step (sửa/thêm/xóa/sắp xếp) + Save draft
- D. Preview + H. tin mẫu bấm nhanh
- E. Diff "What changed" (trước publish)
- F. Publish (+ G. cảnh báo lint khi publish, confirm)
- I. Version history + Restore

**Màn hình 3 (hoặc tab) — Dashboard/Stats:** thẻ số liệu + biểu đồ (DỮ LIỆU GIẢ trong
mockup — backend làm sau).

**States phụ:** hộp xác nhận Delete/Publish/Restore; cảnh báo lint; login sai.

---

## 9. Ưu tiên (nếu designer cần cắt bớt)

| Ưu tiên | Module |
|---|---|
| **Phải có** | Login, Step list, Save draft, Preview, Publish, Version history, Banner |
| **Nên có** | Lint cảnh báo, tin mẫu preview, Diff, confirm dialogs |
| **Có thể sau** | Dashboard/stats (mockup dữ liệu giả, backend chưa sẵn) |

Gửi lại file HTML mockup → dev nối backend theo ADMIN-INSTRUCTIONS-PLAN.md.
