# Performance & Resource Budget Standard — Task Manager

> Chuẩn **tối ưu tài nguyên bắt buộc**. Mỗi thay đổi phải giữ trong budget dưới đây + qua checklist mục 6.
> Nguồn: `vite.config.ts`, `src/main.tsx` (lazy), `server/db.ts`, `server/routes/*`, `scripts/build-sea.mjs`.
> Liên quan: [../09-non-functional-requirements.md §1](../rules/09-non-functional-requirements.md) (mục tiêu) · [../08-rules-database.md](../rules/08-rules-database.md) · [docs-standard.md](docs-standard.md).

---

## 0. TL;DR

1. **Bundle chính có ngân sách** (~135 kB gzip). Vượt → phải code-split, không nhắm mắt cho qua.
2. **DB: prepared + index + transaction**; không N+1, không `SELECT *` rồi lọc ở JS khi query được.
3. **List phải có `LIMIT`/phân trang** khi dữ liệu có thể lớn; `ORDER BY` ổn định + có index.
4. **Tiến trình con luôn có timeout**; không vòng lặp/interval dày hơn mức cần (reconcile 30s là đủ).
5. App **local single-process** → tối ưu cho khởi động nhanh + bộ nhớ gọn, không tối ưu cho scale nhiều user.
6. Đo bằng `npm run build` (kích thước) trước/sau; hồi quy budget = coi như lỗi.

---

## 1. Ngân sách (budget) — mục tiêu định lượng

| Hạng mục | Budget | Cách đo |
|---|---|---|
| Bundle **chính** (entry) | **≤ 500 kB raw / ~140 kB gzip** | `npm run build` (đang ~468 kB / 134 kB gzip) |
| Chunk **lazy** mỗi tab nặng | Tách riêng, không gộp vào entry | build in ra chunk `mind-map`, `luyen-de`, `skill-forge`… |
| Thời gian mở app (tới UI dùng được) | ⏱️ đặt mục tiêu (vd < 2s trên máy đích) | bấm giờ thủ công |
| API local (thao tác thường) | Gần như tức thời (< 50ms p95) | log/DevTools Network |
| Body request | Mặc định nhỏ; 32MB **chỉ** route import | `app.ts` |

> Con số là mục tiêu vận hành, không phải luật cứng — nhưng **vượt budget phải có lý do ghi trong commit message** và cân nhắc tối ưu.

## 2. Frontend — bundle & render

- [ ] **Code-split tab nặng/độc lập** bằng `React.lazy` + `Suspense` (đã áp cho luyện đề/mind-map/skill-forge). Tab mới nặng → lazy.
- [ ] Không import cả thư viện lớn cho một tính năng nhỏ (tree-shake được; tránh `import * as`).
- [ ] Asset nhúng (icon/ảnh) giữ nhỏ; ảnh lớn không inline vào bundle.
- [ ] Tránh re-render bão hòa: memo hóa danh sách lớn, tách state cục bộ; không đặt state đổi liên tục ở component cha bọc cả cây.
- [ ] Danh sách rất dài (đề thi, task lịch sử) → cân nhắc ảo hóa/limit hiển thị.
- [ ] Không thêm dependency runtime chỉ để làm việc nhỏ (mỗi dep = bundle + SEA to hơn — xem security §7).

## 3. Backend — DB & truy vấn

- [ ] **Prepared statement** tái sử dụng (chuẩn bị 1 lần, chạy nhiều) cho query nóng.
- [ ] **Index** cho cột dùng trong `WHERE`/`ORDER BY` thường xuyên; `ORDER BY` phải ổn định (kèm tie-breaker `id`).
- [ ] **Không N+1**: gom bằng `IN (?, ?, …)` thay vì loop query từng id.
- [ ] Không `SELECT *` rồi map/filter ở JS nếu có thể lọc/tính bằng SQL.
- [ ] Thao tác đa bước → **`withTransaction`** (đúng đắn **và** nhanh hơn nhiều lần commit lẻ).
- [ ] List có khả năng lớn → `LIMIT`/phân trang; không trả toàn bộ bảng vô điều kiện.
- [ ] Giữ **WAL**; chạy `VACUUM`/backup định kỳ (tránh phình file theo thời gian).

## 4. Tiến trình & bộ nhớ

- [ ] Mọi `spawn` (Claude, powershell healthcheck…) có **timeout + kill**; không để tiến trình treo giữ tài nguyên.
- [ ] Không interval/poll dày hơn cần: reconcile automation **30s** + on focus/visible là đủ; đừng hạ xuống vài giây.
- [ ] Không giữ tham chiếu lớn không cần (set/map `automation*Ref` chỉ chứa key occurrence, không giữ cả object task).
- [ ] Body limit lớn (32MB) chỉ mở cho route import → tránh mỗi request đều cấp phát vùng đệm lớn.
- [ ] App single-process: không tạo worker/child thừa cho việc nhẹ.

## 5. Đóng gói (SEA)

- [ ] Giữ số dependency **runtime** tối thiểu (đều bị bundle vào exe).
- [ ] `build-sea.mjs`: esbuild bundle + tree-shake; không kéo dev-only vào bản phát hành.
- [ ] Backup DB rolling khi build (`VACUUM INTO`) — giữ nhẹ, không copy cả WAL thừa.

## 6. Cổng review hiệu năng (khi đụng bundle/DB/vòng lặp)

Trước merge:
- [ ] `npm run build` chạy, **so kích thước bundle trước/sau**; tăng đột biến → điều tra (dep mới? quên lazy?).
- [ ] Query mới có index phù hợp; không N+1; list lớn có limit.
- [ ] Thao tác đa bước bọc transaction.
- [ ] Không thêm interval/poll dày; spawn có timeout.
- [ ] Không thêm dep runtime nếu tránh được.

## 7. Nợ hiệu năng / cần theo dõi

1. `src/main.tsx` từng là monolith 10k dòng — đã tách screens + code-split (bundle 837→468 kB). Giữ kỷ luật: tab/màn mới nặng → file riêng + lazy.
2. Thu hẹp body-limit 32MB về đúng route import (trùng với security §10).
3. Cân nhắc bổ sung index nếu list task/history/đề thi lớn dần (đo trước khi thêm).
4. Chưa có mốc đo khởi động/latency chính thức — đặt SLA ở [09-NFR §1](../rules/09-non-functional-requirements.md).

---

*Chuẩn này bổ sung, không thay thế, [09-NFR §1](../rules/09-non-functional-requirements.md). Thấy lỗi thời → sửa tại đây trong cùng lần giao.*
