# A2P 10DLC — Phiếu điền thông tin (để dán vào Quo)

> Đây là **phiếu thu thập** đi kèm [`a2p-10dlc-checklist.md`](a2p-10dlc-checklist.md).
> Checklist giải thích *tại sao* & *bẫy*; phiếu này là chỗ **điền dữ liệu thật** rồi
> copy-paste thẳng vào form Quo. Điền xong là đăng ký được ngay.
>
> 🔴 Critical path ~2–3 tuần → điền + submit **tuần này**. Cần Brandon cung cấp mục ✍️.

---

## A. BRAND (doanh nghiệp) — hỏi Brandon ✍️

| Trường | Giá trị | Ghi chú |
|---|---|---|
| Legal business name | ✍️ `_______________` | **khớp CHÍNH XÁC** hồ sơ IRS, sai 1 chữ → từ chối |
| EIN (tax ID) | ✍️ `__-_______` | mã số thuế liên bang |
| Business type | ✍️ LLC / Corp / Sole Prop | |
| Registered address | ✍️ `_______________` | địa chỉ pháp lý (khớp IRS) |
| Website | `https://oaklandbodyparts.com` | ✓ đã biết |
| Industry / vertical | `Automotive — auto parts retail` | ✓ |
| Contact name | ✍️ `_______________` | |
| Contact email | ✍️ `_______________` | |
| Contact phone | ✍️ `_______________` | |

> ⚠️ Trước khi submit: đối chiếu Legal name + EIN + Address với **thư IRS EIN
> confirmation (CP-575)**. Đây là lý do #1 brand bị từ chối.

---

## B. CAMPAIGN — dùng sẵn, không cần nghĩ (đã tối ưu để được duyệt)

**Use case:** `Customer Care` ✅ (KHÔNG chọn Marketing/Low-Volume Mixed)

**Campaign description** (copy y nguyên):

```
Two-way customer support for an auto parts store. Customers text our published
number to ask about part availability, prices, and in-store pickup. An automated
assistant replies with real inventory information and can place a same-day hold
on an item at the customer's request. All conversations are customer-initiated.
```

**Sample messages** (copy y nguyên — đây là tin bot THẬT gửi, khớp code):

```
1. Front bumper for a 1995 Honda Accord is $129.95, 4 available for pickup at
   1911 Union St, Oakland. Reply STOP to opt out.

2. Got it — front bumper for a 1995 Honda Accord? Reply yes and I'll check price
   and availability.

3. 1 left as of right now — stock changes through the day, so I'd recommend a
   hold. Want me to hold it until 6 PM today?

4. You've been unsubscribed and won't get more texts. Reply HELP for our store
   info and hours.
```

**Opt-in / consent description** (copy y nguyên):

```
Consent is obtained when the customer initiates contact by texting our number,
which is published in-store and on oaklandbodyparts.com. Every first reply
includes opt-out instructions (Reply STOP). We send no promotional messages.
```

**Opt-out** → `STOP` (bot im lặng vĩnh viễn) · **Help** → `HELP` (trả thông tin cửa hàng)
*Cả hai đã code sẵn — guardrail R-15. Nói với reviewer đúng như trên.*

**Estimated volume:** ✍️ `_____ tin/ngày` (khai thật — auto parts shop nhỏ thường 10–100/ngày)

---

## C. SAU KHI DUYỆT (Brand 1–3 ngày, Campaign ~10–15 ngày)

- [ ] Gắn số **+1 510-451-2800** vào campaign đã duyệt trong Quo
- [ ] Gửi 1 tin test qua số đó → nếu trả `400 A2P Registration Not Approved`
      = số chưa link đúng campaign, chưa go-live được
- [ ] Gửi thành công → điền `QUO_PHONE_NUMBER=+15104512800`, `QUO_API_KEY`,
      `QUO_WEBHOOK_SECRET` vào `.env` → sang test cuối (GĐ D)

---

## Tiến độ

- [ ] A. Brand info thu đủ (Brandon)
- [ ] A. Submit Brand → chờ approval
- [ ] B. Submit Campaign (dùng bản trên) → chờ review
- [ ] C. Số gắn campaign + test gửi OK
