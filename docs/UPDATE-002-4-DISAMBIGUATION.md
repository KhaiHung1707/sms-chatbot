# Update 002 #4 — Model disambiguation (HỎI khi model mơ hồ)

> Ngày: 2026-07-22 · Trạng thái: CHỜ DUYỆT CÁCH LÀM → IMPLEMENT
> Yêu cầu Brandon: khi model khớp TỪ ĐẦU với nhiều biến thể, bot HỎI khách chọn.
> Đây là NGOẠI LỆ của #1 (silence-first): riêng model mơ hồ → được HỎI, không im.

## Ví dụ yêu cầu
Khách: "2007 honda civic front bumper"
DB có 3 model bắt đầu "CIVIC": CIVIC_COUPE, CIVIC_HYBRID, CIVIC_SEDAN
→ Bot HỎI: "Is it a Civic Coupe, Hybrid, or Sedan?"

## Vấn đề kỹ thuật (vì sao chưa chạy)
1. Search hiện dùng `WHERE model = 'civic'` (khớp CHÍNH XÁC). Plugin đã index cả
   `civic_coupe`, `civic_sedan`, `civic` (base) như các model RIÊNG → khi bot
   search "civic" nó chỉ khớp dòng base, KHÔNG thấy các trim.
2. Response không trả field `model` → bot không biết có bao nhiêu trim.

## Cách làm đề xuất

### Phần A — Plugin: endpoint mới trả các model khớp từ đầu
`GET /wp-json/obp/v1/models?make=honda&model=civic&year=2007`
→ trả danh sách DISTINCT model bắt đầu bằng "civic" (prefix match), vd:
   ["civic coupe", "civic hybrid", "civic sedan"]
- Nếu chỉ 1 model → không mơ hồ, bot search bình thường.
- Nếu >1 → bot HỎI khách chọn.

### Phần B — Bot: thêm tool "check_model_variants" (hoặc gọi trước search)
- Trước khi báo giá, nếu model khách đưa khớp NHIỀU biến thể → bot hỏi.
- Prompt: cho phép HỎI trong trường hợp NÀY (ngoại lệ của silence-first).
- Sau khi khách chọn (vd "sedan") → search `model=civic sedan` → báo giá bình thường.

### Phần C — Cập nhật prompt
- #1 vẫn là mặc định (im khi không chắc).
- NGOẠI LỆ được thêm: "Nếu model khớp nhiều trim (endpoint models trả >1) →
  HỎI khách chọn trim, liệt kê các lựa chọn. Đây là lần DUY NHẤT được hỏi lại."

## Rủi ro / cần cân nhắc
- Thêm 1 API call/tin (gọi models trước search) — nhẹ, chấp nhận được.
- Prefix match phải chuẩn hóa (civic vs CIVIC_COUPE với gạch dưới → space).
- Data đã index model đa biến thể — cần query DISTINCT base-prefix, không trùng.
- KHÔNG phá #1: chỉ model-mơ-hồ mới được hỏi; thiếu year/make/part vẫn IM.

## Các bước
1. Plugin: thêm endpoint `/models` (prefix match, distinct). Deploy Hostinger.
2. Bot: thêm tool/logic gọi models, phát hiện >1 → hỏi.
3. Prompt: thêm ngoại lệ disambiguation.
4. Test thật: "2007 civic front bumper" → bot hỏi Coupe/Sedan/Hybrid.
5. Deploy VPS.

## Cần xác nhận trước khi code
- Cách match "từ đầu": "civic" khớp "civic coupe/sedan/hybrid" — đúng ý? Còn
  "accord" khớp "accord sedan/coupe/hybrid" tương tự.
- Khi khách đã nói rõ trim ("civic sedan") → không hỏi, search thẳng. Đúng chứ?
