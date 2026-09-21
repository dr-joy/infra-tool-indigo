# Bộ quy chuẩn Quản lý Tài liệu Kỹ thuật — Task Manager

> Quy tắc **quản trị chính các tài liệu** trong `docs/`: phân loại, đặt tên, vòng đời, đồng bộ với
> code, ai sửa, đặt ở đâu. Đây là "luật của thư viện tài liệu" — đọc trước khi **tạo/di chuyển/xóa** bất kỳ doc nào.
> Liên quan: [design-standard.md](design-standard.md) (chuẩn *thiết kế thay đổi*) · [qa-standard.md](qa-standard.md) (chuẩn *test*).

---

## 0. TL;DR

1. **Mỗi tài liệu thuộc đúng 1 nhóm** (mục 2). Không đặt sai chỗ.
2. **`docs/` là nguồn chân lý (canonical)**. Rule granular gốc đã được *curate* vào `docs/rules/06–09`; khi lệch, tin `docs/`.
3. **Code thắng khi mâu thuẫn** → nhưng phải **sửa doc ngay trong cùng lần giao** (không để nợ).
4. **Đặt tên nhất quán** theo mục 3. Không tạo doc trùng vai trò một doc đã có — sửa doc cũ.
5. Doc hết hiệu lực → **chuyển `_archive/`**, không xóa (giữ lịch sử).
6. Sửa cấu trúc/di chuyển doc → **cập nhật [../README.md](../README.md)** (bản đồ tài liệu) + sửa link trong cùng lần giao.

---

## 1. Mục đích

Giữ kho tài liệu **tìm được, tin được, không lệch code**. Tránh: tài liệu trùng lặp mâu thuẫn, không rõ đâu là bản chính, doc chết không ai dọn, link hỏng.

---

## 2. Phân loại (taxonomy) — mỗi doc thuộc đúng 1 nhóm

| Nhóm | Thư mục | Trả lời câu hỏi | Ví dụ |
|---|---|---|---|
| **Specs** (đặc tả trạng thái) | `docs/specs/` (01–05) | Hệ thống **LÀ** gì hiện tại | product, screen, API, database, acceptance criteria |
| **Rules** (quy tắc kỹ thuật) | `docs/rules/` (06–09) | Xây dựng **NHƯ THẾ NÀO** | FE/BE/DB rules, NFR |
| **Standards** (chuẩn quy trình) | `docs/standards/` | Chúng ta **LÀM VIỆC** ra sao | team-operating (ô dù), design, security, performance, qa, testing, **docs** (file này) |
| **Playbooks** (thao tác khi **xây**) | `docs/playbooks/` | Các **bước** làm 1 loại việc | feature, ui-refactor |
| **Operations** (thao tác khi **chạy**) | `docs/operations/` | **Vận hành & duy trì** cái đã xây | runbook release định kỳ |
| **Backlog** (việc chưa làm) | `docs/backlog/` | Còn việc gì, ưu tiên nào, đã được Leader pick chưa? | `BL-20260809-001` |
| **Exchanges** (trao đổi bất đồng bộ) | `docs/exchanges/` | Codex/Claude/người đọc cần phản biện hoặc handoff; việc ngoài phạm vi chuyển backlog | ghi nhận phản biện và quyết định |
| **Proposals** (đề xuất chưa làm) | `docs/proposals/` | Thiết kế **chưa triển khai** | tích hợp Redmine |
| **Delivery** (sổ cái giao hàng) | `docs/delivery/` | Đã **làm gì** và đã **hỏng ở đâu** | `changes/CR-*.md`, `bugs/BUG-*.md`, registry |
| **Templates** | `docs/templates/` | Khuôn điền | change-spec-template |
| **Archive** | `docs/_archive/` | Đã hết hiệu lực (giữ lịch sử) | design cũ đã fold |
| **Docs gốc repo** | `README.md`, `CLAUDE.md`, `instroduction/README.md` | Cách **chạy** dự án & cách **AI vận hành** nó | onboarding, lệnh, kiến trúc tóm tắt |

