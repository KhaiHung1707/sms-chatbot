# Test bot trên laptop — không cần VPS/key/DB/internet

Chạy toàn bộ luồng bot cục bộ với **fake** thay cho mọi dịch vụ ngoài: DB in-memory,
LLM rule-based, "kho" giả, và reply **in ra terminal** thay vì gửi SMS thật.

## Chạy

**Terminal 1** — khởi động bot:
```bash
npm run dev:local
```
Banner in ra URL + danh sách SKU giả có thể tra cứu.

**Terminal 2** — gửi tin giả (script tự ký chữ ký đúng):
```bash
./scripts/send.sh "+15105551234" "front bumper"
./scripts/send.sh "+15105551234" "95 Accord front bumper yes"
./scripts/send.sh "+15105551234" "STOP"
```

Reply của bot in ở **Terminal 1** dạng:
```
  📤 BOT → +15105551234
     "Front Bumper Cover — 1995-97 Honda Accord: $129.95, 4 available..."
```

> **Nếu port 3000 bận** (máy đã có app khác): server báo rõ và gợi ý đổi port.
> Chạy `PORT=3999 npm run dev:local`, rồi gửi tin với cùng port:
> `PORT=3999 ./scripts/send.sh "+15105551234" "front bumper"`
> (script tự đọc biến `PORT`, không cần sửa file).

## Kho giả (những gì tra cứu được)

| Xe | Part | Giá | Qty | Band |
|---|---|---|---|---|
| 1995 Honda Accord | front bumper | $129.95 | 4 | in_stock |
| 1998 Honda Civic | left mirror | $42.50 | 1 | **low** |
| 2005 Toyota Camry | tail light | $88.00 | 0 | **out** |

## Kịch bản test nên chạy

1. **Confidence gate** — `"front bumper"` → bot hỏi lại year/make/model (không đoán).
2. **Đa lượt** — `"95 Accord front bumper"` → bot đọc lại xe → gửi `"yes"` → báo giá.
3. **Hold** — sau khi có giá, gửi `"hold it"` → bot tạo hold "đến 6 PM".
4. **Low stock (Rule 3)** — `"98 Civic left mirror yes"` → reply có **"as of right now"** + mời hold.
5. **Out of stock** — `"2005 Camry tail light yes"` → bot báo hết hàng.
6. **STOP** — `"STOP"` → opt-out; tin sau bị bỏ qua hoàn toàn.
7. **Bán-trùng (Rule 2)** — hold Civic mirror (qty 1) từ 2 số khác nhau:
   ```bash
   ./scripts/send.sh "+1111111111" "98 Civic left mirror yes"
   ./scripts/send.sh "+1111111111" "hold it"
   ./scripts/send.sh "+2222222222" "98 Civic left mirror yes"   # khách 2
   ```
   → khách 2 thấy "only 0 left" / không hold được (đã bị khách 1 giữ).
8. **MMS** — `./scripts/send.sh "+15105551234" "" media` → bot xin mô tả bằng chữ.
9. **Chữ ký sai** — webhook chữ ký sai → 401 (guardrail R-07).

## Ba mức test — chỉ cần `.env.local`, KHÔNG sửa code

Dev server tự chọn LLM/DB theo biến môi trường bạn đặt trong `.env.local`
(copy từ `.env.local.example`). Banner lúc khởi động in rõ đang ở mức nào.

| Mức | Đặt gì trong `.env.local` | LLM | DB | Test được thêm |
|---|---|---|---|---|
| **1** (mặc định) | (không gì) | rule-based | in-memory | luồng logic, guardrail, Rule 2/3 |
| **2** | `ANTHROPIC_API_KEY` | **Claude Haiku thật** | in-memory | **trích xuất đa ngôn ngữ VI/ES + sai chính tả (R-01)** |
| **3** | thêm `DATABASE_URL` (Supabase free) | Claude thật | **Postgres thật** | **dedupe, holds transaction, cron, TTL** |

> Quo (SMS) và inventory luôn là fake ở cả 3 mức — SMS/kho thật cần môi trường
> deploy (mức 4: ngrok + số Quo + A2P, dùng `src/index.ts` production).

### Kịch bản Mức 2 (LLM thật — điểm rủi ro R-01)

Đặt `ANTHROPIC_API_KEY` vào `.env.local`, chạy lại `npm run dev:local` (banner
báo "LEVEL 2 · REAL Claude"). Gửi tin đa ngôn ngữ / sai chính tả:

```bash
./scripts/send.sh "+15105551234" "cản trước xe Accord 95"          # tiếng Việt
./scripts/send.sh "+15105551234" "parachoques delantero Accord 95" # tiếng Tây Ban Nha
./scripts/send.sh "+15105551234" "95 Acord front bumbper"          # sai chính tả
```
→ Xem Haiku có trích xuất đúng year/make/model/part + trả lời đúng ngôn ngữ không.
**Ghi lại ca sai** — nếu nhiều, cân nhắc đổi `LLM_MODEL=claude-sonnet-4-6` (chính
xác hơn) trong `.env.local` và so sánh.

### Kịch bản Mức 3 (DB thật — persistence)

Thêm `DATABASE_URL` (Supabase). Banner báo "LEVEL 3 · REAL Postgres". Migrations
chạy tự động lúc boot. Test những thứ MemoryStore không phản ánh đúng:

- **Dedupe webhook thật** — gửi 2 tin **cùng id** (sửa `send.sh` để cố định id,
  hoặc gửi nhanh 2 lần): chỉ 1 reply (unique index Postgres).
- **Bán-trùng qua transaction thật** — 2 hold đồng thời cùng SKU qty=1 → đúng 1
  thành công (`createHoldIfAvailable` dùng `SELECT ... FOR UPDATE`, chỉ đúng trên
  Postgres thật, không phải in-memory).
- **Cron** — chạy `npx tsx src/jobs/expiry.ts` (với `DATABASE_URL`) → hold hết hạn
  đổi `expired`, conversation quá TTL đóng.
- **Persistence** — restart server, conversation/hold vẫn còn (khác in-memory).

## Cách hoạt động (kiến trúc)

Bot tách mọi dịch vụ ngoài qua interface (`Store`, `LlmClient`, `QuoClient`,
`InventoryClient`). Harness dev (`src/dev/server.ts`) chỉ là `index.ts` với các
fake cắm vào thay client thật — logic pipeline chạy y hệt production. Đó là lý do
test cục bộ này phản ánh đúng hành vi thật (trừ chất lượng LLM và persistence).
