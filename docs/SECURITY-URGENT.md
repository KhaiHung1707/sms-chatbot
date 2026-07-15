# 🔴 BẢO MẬT — Làm NGAY trước khi làm gì khác

> Trong quá trình phát triển, một số credential đã bị **dán vào cửa sổ chat**.
> Bất cứ thứ gì dán vào chat phải coi như **đã lộ** và phải xoay vòng (rotate).
> Đây là việc **khẩn cấp** — làm trước A2P, trước deploy.

---

## 1. Anthropic API key — REVOKE + tạo mới 🔴

Key `sk-ant-api03-…` đã bị dán trong một lệnh curl ở chat → coi như công khai.

- [ ] Vào <https://console.anthropic.com/settings/keys>
- [ ] **Revoke (Delete)** key cũ đã dán trong chat
- [ ] **Create Key** mới, đặt tên rõ (vd `obp-sms-prod`)
- [ ] Dán key mới vào `.env.local` (dev) và `.env` production — **KHÔNG dán lại vào chat**
- [ ] Bật **usage limit / budget alert** trong console để chặn cháy tiền nếu key rò rỉ lần nữa

> Vì sao gấp: key lộ = người khác gọi API tính tiền vào tài khoản bạn cho tới khi hết hạn mức.

---

## 2. Mật khẩu database Supabase — ĐỔI 🔴

Connection string chứa mật khẩu DB (`postgresql://postgres.….:PASSWORD@…`) đã bị
dán trong chat → mật khẩu đó coi như lộ.

- [ ] Vào Supabase → **Project Settings → Database → Reset database password**
- [ ] Copy connection string **Session pooler** mới (port 5432, IPv4 — bắt buộc cho mạng nhà)
- [ ] Cập nhật `DATABASE_URL` trong `.env.local` và `.env` production — **KHÔNG dán lại vào chat**
- [ ] (Khuyến nghị) Bật **RLS**/hạn chế IP nếu Supabase plan cho phép

> Vì sao gấp: chuỗi này cho phép kết nối trực tiếp vào DB khách hàng — đọc/xoá dữ liệu.

---

## 3. Xác nhận không có secret nào bị commit 🟡

- [ ] `.env.local` và `.env` đã nằm trong `.gitignore` ✓ (đã kiểm: có)
- [ ] Chạy kiểm tra lịch sử git nếu repo từng được commit/push:
      `git log -p -- .env .env.local | grep -i "sk-ant\|postgres" ` — phải rỗng
- [ ] Nếu từng lỡ commit: dùng `git filter-repo` xoá khỏi lịch sử **và** vẫn phải rotate
      (xoá khỏi lịch sử KHÔNG đủ nếu đã push — vẫn coi như lộ)

---

## 4. Quy tắc từ nay 🟢

- Không bao giờ dán key/mật khẩu/connection string vào chat, ticket, hay ảnh chụp màn hình.
- Cần chia sẻ secret → dùng trình quản lý bí mật (1Password, Doppler, Vault) hoặc
  biến môi trường trên server, không qua kênh chat.
- Mỗi môi trường (dev/prod) một key riêng để revoke độc lập.

---

**Trạng thái:** ⬜ chưa làm → cập nhật thành ✅ khi xong cả mục 1 và 2.