Nguyên tắc:
- **Specs mô tả cái đang có; Standards mô tả cách làm.** Đừng trộn (không nhét rule vào spec, không nhét quy trình vào specs).
- **Playbooks vs Operations**: playbook nói cách **xây** (thêm feature, refactor UI); operations nói cách
  **chạy và duy trì** cái đã xây (bật connector, theo lịch release, xử lý sự cố). Cùng là "các bước",
  khác ở *đối tượng*: một bên là codebase, một bên là hệ thống đang chạy.
- **Delivery không xóa hồ sơ.** `changes/` và `bugs/` là **dữ liệu thống kê** để cải tiến quy trình
  ([delivery/README §6](../delivery/README.md)), không phải rác cần dọn. Đây là ngoại lệ duy nhất của
  vòng đời "hết hiệu lực → archive" ở mục 6.
- **Proposals vs Changes**: proposal là *ý tưởng chưa cam kết*; Change Spec là *việc đã được Leader pick*.
  Muốn cân nhắc proposal ⇒ tạo backlog item; Leader pick ⇒ viết CR theo [design-standard](design-standard.md);
  CR nghiệm thu xong thì proposal chuyển `_archive/`.
- **Backlog vs Delivery**: backlog là hàng đợi ưu tiên do Leader sở hữu; CR/BUG là hồ sơ giao hàng. Item được
  pick mới mở CR/BUG khi đúng ngưỡng; backlog không sao chép thiết kế, FR/AC hay nhật ký review.
- **Trùng vai trò = mùi lỗi.** Trước khi tạo doc mới, tìm doc cùng vai trò để sửa/mở rộng.

> ⚠️ **Bẫy đã từng mắc (2026-08-01):** taxonomy trước đây **không có nhóm Operations**, nên 3 runbook
> vận hành **còn hiệu lực** (go-live automation + 2 runbook release định kỳ) bị đẩy nhầm vào `_archive/`
> — nơi mọi người mặc định là "đồ chết". Khi một doc không vừa nhóm nào, **thêm nhóm mới vào bảng này**,
> đừng nhét đại vào archive.

---

## 3. Đặt tên & vị trí

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Specs / Rules cốt lõi | Số thứ tự 2 chữ số + kebab | `03-api-business-logic-spec.md` |
| Standards | kebab-case, hậu tố `-standard`/`-strategy` | `qa-standard.md`, `testing-strategy.md` |
| Playbooks | kebab-case, hậu tố `-playbook` | `feature-playbook.md` |
| Operations | kebab-case, mô tả việc vận hành | `release-dinh-ky-flow.md` |
| Backlog item | một dòng ID `BL-<yyyymmdd>-<nnn>` trong `backlog/README.md` | `BL-20260809-001` |
| Proposals | kebab-case, hậu tố `-design` | `redmine-integration-design.md` |
| Bug | `BUG-<yyyymmdd>-<slug>.md` trong `delivery/bugs/` | `BUG-20260815-dang-trung-bai.md` |
| Change Spec | `CR-<yyyymmdd>-<slug>.md` | `CR-20260725-them-nhac-zalo.md` |
| Index | `README.md` mỗi thư mục có ≥3 file | `docs/README.md`, `docs/delivery/changes/README.md` |

- Tiêu đề H1 khớp tên/ vai trò file.
- Doc mới đặt **đúng thư mục nhóm** (mục 2). **`docs/` gốc chỉ chứa `README.md`** — mọi doc khác nằm
  trong thư mục nhóm. Specs/rules giữ tiền tố số (`01–09`) để bảo toàn thứ tự đọc, nhưng đặt trong
  `specs/` và `rules/`.

---

## 4. Header "Nguồn" — bắt buộc cho specs & rules

Mỗi spec/rule mở đầu bằng dòng trích **nguồn chân lý** (code + doc) mà nó phản ánh, để người đọc kiểm chứng và người sửa biết đồng bộ từ đâu:

