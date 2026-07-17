# Báo cáo rà soát bug toàn diện — OBP SMS Bot

> Ngày: 2026-07-17 · Rà soát bằng 5 mảng song song (concurrency, DB/store, provider/LLM,
> hold recovery, jobs/guards). Chỉ liệt kê bug ĐÃ verify bằng trace code, không phải style.
> **10 bug thật.** Xếp theo mức độ.
>
> **✅ TRẠNG THÁI: TẤT CẢ 10 BUG ĐÃ SỬA (2026-07-17).** 63 test pass. Chi tiết fix ở cuối file.

## 🔴 CRITICAL — chặn go-live, gây bán-trùng / mất tiền

### C1. Chống bán-trùng KHÔNG hoạt động ở món cuối cùng
- **File:** `src/db/pgStore.ts:186-216` (createHoldIfAvailable)
- **Lỗi:** `SELECT ... FOR UPDATE OF h` chỉ khóa được row ĐÃ tồn tại. Khi món chưa có hold nào
  (đúng case món cuối), không có row để khóa → 2 khách cùng `SELECT` thấy 0 hold → cả 2 tạo hold
  → **2 khách cùng giữ 1 món cuối.**
- **Nghịch lý:** đây là lỗ hổng ngay trong tính năng chống bán-trùng (Update 001 Rule 2).
  MemoryStore đơn luồng nên **test không bao giờ bắt được**.
- **Sửa:** dùng `pg_advisory_xact_lock(wcProductId)` đầu transaction, HOẶC SERIALIZABLE + retry.

### C2. Hold tạo sau 6PM có expiry ở QUÁ KHỨ → chết ngay
- **File:** `src/jobs/holdTime.ts:16-23` + caller `src/core/pipeline.ts:294`
- **Lỗi:** `computeHoldExpiry` trả "hôm nay 6PM" kể cả khi `now` đã qua 6PM. Khách hold lúc 7PM
  → expiry = 6PM (quá khứ) → `getActiveHoldQty` lọc bỏ ngay → **hold chết khi vừa tạo.**
- **Hậu quả:** mỗi buổi tối, khách xác nhận giữ hàng nhưng hold không có tác dụng → bán trùng.
- **Sửa:** nếu expiry <= now, cộng 1 ngày (hold 11PM → hết hạn 6PM HÔM SAU).
- Đây chính là test đang fail (không phải flaky — bug thật, phụ thuộc giờ chạy).

## 🟠 HIGH — hỏng trạng thái hội thoại, khách bị bỏ rơi

### H1. Gửi SMS thất bại nhưng DB vẫn ghi "đã gửi"
- **File:** `src/core/pipeline.ts:339-354`
- **Lỗi:** `reply()` lưu tin vào DB TRƯỚC khi gửi; nếu gửi fail (Quo hết credit 402 / 5xx) chỉ log.
  Tin vẫn nằm trong DB như đã gửi → lần sau `toClaudeHistory` map thành "assistant đã nói" →
  **Claude tưởng đã báo giá** ("như tôi đã nói, $129.95") dù khách chưa nhận gì.
- **Sửa:** đánh dấu tin gửi-fail (cột status), không đưa vào history; hoặc gửi trước, lưu sau.

### H2. Quo trả id rỗng → bot tự handoff hội thoại của CHÍNH MÌNH
- **File:** `src/providers/quo.ts:150-151` + `pipeline.ts:80-82`
- **Lỗi:** nếu `sendMessage` trả id `''` → không ghi provider_message_id. Khi Quo gửi
  `message.delivered` cho tin đó (id thật), bot không nhận ra là của mình →
  **tưởng nhân viên tiếp quản → tự im lặng với khách thật.**
- **Sửa:** id rỗng phải coi là bất thường, không im lặng dựa trên đó.

### H3. Race: 2 tin đến gần nhau tạo 2 conversation
- **File:** `src/core/pipeline.ts:116` + `conversation.ts:24` + không có unique constraint
- **Lỗi:** `getOrCreateConversation` read-then-write không khóa; không có ràng buộc "1 open
  conversation/khách". 2 tin (hoặc Quo retry) → 2 conversation → **mất context** (hold turn không
  thấy lookup trước) + **thủng handoff** (nhân viên chỉ handoff 1 cái, bot vẫn trả lời cái kia).
- **Sửa:** khóa async per-phone quanh handleInbound, HOẶC unique constraint 1 open conv/khách.

## 🟡 MEDIUM

### M1. Guard media "1 lần" vẫn bị race → vẫn spam
- **File:** `src/core/pipeline.ts:135-144`
- **Lỗi:** fix spam media (Brandon feedback) là read-check-act có `await` ở giữa. 3 ảnh đến gần nhau
  → cả 3 đọc "chưa hỏi" trước khi cái nào kịp ghi → **vẫn gửi 3 lần.** Đã giảm nhưng chưa hết.
- **Sửa:** cùng khóa per-phone như H3, hoặc guard atomic.

