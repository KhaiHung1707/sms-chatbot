# Plan: Trang Admin cho Brandon tự sửa instructions bot

> Ngày: 2026-07-25 · Trạng thái: CHỜ DUYỆT
> Thiết kế bằng 4 agent điều tra song song, verify với code thật.
> Nguyên tắc: **an toàn by-construction** — Brandon chỉ sửa *cách diễn đạt hội thoại*,
> KHÔNG bao giờ chạm được tool/an toàn/store facts. Bot chạy **y hệt** cho tới khi
> Brandon chủ động Publish. Host: `/admin` cùng bot trên VPS (đã chốt).

## Vì sao an toàn tuyệt đối
Tool definitions (`tools.ts`) truyền RIÊNG vào Claude (không nằm trong prompt string).
Link-strip / hold-race / handoff (`pipeline.ts`) KHÔNG đọc prompt. → Brandon sửa
prompt kiểu gì cũng không phá được các cơ chế đó.

---

## 1. Brandon sửa gì / KHÓA gì

**EDITABLE — 7 STEP (mảng chuỗi có thứ tự, seed nguyên văn từ prompt hiện tại):**
1. Giúp khách tìm phụ tùng theo giá/tồn/pickup — không gì khác.
2. Hữu ích: ~80%+ chắc thì trả lời; thiếu/mơ hồ thì hỏi 1 câu ngắn, hỏi tới khi giúp được.
3. Part = year+make+model+part type. Thiếu gì hỏi nấy ("Accord bumper" → "năm nào, trước/sau?").
4. "95" = 1995. ~80% chắc xe+part thì search.
5. Nhiều trim (Coupe/Sedan/Hybrid, trước/sau) → hỏi chọn. Đã cho trim rồi thì khỏi hỏi.
6. Giọng ấm, tự nhiên, 1-2 câu, <300 ký tự.
7. Search ra 1 match → báo giá; ra 0 → nói không thấy, nhờ kiểm lại xe/part.

**LOCKED — code giữ, Brandon KHÔNG thấy/sửa** (header trước steps + footer sau steps):
- LINKS/no-eBay (+ enforced bởi stripForeignLinks) · Store info (giờ/địa chỉ/phone) ·
  Language · [[SILENT]] handoff · SKU tool + format · quote format · honest-stock
  (Update 001) · Holds · opt-out · Scope/safety.
- ⚠️ **Bẫy:** 2 điều "không khuyên gọi điện" + "không Reply STOP" là YÊU CẦU client
  (Brandon feedback), KHÔNG phải tone → để LOCKED, không được lẫn vào step "giọng".

---

## 2. Refactor prompt (systemPrompt.ts)
```
LOCKED_HEADER  +  renderSteps(steps)  +  LOCKED_FOOTER   (+ languageTail cuối cùng)
```
- `DEFAULT_INSTRUCTION_STEPS` = 7 chuỗi trên (nguồn chân lý duy nhất, dùng cả cho seed).
- `buildSystemPrompt` thêm `steps?: string[]`; rỗng → dùng default → **byte-identical**.
- Prompt-caching giữ nguyên (steps là shop-level, render tất định).
- **Test chốt:** snapshot khẳng định `buildSystemPrompt(default)` == prompt hiện tại
  (byte-identical) + test honest-stock LUÔN có mặt bất kể steps.

## 3. Storage (migration 004)
Bảng `instruction_versions` (id, version, steps jsonb, status draft|live|archived,
note, created_at, published_at). Unique index: tối đa 1 live + 1 draft.
**Seed v1 = live từ DEFAULT_INSTRUCTION_STEPS** → deploy xong DB khớp code, 0 thay đổi.
Store thêm: getLiveInstructions, getDraft, saveDraft, publishDraft, listVersions, rollbackTo.

## 4. Admin UI (`src/routes/admin.ts`, server-rendered, không framework)
Routes (dưới `/admin`, auth trừ login):
- `GET/POST /admin/login`, `POST /admin/logout`
- `GET /admin` — editor: danh sách step (up/down/edit/delete/add) + banner "draft khác live"
  + ô Preview + nút Publish + bảng lịch sử version
- `POST /admin/steps` — lưu cả mảng thành draft
- `POST /admin/preview` — chạy thử (§5)
- `POST /admin/publish` — draft→live (confirm)
- `GET /admin/versions` + `POST /admin/rollback` (confirm)

UI: mỗi step 1 textarea + Up/Down/Delete; "Add step"; "Save draft". Dưới: Preview
(nhập tin test → hiện reply, nhãn "PREVIEW — không gửi gì"). Cuối: Publish + lịch sử
+ Rollback. Mọi hành động phá hoại đều `confirm()`. Không có config thô nào trên trang.
Caps: ≤25 step, ≤600 ký tự/step, reject rỗng + validator token nguy hiểm.