```markdown
> Nguồn: `server/routes/tasks.ts`, `server/db.ts`, docs/specs/04-database-design.md
```

Khi refactor code làm đổi hành vi → cập nhật doc có `Nguồn` trỏ tới file đó. **Giữ dòng Nguồn đúng thực tế** (không trỏ file đã xóa/đổi tên).

> `npm run check` **tự kiểm** phần này: mọi đường dẫn trong dòng `Nguồn` phải tồn tại, và mọi lệnh
> `npm run X` được nhắc trong tài liệu phải có thật trong `package.json`. Đỏ là chặn push.

---

## 5. Đồng bộ với code (luật quan trọng nhất)

1. **Doc đi cùng code trong cùng lần giao.** Thêm cột DB ⇒ cập nhật `04` + `08` trong cùng lần giao. Đổi endpoint ⇒ cập nhật `03` + `07`.
1b. **Docs ở GỐC repo cũng chịu luật này** — `README.md`, `CLAUDE.md`, `instroduction/README.md`.
   Chúng nằm ngoài `docs/` nhưng **không phải vùng tự do**. Cụ thể phải đồng bộ khi:

   | Đổi gì trong code | Doc gốc phải sửa |
   |---|---|
   | Thêm/đổi/xoá script trong `package.json` | `README.md` (mục lệnh) + `CLAUDE.md` (Lệnh nhanh) |
   | Đổi hành vi một tính năng README có mô tả | `README.md` |
   | Đổi kiến trúc (thêm tầng, đổi vị trí file lớn) | `CLAUDE.md` (Kiến trúc tóm tắt) |
   | Đổi quy trình / cổng chất lượng | `CLAUDE.md` (Definition of Done) |

   > **Vì sao có mục này:** tài liệu sai khiến người tiếp quản sửa nhầm hoặc bỏ sót thay đổi cần thiết.
2. **Code là trọng tài.** Khi doc và code mâu thuẫn: sửa doc theo code (trừ khi code mới là bug — thì sửa code).
3. **Change Spec là delta tạm.** Làm xong 1 CR ⇒ fold nội dung vào `01–09`, chuyển CR sang trạng thái "Đã nghiệm thu" (giữ làm lịch sử, không cần cập nhật tiếp).
4. Không để "doc nợ": nếu chưa kịp cập nhật, ghi rõ `> ⏳ TODO: đồng bộ với <file>` để lần sau dọn.

---

## 6. Vòng đời tài liệu

```
Draft ──► Active ──► Deprecated ──► Archived (_archive/)
```

- **Draft**: đang soạn, chưa dùng làm chuẩn (ghi rõ ở đầu file).
- **Active**: bản chính đang hiệu lực.
- **Deprecated**: còn đúng một phần / sắp thay; thêm banner đầu file trỏ tới bản thay thế.
- **Archived**: hết hiệu lực → `git mv` vào `docs/_archive/`. **Không xóa** (Git giữ lịch sử; archive giúp tra cứu quyết định cũ).

Dọn định kỳ: khi một doc đã được nội dung khác thay thế hoàn toàn → chuyển archive + xóa link trỏ tới (hoặc trỏ sang bản mới).

**Ngoại lệ hiếm:** nếu bản archive **trùng 100%** nội dung canonical (đã curate xong, không còn giá trị
lịch sử riêng — chỉ gây nhiễu grep/tìm kiếm), có thể `git rm` khỏi working tree thay vì giữ trong
`_archive/` — Git vẫn giữ nguyên lịch sử qua commit cũ, chỉ không còn trong cây thư mục hiện tại.
Ví dụ: `_archive/granular-rules/` xoá 2026-08-05 sau khi xác nhận đã curate đủ vào `rules/06–09`.

---

## 7. Một hệ rule duy nhất