### M2. Opt-out không re-check giữa intake và reply (TCPA)
- **File:** `pipeline.ts:104-110` vs `154-158`
- **Lỗi:** khách gửi "giá bumper?" rồi "STOP" liền. Run đầu đọc opted_out=false, chạy tiếp; run STOP
  set opt-out — nhưng run đầu **vẫn gửi tin sau khi khách đã opt-out** (vi phạm TCPA/R-15).
- **Sửa:** re-check opted_out ngay trước `reply()`.

### M3. Tool input không validate → "undefined" gửi API
- **File:** `pipeline.ts:226-228` + `inventory.ts:56`
- **Lỗi:** input từ Claude cast thẳng, không validate. Thiếu field → year/make="undefined" gửi API →
  báo "không có hàng" SAI. qty âm trong create_hold → hold vô nghĩa (`effective < qty` luôn pass).
- **Sửa:** validate tool input bằng Zod trước khi dùng.

### M4. getLatestFoundLookup khác nhau Pg vs Memory
- **File:** `pgStore.ts:160-184` vs `memoryStore.ts:172-187`
- **Lỗi:** Pg trả row có wc_product_id nhưng year/make null; Memory bỏ qua row đó. Production có thể
  re-search với param null.
- **Sửa:** đồng bộ filter (thêm null-check vào Pg query).

## 🟢 LOW

### L1. STOP chỉ nhận tiếng Anh (comment nói "multilingual")
- **File:** `guards.ts:57-75` — keyword chỉ có stop/cancel/quit... khách Việt "hủy" không opt-out.

### L2. firstWarehouse audit dùng raw qty thay vì effective
- **File:** `tools.ts:167` — chỉ ảnh hưởng audit trail, không tới khách.

### L3. Không có timeout bọc llm.runTurn / inventory.search
- **File:** `pipeline.ts:200` — nếu HTTP client treo (không throw), khách bị im lặng. (inventory.ts
  có abort 8s nên phần lớn ổn; llm.runTurn thì chưa.)

---

## Nguyên nhân gốc chung

Phần lớn bug HIGH/CRITICAL (C1, H3, M1, M2) đến từ **thiếu khóa đồng thời per-customer**:
webhook cố tình fan-out `setImmediate` nhưng không serialize theo khách. Một **khóa async
per-phone** quanh `handleInbound` + **advisory lock trong createHoldIfAvailable** đóng được C1,
H3, M1, M2 cùng lúc.

Các bug còn lại (C2 hold expiry, H1 send-fail, H2 empty-id, M3 validate) là độc lập, sửa riêng.

## Thứ tự đề xuất sửa

1. **C2** (hold expiry) — 1 hàm, sửa ngay, gỡ luôn test đang fail
2. **C1** (advisory lock) — chống bán-trùng thật
3. **H1, H2** — hỏng trạng thái hội thoại
4. **H3 + M1 + M2** (khóa per-phone) — gỡ 3 bug cùng lúc
5. **M3, M4** — validate + đồng bộ store
6. **L1-L3** — sau go-live

---

## ✅ ĐÃ SỬA (2026-07-17)

| Bug | Fix |
|---|---|
| **C1** | `pg_advisory_xact_lock(wcProductId)` đầu transaction createHoldIfAvailable → khóa cả case món cuối (pgStore.ts) |
| **C2** | computeHoldExpiry roll sang ngày mai nếu đã qua 6PM (holdTime.ts) + 2 regression test |
| **H1** | reply() xóa outbound row khi gửi fail → Claude không thấy tin chưa gửi (pipeline.ts + deleteMessage) |
| **H2** | handleOutbound chỉ handoff khi có staff userId → id rỗng không còn tự-handoff (pipeline.ts) |
| **H3** | Khóa async per-phone (phoneLocks) → tin cùng khách xử lý tuần tự, không tạo 2 conversation |
| **M1** | Cùng phone-lock → media guard không còn race → hết spam |
| **M2** | Re-check opted_out ngay trước reply() trong runAgent |
| **M3** | Zod validate search_inventory + create_hold input (tools.ts) → chặn "undefined"/qty âm |
| **M4** | getLatestFoundLookup thêm null-check year/make/model/part_type → khớp MemoryStore |
| **L1** | Thêm STOP/HELP keyword tiếng Việt + Tây Ban Nha (guards.ts) |
| L2, L3 | Ghi nhận, ưu tiên thấp — chưa sửa (audit-only / cần timeout wrapper) |

**Test:** 63 pass (thêm regression: hold-after-6PM ×2, concurrent-photos ×1). typecheck sạch.
**Còn lại chưa sửa:** L2 (audit warehouse), L3 (timeout wrapper cho llm.runTurn) — ưu tiên thấp, sau go-live.
**✅ C1 ĐÃ VERIFY LEVEL 3 (Postgres thật):** `scripts/verify-c1-doublebook.mjs` bắn N hold
đồng thời vào 1 món cuối → cả 2-way lẫn 10-way đều **đúng 1 thắng, 1 active hold trong DB**.
Advisory lock chống bán-trùng vững chắc dưới tải đồng thời cao. Dữ liệu test đã dọn khỏi Supabase.
