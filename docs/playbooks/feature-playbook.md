# Feature Playbook

Dùng playbook này khi thêm feature mới.

> **Bước 0 — bắt buộc:** tạo Change Spec theo [../standards/design-standard.md](../standards/design-standard.md)
> (copy [../templates/change-spec-template.md](../templates/change-spec-template.md)) và đạt Definition of Ready TRƯỚC khi code.

## 1. Đọc tài liệu liên quan (canonical)

Thứ tự tham chiếu — nguồn chân lý là `docs/`:

1. [../03-api-business-logic-spec.md](../specs/03-api-business-logic-spec.md) — contract API/nghiệp vụ hiện có
2. [../04-database-design.md](../specs/04-database-design.md) — schema/migration
3. [../06-rules-frontend.md](../rules/06-rules-frontend.md) · [../07-rules-backend.md](../rules/07-rules-backend.md) · [../08-rules-database.md](../rules/08-rules-database.md)
4. [../09-non-functional-requirements.md](../rules/09-non-functional-requirements.md)

## 2. Xac Dinh Domain

Tra loi nhanh:

- Feature thuoc module nao?
- Co can DB moi/cot moi khong?
- Co can API moi khong?
- Co anh huong domain visual nao khong?
- Co thao tac nguy hiem nao can confirm khong?

## 3. Thiet Ke Contract

Viet ra truoc khi code:

- DB table/column snake_case.
- API path/method.
- Request body camelCase.
- Response body camelCase.
- Error code neu co conflict nghiep vu.

## 4. Implement Backend Truoc Neu Co Data

Thu tu:

1. Migration trong `server/db.ts`.
2. Type/enum backend neu can.
3. Mapper DB row -> API shape.
4. Route validate input.
5. Prepared SQL.
6. Transaction neu nhieu buoc.
7. Error response dung status.

## 5. Implement Frontend

Thu tu:

1. Type UI/API.
2. API call qua helper.
3. State loading/error/empty.
4. Form/list/detail.
5. Feedback sau write.
6. Confirm cho destructive action.
7. UI theo FE rules:
   - Container lon trang.
   - Record/work area xam nhe.
   - Border xam 1px.
   - Primary teal.
   - Chevron icon cho prev/next.

## 6. Verify (theo [../standards/qa-standard.md](../standards/qa-standard.md))

Chạy — cả hai phải xanh:

```bash
npm test          # backend + frontend
npm run build     # tsc + bundle
```

Thêm test cho phần logic mới theo tầng phù hợp (Definition of Done ở qa-standard).
Nếu có UI thay đổi lớn → chạy smoke thủ công (qa-standard mục 8): Personal task · Project ·
Weekly report · Release · Luyện đề · MindMap.

## 7. Bao Cao Ket Qua

Final response nen gom:

- Da sua file/chuc nang nao.
- Build/test da chay.
- Warning/han che con lai neu co.