**Auth:** `ADMIN_PASSWORD` (config, min 12, bắt buộc prod). Middleware: timingSafeEqual
(reuse pattern quo.ts) → cookie HttpOnly+Secure+SameSite=Strict (HMAC). Không user table.

## 5. Preview (không đụng live/SMS/DB)
Bỏ Pipeline, gọi thẳng LLM loop:
1. `buildSystemPrompt({..., steps: draftSteps})`
2. `llm.runTurn(system, [user: testMessage], previewExecutor)`
3. previewExecutor **read-only**: search/lookup_sku chạy thật (đọc); **create_hold stub
   held:false** (không bao giờ giữ hàng thật — BẮT BUỘC)
4. Áp stripForeignLinks lên reply (khách thấy gì preview thấy nấy)
5. Trả text. **Không ghi row, không gửi SMS** (không tạo QuoClient).
Preview chạy trên nội dung editor hiện tại (không cần save trước).

## 6. Safety nets (sống với MỌI text Brandon gõ)
- **Link ngoài:** stripForeignLinks xóa mọi URL non-shop — HARD GUARANTEE.
- **Tool contract:** definitions + Zod + hold-race không đụng được — HARD.
- **[[SILENT]]/opt-out:** xử lý ngoài prompt — HARD.
- **⚠️ Điểm yếu DUY NHẤT — giá/tồn bịa:** KHÔNG có backstop code (khác link). Phòng
  thủ: (a) honest-stock text LUÔN ở LOCKED_FOOTER, (b) lint trước publish. Thêm test:
  output LUÔN chứa "never invent numbers" bất kể steps.
- **Lint trước publish** (`promptLint.ts`, WARN+confirm): cảnh báo cụm nguy hiểm
  (ebay/amazon, "make up price", "always say in stock", "tell them to call", prompt
  injection). Là belt-and-suspenders, KHÔNG hứa với Brandon là đảm bảo tuyệt đối.

## 7. Rollout — KHÔNG đụng hệ thống đang chạy (4 stage độc lập)
- **A. Refactor vô hình:** tách prompt + DEFAULT_STEPS + 2 test byte-identity. Không đọc
  DB, không đổi hành vi. Ship riêng được.
- **B. Storage câm:** migration 004 (seed v1=live) + Store methods. Chưa ai đọc bảng.
- **C. Đọc live + fallback:** pipeline load live steps (memoize), try/catch → fallback
  DEFAULT nếu lỗi/rỗng. v1==default → vẫn byte-identical. **Read KHÔNG được throw vào runAgent.**
- **D. Admin UI:** ADMIN_PASSWORD + admin routes + preview + lint. Brandon sửa được —
  nhưng chỉ đổi khi bấm **Publish**.

**Multi-instance:** VPS 1 instance → publish→invalidate cache local là đủ. Nhiều instance
thì thêm TTL 30-60s (chưa cần giờ).

## 8. Files
**Tạo:** migrations/004_instruction_versions.sql · src/routes/admin.ts ·
src/admin/auth.ts · src/admin/steps.ts · src/admin/preview.ts · src/llm/promptLint.ts
**Sửa:** src/llm/systemPrompt.ts (tách LOCKED/steps) · src/db/store.ts + pgStore.ts +
memoryStore.ts (6 method) · src/config.ts (ADMIN_PASSWORD) · src/index.ts (mount /admin) ·
src/core/pipeline.ts (load live steps) · tests (byte-identity + honest-stock-present)

## Quyết định đã chốt (2026-07-28)
- **Auth:** 1 mật khẩu chung `ADMIN_PASSWORD` ✓
- **Preview inventory:** THẬT (chân thực) ✓
- **Ship:** từng stage ✓
- **Host:** `/admin` cùng bot trên VPS ✓
- **Phạm vi bản đầu:** CỐT LÕI (login, sửa step, preview, lint, publish, history+restore)
  **+ Dashboard stats THẬT** (đếm tin/ngày, handoff, hold — thêm backend collection).
  Ý tưởng để SAU: step gợi ý/mẫu, preset giọng, nút "Restore last working" panic.
- **Mockup:** file Subframe trong `template/` là tham chiếu giao diện; code lại HTML
  thuần server-rendered, không cần giống 100%.

## Stage phạm vi mới (5 stage)
- A. Tách prompt (LOCKED + steps + DEFAULT) + test guardrails
- B. Storage instruction_versions (migration 004, seed v1=live) + Store methods
- C. Pipeline đọc live steps + fallback
- D. **Stats collection** (messages/day, handoff, holds) + Store methods
- E. Admin routes + auth + preview + lint + UI (login/steps/preview/publish/history/dashboard)