- **Canonical (chính thức):** [`../rules/`](../rules/) `06–09`. Đây là **nơi duy nhất** để đọc và sửa rule.
- Bộ rule granular gốc (trước ở `instroduction/rules/*`) đã curate xong từ 2026-08-01; bản archive
  `_archive/granular-rules/` bị xoá 2026-08-05 vì trùng 100% (xem mục 6 — ngoại lệ archive).
- **Không tạo hệ rule song song thứ hai.** Cần chi tiết hơn ⇒ viết thẳng vào `06–09`.

---

## 8. Liên kết & Index

- Dùng **link tương đối** (`../specs/04-database-design.md`), không hardcode URL tuyệt đối.
- Mỗi lần thêm/di chuyển/xóa doc ⇒ cập nhật [../README.md](../README.md) (bản đồ tài liệu master).
- Thư mục có index (`README.md`) ⇒ cập nhật index đó.
- Trước khi commit đụng docs: **quét link hỏng** (mở vài link chính, hoặc grep các đường dẫn markdown trỏ file không tồn tại).

---

## 9. Cổng chất lượng khi tạo/sửa doc (checklist trước commit)

Checklist thực thi đã chuyển sang skill
[`.claude/skills/docs-sync/SKILL.md`](../../.claude/skills/docs-sync/SKILL.md) — nguồn thật duy nhất cho
phần "check gì trước commit". File này (mục 1–8, 10, 11) giữ taxonomy, quy ước đặt tên, vòng đời, ownership.

---

## 10. Ai sửa cái gì (ownership tối giản — app 1 người/nhóm nhỏ)

- Người thực hiện thay đổi code = người cập nhật doc tương ứng (specs/rules) trong cùng lần giao.
- BA sở hữu `delivery/changes/`, `proposals/` và `specs/01`, `specs/02`.
- Tester sở hữu `delivery/bugs/` + sổ cái `delivery/README.md`; Leader chủ trì đợt thống kê.
- Dev sở hữu `specs/03`, `specs/04`, `rules/06–09`, `standards/`, `playbooks/`.
- Infra sở hữu `operations/` — runbook vận hành phải khớp thực tế máy đang chạy.
- Leader sở hữu `backlog/README.md` — triage, ưu tiên, pick, WIP và trạng thái đóng.
- **Docs gốc repo** (`README.md`, `CLAUDE.md`): người đổi code/quy trình cập nhật ngay trong cùng lần giao; Leader chịu trách nhiệm cuối.
- Bất kỳ ai thấy doc lệch code đều có trách nhiệm sửa hoặc gắn `⏳ TODO`.

---

## 11. Bản đồ quan hệ

```
docs/README.md ............. index / bản đồ master
├─ specs/ 01–05 ............ trạng thái hệ thống (LÀ gì) + nghiệm thu tổng
├─ rules/ 06–09 ............ cách xây (NHƯ THẾ NÀO)
├─ standards/ .............. cách làm việc: team-operating(ô dù) · design · security · performance · qa · testing · docs(này)
├─ playbooks/ .............. các bước khi XÂY (feature, ui-refactor)
├─ operations/ ............. các bước khi CHẠY (go-live, runbook release)
├─ backlog/ ................ việc chưa làm + ưu tiên + quyết định pick (Leader sở hữu)
├─ exchanges/ .............. trao đổi bất đồng bộ Codex/Claude trước khi chốt CR/BUG
├─ proposals/ .............. thiết kế chưa triển khai
├─ delivery/ ............... sổ cái: changes/ (CR) + bugs/ (BUG) + registry thống kê
├─ templates/ .............. khuôn điền (change-spec, bug-record)
└─ _archive/ ............... lịch sử hết hiệu lực
README.md .................. cách CHẠY dự án (docs gốc — cũng chịu luật này, mục 5.1b)
CLAUDE.md .................. cách AI VẬN HÀNH dự án (docs gốc)
```

---

*Quy chuẩn này cũng là một doc — chịu chính luật của nó. Thấy lỗi thời → sửa tại đây trong cùng lần giao.*
