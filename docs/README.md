# Task Manager — Bản đồ Tài liệu

> Nguồn chân lý cuối cùng là **code thực tế**. Bộ docs này phản ánh & quy chuẩn hóa hệ thống.
> Cách quản lý chính các tài liệu này: [standards/docs-standard.md](standards/docs-standard.md).

Tài liệu chia theo **câu hỏi mà nó trả lời**:

| Thư mục | Trả lời câu hỏi | Vòng đời |
|---|---|---|
| [specs/](specs/) | Hệ thống **LÀ** gì (hiện tại) | Sống cùng code |
| [rules/](rules/) | Xây dựng **NHƯ THẾ NÀO** | Sống cùng code |
| [standards/](standards/) | Chúng ta **LÀM VIỆC** ra sao | Sống cùng quy trình |
| [playbooks/](playbooks/) | Các **bước** làm một loại việc (khi **xây**) | Sống cùng quy trình |
| [operations/](operations/README.md) | **VẬN HÀNH & DUY TRÌ** cái đã xây (khi **chạy**) | Sống cùng hệ thống chạy thật |
| [backlog/](backlog/README.md) | Còn **VIỆC GÌ**, ưu tiên nào, Leader đã pick chưa | Sống cùng kế hoạch công việc |
| [exchanges/](exchanges/README.md) | **Trao đổi bất đồng bộ** giữa Codex/Claude/người đọc | Tạm — việc ngoài scope chuyển backlog; item đã pick mới thành CR/BUG |
| [proposals/](proposals/README.md) | Thiết kế **chưa triển khai** | Tạm — vào backlog, rồi thành CR khi Leader pick hoặc bị archive |
| [delivery/](delivery/README.md) | Đã **làm gì** (CR) và đã **hỏng ở đâu** (BUG) | **Vĩnh viễn** — là dữ liệu thống kê |
| [templates/](templates/) | Khuôn điền | Ổn định |
| [_archive/](_archive/) | Đã **hết hiệu lực** (giữ lịch sử) | Đóng băng |

---

## 📐 specs/ — hệ thống LÀ gì (trạng thái hiện tại)

| # | Tài liệu | Nội dung |
|---|---|---|
| 01 | [Product / Requirement Spec](specs/01-product-requirement-spec.md) | Bức tranh sản phẩm, phạm vi chức năng |
| 02 | [Screen Design & User Flow](specs/02-screen-design-user-flow.md) | Màn hình, popup, flow người dùng |
| 03 | [API & Business Logic Spec](specs/03-api-business-logic-spec.md) | Endpoint, validation, rule nghiệp vụ |
| 04 | [Database Design](specs/04-database-design.md) | Schema, migration, quan hệ dữ liệu |
| 05 | [Test & Acceptance Criteria](specs/05-test-acceptance-criteria.md) | Tiêu chí nghiệm thu theo feature |

## 🔧 rules/ — xây dựng NHƯ THẾ NÀO

| # | Tài liệu | Nội dung |
|---|---|---|
| 06 | [Frontend Rules](rules/06-rules-frontend.md) | Quy chuẩn UI/FE |
| 07 | [Backend Rules](rules/07-rules-backend.md) | Quy chuẩn route/API/validation |
| 08 | [Database Rules](rules/08-rules-database.md) | Quy chuẩn schema/migration/runtime DB |
| 09 | [Non-Functional Requirements](rules/09-non-functional-requirements.md) | Performance, security, reliability, packaging |

## 📋 standards/ — chúng ta LÀM VIỆC ra sao

| Tài liệu | Dùng khi |
|---|---|
| [Team Operating Standard](standards/team-operating-standard.md) | **Đọc trước tiên** — cách BA/Dev/Tester/Infra/Leader làm việc chung: bàn giao, glossary, RACI, ra quyết định |
| [Design Standard](standards/design-standard.md) | **Thêm/sửa/xóa chức năng** → tạo Change Spec trước khi code |
| [Security Baseline](standards/security-standard.md) | **Bảo mật bắt buộc**: secret, input, spawn/AI, supply-chain, đóng gói + cổng review |
| [Performance Budget](standards/performance-standard.md) | **Tối ưu tài nguyên**: ngân sách bundle/DB/tiến trình + cổng review |
| [QA Standard](standards/qa-standard.md) | **Test** khi triển khai (DoD, checklist theo loại thay đổi) |
| [Testing Strategy](standards/testing-strategy.md) | Cơ chế test: runner, tầng, cách chạy |
| [Docs Standard](standards/docs-standard.md) | **Quản lý chính các tài liệu**: phân loại, tên, vòng đời, đồng bộ code |

## 🧭 playbooks/ — các bước thao tác (khi XÂY)

| Tài liệu | Dùng khi |
|---|---|
| [Feature Playbook](playbooks/feature-playbook.md) | Thêm feature mới (thứ tự BE→FE→verify) |
| [UI Refactor Playbook](playbooks/ui-refactor-playbook.md) | Refactor UI giữ đúng two-layer/domain visual |

## ⚙️ operations/ — vận hành & duy trì (khi CHẠY)

> Khác playbooks: playbook nói cách **xây**, operations nói cách **chạy và duy trì** cái đã xây.
> Index: [operations/README.md](operations/README.md).

