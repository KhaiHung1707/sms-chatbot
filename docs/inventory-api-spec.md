# Inventory API — Spec kỹ thuật cho plugin WordPress/WooCommerce

> **Deliverable riêng (PHP).** Middleware chỉ gọi contract này. Tài liệu này là
> yêu cầu để bên làm plugin implement — mục tiêu tối thượng: **tra cứu trong
> 74.000 sản phẩm phải xong dưới 8 giây, ổn định, trên Hostinger.**

## 1. Vì sao KHÔNG được query `wp_postmeta` trực tiếp

Nghiên cứu đã xác nhận (xem đăng ký rủi ro R-11/R-12):

- 74k sản phẩm ≈ **hàng triệu dòng** `wp_postmeta`. Cột `meta_value` **không có
  index** → mỗi truy vấn theo giá trị meta là **full table scan** (nhiều giây).
- Mỗi điều kiện meta thêm một `LEFT JOIN` lên `wp_postmeta`; lọc year+make+model+part
  = nhiều join chồng nhau + filesort.
- WooCommerce REST gốc (`/wc/v3/products`) cap 100 record/trang, tốn full WP
  bootstrap mỗi request, không filter meta native. Một dev đã đo **~20s TTFB chỉ
  với ~5k sản phẩm** nhiều attribute.
- Hostinger shared: PHP mặc định 30s, **không có Redis**, có quota CPU "fair-use"
  ẩn gây 503 khi một query nặng chiếm worker. Budget 8s của middleware gần như
  chắc chắn là timeout phía client trước khi PHP xong.

**Kết luận:** bắt buộc dùng **bảng lookup denormalized có index riêng**, không đụng
`wp_postmeta` trong đường truy vấn nóng.

## 2. Bảng lookup

Tạo một bảng phẳng, mỗi dòng là một cặp (fitment × sản phẩm). Một sản phẩm hợp
nhiều xe → nhiều dòng (quan hệ many-to-many, đúng bản chất fitment).

```sql
CREATE TABLE wp_obp_parts_lookup (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id   BIGINT UNSIGNED NOT NULL,      -- con trỏ tới wp_posts (WooCommerce product)
  year         SMALLINT UNSIGNED NOT NULL,    -- 1 dòng cho MỖI năm áp dụng (không lưu range)
  make         VARCHAR(64)  NOT NULL,         -- chuẩn hoá lowercase khi ghi
  model        VARCHAR(96)  NOT NULL,         -- chuẩn hoá lowercase khi ghi
  part_type    VARCHAR(96)  NOT NULL,         -- chuẩn hoá lowercase, ví dụ "front bumper"
  position     VARCHAR(32)  NULL,             -- front/rear/left/right nếu có (R-03)
  sku          VARCHAR(64)  NOT NULL,
  title        VARCHAR(255) NOT NULL,
  price        DECIMAL(10,2) NOT NULL,        -- snapshot; giá "sự thật" vẫn đọc lúc reply nếu cần
  variants     JSON NULL,                     -- ["black","primed","painted"]
  updated_at   DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_fitment (make, model, year, part_type),   -- index tổ hợp CHÍNH cho tra cứu
  KEY idx_product (product_id)
);
```

**Điểm then chốt:**
- **Lưu MỖI năm một dòng**, không lưu "1995–1997". Truy vấn theo năm chính xác
  thành index seek, không phải range scan.
- **Chuẩn hoá `make`/`model`/`part_type` về lowercase khi GHI**, và truy vấn cũng
  lowercase — tránh phụ thuộc collation, cho phép so khớp thẳng qua index.
- Index tổ hợp `(make, model, year, part_type)` khớp đúng thứ tự cột truy vấn.

## 3. Đồng bộ dữ liệu vào bảng lookup

Bảng này là **bản sao denormalized**, phải được cập nhật khi sản phẩm thay đổi:

- **Hook** `save_post_product` / WooCommerce product CRUD → regenerate các dòng của
  product đó.
- **Bulk rebuild** qua WP-CLI cho lần nạp đầu và sau import CSV/ERP (import thường
  bypass CRUD hooks → bảng dễ stale, giống bài học `wc_product_meta_lookup`).
- Chạy rebuild nặng qua **WP-Cron/CLI nền**, không trong request người dùng.

> Giá/tồn "sự thật" vẫn có thể đọc tươi từ WooCommerce tại thời điểm plugin trả
> lời, nhưng **việc TÌM sản phẩm** phải qua bảng lookup có index.

## 4. Endpoint

```
GET /wp-json/obp/v1/parts/search
Headers: X-OBP-Api-Key: <INVENTORY_API_KEY>
Query:   year=1995&make=Honda&model=Accord&part=front%20bumper
```

Xử lý phía plugin:
1. Xác thực `X-OBP-Api-Key` (so khớp hằng số/option). Sai → `401`.
2. Lowercase + trim `make`, `model`, `part` từ query.
3. Truy vấn `wp_obp_parts_lookup` qua index tổ hợp — **chỉ một index seek**.
4. Với mỗi product_id khớp, đọc giá + tồn hiện tại (từ `wc_product_meta_lookup`
   hoặc WooCommerce CRUD — KHÔNG từ `wp_postmeta` scan).
5. Trả về đúng shape §5 dưới đây.

### Response 200 — có kết quả

```json
{
  "results": [
    {
      "product_id": 48213,
      "sku": "HO1000123",
      "title": "Front Bumper Cover — 1995-97 Honda Accord",
      "price": 129.95,
      "variants": ["black", "primed", "painted"],
      "inventory": [
        { "warehouse": "US", "qty": 4 },
        { "warehouse": "CA", "qty": 0 }
      ]
    }
  ]
}
```

### Các mã trạng thái

| Tình huống | HTTP | Body |
|---|---|---|
| Có kết quả | `200` | `{ "results": [ … ] }` |
| Không tìm thấy | `200` | `{ "results": [] }` |
| Sai/thiếu API key | `401` | `{ "error": "unauthorized" }` |
| Quá tải / rate limit | `429` | `{ "error": "rate_limited" }` |

Middleware coi mọi thứ khác `200` (và timeout > 8s) là `api_error` → trả lời xin
lỗi KHÔNG chứa số (guardrail vàng).

## 5. Yêu cầu hiệu năng (SLA đề xuất)

- **p95 < 2s**, p99 < 5s cho một truy vấn fitment đơn, đo trên dữ liệu 74k thật.
- Middleware timeout 8s, retry 1 lần — plugin phải xong tốt trong ngưỡng này.
- **Bắt buộc chạy `EXPLAIN`** trên truy vấn tra cứu với bản sao dữ liệu 74k trước
  khi go-live; xác nhận dùng `idx_fitment` (không `type: ALL`).

## 6. Nhiều kết quả → middleware để khách chọn

Nếu một truy vấn khớp nhiều biến thể (sedan vs coupe, front vs rear), **trả về tất
cả** trong `results`. Bot (theo confidence gate) sẽ liệt kê cho khách chọn thay vì
tự đoán — plugin không cần chọn hộ. Đây là lý do `position` nằm trong bảng.