| Tài liệu | Dùng khi |
|---|---|
| [Hướng dẫn Release định kỳ](operations/huong-dan-release-dinh-ky.md) | Nắm mục đích + follow chung một chu kỳ release (dành cho cowork) |
| [Flow Release định kỳ — Runbook](operations/release-dinh-ky-flow.md) | Thực thi theo dòng thời gian: tuần nào làm gì |

## 🗂️ backlog/ — việc chưa làm và thứ tự ưu tiên

| Tài liệu | Dùng khi |
|---|---|
| [Product & Engineering Backlog](backlog/README.md) | **Leader quản lý**: triage, ưu tiên, pick, WIP và link item sang CR/BUG khi bắt đầu delivery |

## exchanges/ — trao đổi bất đồng bộ

| Tài liệu | Dùng khi |
|---|---|
| [Trao đổi giữa AI/dev](exchanges/README.md) | Ghi nhận phản biện/handoff; việc ngoài phạm vi chuyển backlog, item đã pick mới chốt thành CR/BUG |

## 💡 proposals/ — thiết kế chưa triển khai

> Chưa phải cam kết. Muốn cân nhắc ⇒ tạo [backlog item](backlog/README.md); Leader pick rồi mới chuyển thành
> Change Spec trong [changes/](delivery/changes/README.md).
> Index: [proposals/README.md](proposals/README.md).

| Tài liệu | Trạng thái |
|---|---|
| [Tích hợp Redmine + dùng chung cho team](proposals/redmine-integration-design.md) | Mới có `/redmine/config` + `/redmine/test`; **phần đồng bộ chưa code** |

## 📒 delivery/ — sổ cái Thay đổi & Lỗi

> Nơi duy nhất quản lý **CR** và **BUG** cùng **mối liên hệ giữa chúng**. Không chỉ để lưu: mỗi bug
> thoát cổng phải chỉ ra một **cổng đã hụt**, và mỗi cổng hụt phải để lại một sửa đổi trong
> quy trình/rule/standard. Index + registry + cách thống kê: [delivery/README.md](delivery/README.md).

| Mục | Nội dung |
|---|---|
| [delivery/README.md](delivery/README.md) | **Sổ cái**: bảng CR, bảng BUG, bảng phân loại nguyên nhân (RC), lệnh thống kê, nhịp rà soát |
| [delivery/changes/](delivery/changes/README.md) | `CR-*.md` — thay đổi đã quyết định làm |
| [delivery/bugs/](delivery/bugs/README.md) | `BUG-*.md` — lỗi đã **thoát cổng** (ngưỡng mở hồ sơ ở §2 sổ cái) |

## 📦 templates/

- [Change Spec Template](templates/change-spec-template.md) → copy vào [delivery/changes/](delivery/changes/README.md) thành `CR-*.md`.
- [Bug Record Template](templates/bug-record-template.md) → copy vào [delivery/bugs/](delivery/bugs/README.md) thành `BUG-*.md`.

## 🗄️ _archive/ — đã hết hiệu lực

Giữ làm lịch sử, **không dùng làm nguồn**. Mỗi file có banner đầu trang trỏ tới bản thay thế.

---

## Thứ tự đọc gợi ý

- **Mọi vai trò — đọc trước tiên:** [team-operating-standard](standards/team-operating-standard.md) (cách làm việc chung + glossary).
- **Chọn việc tiếp theo:** [backlog canonical](backlog/README.md) — chỉ item `Picked` mới được bắt đầu delivery.
- **Mới vào dự án:** [README gốc](../README.md) (chạy app) → [01](specs/01-product-requirement-spec.md) → [02](specs/02-screen-design-user-flow.md) → [03](specs/03-api-business-logic-spec.md) → [04](specs/04-database-design.md).
- **Thêm/sửa chức năng:** [design-standard](standards/design-standard.md) → [feature-playbook](playbooks/feature-playbook.md) → rule liên quan ([06–09](rules/)) → [security-standard](standards/security-standard.md) + [performance-standard](standards/performance-standard.md) (nếu đụng vùng nhạy cảm/tài nguyên) → [qa-standard](standards/qa-standard.md).
- **Sửa bug:** [qa-standard §3](standards/qa-standard.md) (test đỏ trước) → rule liên quan → nếu bug **thoát cổng**, mở hồ sơ [delivery/bugs/](delivery/bugs/README.md).
- **Rút kinh nghiệm / cải tiến quy trình:** [delivery/README §6–7](delivery/README.md) (thống kê cổng hụt → siết đúng cổng).
- **Chạy / vận hành hệ thống thật:** [operations/](operations/README.md).
- **Đụng tài liệu:** [docs-standard](standards/docs-standard.md).

## Ghi chú về nguồn

- Khi code và docs mâu thuẫn → ưu tiên code, cập nhật docs ngay trong cùng lần giao.
- `docs/` là **canonical**. Rule granular gốc đã curate xong vào [rules/](rules/) `06–09` từ 2026-08-01 và xoá bản gốc (git giữ lịch sử).
- `instroduction/` chỉ còn 2 file HTML mockup màu/theme.
- Các dòng `> ⏳ …` là phần cần quyết định sản phẩm/vận hành, chưa chốt trong code.
