# Delivery — Sổ cái Thay đổi & Lỗi

> Nơi **duy nhất** quản lý ba loại hồ sơ giao hàng và **mối liên hệ giữa chúng**:
> [changes/](changes/README.md) (`CR-*` — thay đổi đã quyết định làm),
> [bugs/](bugs/README.md) (`BUG-*` — lỗi đã **thoát cổng**), và
> **[Sổ Sai lệch & Bài học](#5b-sổ-sai-lệch--bài-học-lesson)** (`L-*` — quy trình hụt nhưng **không** thành bug).
>
> Mục đích không phải để lưu trữ. Mục đích là: **mỗi lỗi phải chỉ ra được một cổng đã hụt, và mỗi cổng
> hụt phải để lại một sửa đổi trong quy trình/rule/standard.** Không có vòng lặp đó thì sổ này chỉ là
> nghĩa địa tài liệu.

---

## 1. Vòng lặp cải tiến (lý do thư mục này tồn tại)

> Delivery **không phải backlog**. Việc chưa làm và thứ tự ưu tiên nằm ở
> [backlog canonical](../backlog/README.md). Thư mục này chỉ giữ hồ sơ CR/BUG/LESSON sau khi item đã được pick
> hoặc khi bug đạt ngưỡng phải ghi nhận ngay.

```
   Yêu cầu ──► backlog ──Leader pick──► A / B / C ──► giao hàng ──► nghiệm thu ──► ship
                                               │
                                               ▼
                                        lỗi lọt ra ngoài
                                               │
                          ┌────────────────────▼─────────────────────┐
                          │  BUG-*.md                                 │
                          │   • sinh ra bởi CR nào?                   │
                          │   • CỔNG nào lẽ ra phải bắt? (①–⑧)        │
                          │   • loại nguyên nhân? (RC-*)              │
                          └────────────────────┬─────────────────────┘
                                               │  gom lại, đọc theo cụm
                                               ▼
                         "cổng ⑤ hụt 3 lần vì cùng một lý do"
                                               │
                                               ▼
                    sửa standard / rule / checklist  ──► cổng chặt hơn
                                               │
                                               └──► lần sau bug loại đó không lọt nữa
```

**Quy tắc vàng:** *bug đã sửa mà không để lại thay đổi nào trong quy trình = chưa học được gì.*
Nếu quyết định **không** cải tiến, phải ghi rõ lý do trong hồ sơ (mục 6 của template) — để lần thống
kê sau không hiểu nhầm là bỏ sót.

---

## 2. Ngưỡng mở hồ sơ BUG

> **Không phải bug thì ghi ở đâu?** AC không đạt, ước lượng lệch, docs sai thực tế, cổng mô tả thứ
> không tồn tại — những thứ đó **không** vào sổ BUG (không có gì thoát cổng), mà vào
> [Sổ Sai lệch & Bài học §5b](#5b-sổ-sai-lệch--bài-học-lesson): một dòng, dùng chung mã RC.

| Tình huống | Mở hồ sơ? |
|---|---|
| Lỗi phát hiện **sau khi BA nghiệm thu** (cổng ⑦) hoặc lúc **dùng thật** | ✅ **Có** |
| Lỗi làm **sai/mất dữ liệu**, dù bắt được sớm | ✅ **Có** |
| Lỗi **bảo mật**, dù bắt được sớm | ✅ **Có** |
| Dev tự thấy sai lúc đang code, sửa ngay | ❌ Không |
| Tester bắt được ở cổng ⑦ trước khi BA nghiệm thu | ❌ Không — *đó là cổng đang hoạt động đúng* |
| Sai chính tả / CSS lệch, không ai hiểu nhầm | ❌ Không |

> Lý do ngưỡng này: thống kê để **vá cổng**. Chỉ bug **thoát cổng** mới chứng minh có cổng hỏng.
> Bug bị bắt đúng chỗ là bằng chứng quy trình chạy tốt, không cần hồ sơ.
> Vẫn phải theo [qa-standard §3](../standards/qa-standard.md) (test đỏ trước) **kể cả khi không mở hồ sơ**.

---

## 3. Bảng phân loại nguyên nhân (RC) → standard chịu trách nhiệm

Chọn **đúng một** mã. Cột cuối là *đòn bẩy cải tiến*: RC nào lặp nhiều thì standard đó đang yếu.

| Mã | Nghĩa | Standard/rule cần siết khi lặp lại |
|---|---|---|
| **RC-REQ** | Hiểu sai / thiếu yêu cầu gốc | [team-operating §6 cổng ①](../standards/team-operating-standard.md) |
| **RC-SPEC** | Spec thiếu ca, AC không phủ, DoR gật ẩu | [design-standard §4, §7](../standards/design-standard.md) |
| **RC-IMPL** | Spec đúng nhưng code sai | [rules/06–09](../rules/) |
| **RC-TEST** | Có test nhưng không phủ ca đó / chọn sai tầng | [qa-standard](../standards/qa-standard.md) · [testing-strategy](../standards/testing-strategy.md) |
| **RC-DATA** | Dữ liệu cũ, migration, backward-compat | [rules/08](../rules/08-rules-database.md) · [design-standard §8](../standards/design-standard.md) |
| **RC-INTEG** | Tích hợp ngoài (Claude/MCP/Dr.JOY/Redmine) đổi hành vi | [security-standard](../standards/security-standard.md) · [operations/](../operations/README.md) |
| **RC-PERF** | Tài nguyên: bundle, query, tiến trình, timeout | [performance-standard](../standards/performance-standard.md) |
| **RC-SEC** | Lộ secret, thiếu validate, nới quyền | [security-standard §9](../standards/security-standard.md) |
| **RC-DOC** | Docs lệch code khiến người sau làm sai | [docs-standard §5](../standards/docs-standard.md) |
| **RC-PROC** | Bỏ bước / đảo bước / "sửa ngầm" | [team-operating §5](../standards/team-operating-standard.md) |

---

## 4. Sổ Change Request (CR)

| CR | Tên | Mức tác động | Trạng thái | Bug sinh ra |
|---|---|---|---|---|
| [CR-20260913](changes/CR-20260913-nen-tang-da-nguoi-dung.md) | **Nền tảng đa người dùng** — đưa tool lên server cho nhiều team: OIDC + phiên, mô hình User/Team, phân quyền 4 tầng (bảng hiển thị team × chức năng, luật năng lực cố định, vai điều phối release), PIC→User + nhiều người phụ trách, Release nhiều team (xung đột/khoá/bài gộp 2 ngôn ngữ), `SEC-PERF-001..016`, đóng gói container + ổ lưu trữ bền, gỡ MCP | **Lớn** (vùng nhạy cảm: xác thực, mở ra Internet công khai, endpoint mới, đóng gói; đụng DB toàn bộ + mọi màn) | **Đã review** — 57 FR / 47 AC, chia 6 lát + 3 cổng DoR; qua 3 phiên Council thật (hội tụ); chờ Leader duyệt DoR + câu trả lời hạ tầng cho 6 câu chặn | — |
| [CR-20260913-b](changes/CR-20260913-b-emergency-batch-da-dang.md) | Cờ "đã đăng bài" thủ công cho batch release khẩn cấp — vá lớp bảo vệ mất khi xoá AI automation, thêm màn hiển thị/sửa team-hệ thống của đợt (trước đây dữ liệu đã fetch nhưng chưa từng render) | Vừa (đụng DB + hợp đồng API) | **Đã nghiệm thu** (tự đối chiếu, chưa qua Leader xác nhận UI thật) — 7 test mới, `npm run check` xanh 9/9, đã package | — |
| [CR-20260913-c](changes/CR-20260913-c-design-token-va-error-code.md) | Ruleset design token FE (4 nhóm token CSS custom property + cổng snapshot multiset chặn hardcode mới) và registry mã lỗi BE (6 mã thật + cổng chặn mã mới chưa đăng ký) — chốt qua Council thật (run `0e0ddc52`) | Vừa (CSS/Tailwind toàn cục + 2 cổng máy mới) | **Đã triển khai** — 15 test unit mới, build/cổng máy xanh; chờ Council review diff trước commit | — |
| [CR-20260801](changes/CR-20260801-scheduler-automation-ve-server.md) | Chuyển scheduler automation FE → BE | Lớn | **Đã nghiệm thu** (16/17 AC — AC-12 sai lệch có ghi nhận) | [BUG-20260803-automation-sai-mui-gio](bugs/BUG-20260803-automation-sai-mui-gio.md) |
| [CR-20260803](changes/CR-20260803-precheck-doc-duoc-mcp.md) | Pha precheck đọc được Dr.JOY qua MCP (bỏ `plan` làm cơ chế chính, thay bằng whitelist đã lọc + deny tường minh) | Lớn (vùng nhạy cảm: phân quyền spawn AI) | **Đã nghiệm thu** (7/7 AC, gồm 2 ca CLI thật) | — |
| [CR-20260804](changes/CR-20260804-cong-may-gio-vn.md) | Cổng máy chặn API/helper giờ-máy trong vùng quyết định (`npm run check` thi hành rule gốc thời gian — trước đó chỉ có người gác và đã lọt 3 lần) | Vừa (build/tooling + rules 06/07) | **Đã triển khai** (6/6 AC, 20 unit test) | — |
| [CR-20260805](changes/CR-20260805-whitelist-tool-theo-action-automation.md) | Whitelist tool đọc theo nhóm automation (`CLAUDE_READ_TOOLS_POST/OTHER`) để không mở Drive/Sheets/Calendar cho mọi preview | Vừa (automation + phân quyền tool) | **Đã triển khai** (`npm run check` xanh; smoke connector thật chờ Leader) | — |
| [CR-20260808](changes/CR-20260808-luong-duyet-cho-dung-gio-bao-ket-qua.md) | Duyệt xong chờ đúng giờ, chạy xong báo kết quả theo occurrence | Lớn (API + scheduler + UI orchestration + automation ghi ngoài) | **Đã nghiệm thu** (Claude re-review §46 PASS; 280 backend + 208 frontend; Leader chấp nhận UAT UI) | — |
| [CR-20260809](changes/CR-20260809-backlog-canonical-va-luong-pick.md) | Backlog canonical do Leader sở hữu; chỉ item được pick mới đi A/B/C và mở CR/BUG khi đúng ngưỡng | Vừa (quy trình + docs) | **Đã nghiệm thu** | — |
| [CR-20260814-hop-nhat](changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md) | Hợp nhất luật đồng bộ definition → task release (match `origin_ref`, UPDATE thay DELETE/INSERT) + phát hiện lệch chủ động 3 nơi + precheck **chặn** trước khi AI ghi ra ngoài + BE là nơi dựng payload | Lớn (nhiều màn + automation ghi ngoài) | **Đã review** (Codex §14: 5 finding + chốt `?1–?5` → Claude §15 nhận cả 5) — chờ Leader duyệt, chưa code | [BUG-20260814-ai-dang-bai-bang-huong-dan-cu](bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md) |
| [CR-20260819](changes/CR-20260819-o-nhap-nguoi-mention-emergency-giai-doan-1.md) | Ô nhập tên người mention — nhiều người, nút "+" (tuỳ chọn) ngay lúc tạo task khẩn cấp giai đoạn 1 — điền vào đúng dòng `@` trơ của task E1 theo quy tắc nối "A, B, C"; nhân tiện lazy-load `release.tsx` để hết vượt ngân sách bundle | Nhỏ (FE-only, không đổi DB/API/automation) | **Đã nghiệm thu** — 13 test mới, 2 vòng smoke thật (1 và 3 người) qua đúng luồng client→API→DB, `npm run check` xanh | — |
| [CR-20260817](changes/CR-20260817-giu-xuong-dong-khi-ai-dang-drjoy.md) | App dựng sẵn Quill HTML cho Dr.JOY (`noteToQuillHtml`), AI chỉ gửi nguyên văn; fail-closed khi không dựng được | Vừa (automation ghi ngoài + hợp đồng prompt) | **Đã nghiệm thu** — 13 test mới (test đỏ trước), 8/8 AC, smoke thật 2 nhánh (bài mới + comment) trên group nháp rồi xoá; HTML trên Dr.JOY khớp từng ký tự | — |
| [CR-20260814](changes/CR-20260814-cau-hinh-claude-bin-khong-phu-thuoc-env.md) | Cấu hình automation AI không phụ thuộc env lúc launch: resolver một cửa + `app_settings` đọc mỗi request + tự dò `claude` + Cài đặt → AI + cổng máy | Lớn (vùng nhạy cảm: spawn theo path cấu hình được) | **Đã triển khai (lát 1)** — 28 test mới, `npm run check` xanh; còn nợ smoke máy thật + lát 2 (whitelist tool, `?9`) | — |

## 5. Sổ Bug

| BUG | Triệu chứng | Sinh bởi | Cổng hụt | RC | Cải tiến |
|---|---|---|---|---|---|
| [BUG-20260803-automation-sai-mui-gio](bugs/BUG-20260803-automation-sai-mui-gio.md) | Task AI bị báo "đã lỡ giờ" sớm 2 tiếng (máy đặt JST); task của ngày khác cũng bị đánh lỡ | [CR-20260801](changes/CR-20260801-scheduler-automation-ve-server.md) | ② Thiết kế | RC-SPEC | [rules/07 §8.1–8.2](../rules/07-rules-backend.md) · [rules/06 §8](../rules/06-rules-frontend.md) · [qa §6](../standards/qa-standard.md) · [design §9.4](../standards/design-standard.md) |
| [BUG-20260803-precheck-khong-doc-duoc-mcp](bugs/BUG-20260803-precheck-khong-doc-duoc-mcp.md) | Bản xem trước không đối chiếu được với Dr.JOY (`plan` chặn cả tool đọc) ⇒ không chống được đăng trùng bài | Có sẵn từ khi làm Automation AI | ② Thiết kế | RC-SPEC + RC-TEST | [security §5](../standards/security-standard.md) · [qa §8.1](../standards/qa-standard.md) · [go-live guide](../operations/automation-ai-go-live-guide.md) · sửa bằng [CR-20260803](changes/CR-20260803-precheck-doc-duoc-mcp.md) |
| [BUG-20260803-bat-app-trung](bugs/BUG-20260803-bat-app-trung.md) | Mỗi lần Claude/Codex bật hoặc chuyển mode lại mọc thêm tiến trình app (5 MCP sống song song); tiến trình thua port không thoát → tiến trình rác | Có sẵn từ khi làm MCP server | ② Thiết kế + ⑥ Cổng hạ tầng | RC-SPEC + RC-TEST | [rules/07 §8.3](../rules/07-rules-backend.md) · [design §9.4](../standards/design-standard.md) · [qa §8.3](../standards/qa-standard.md) |
| [BUG-20260803-pha-ghi-thieu-tool-doc](bugs/BUG-20260803-pha-ghi-thieu-tool-doc.md) | AI tạo 1 bài rác `probe` trên group PM thật (dùng tool ghi để dò quyền vì không có tool đọc); bài đăng thành công lại bị app ghi `failed` ⇒ nguy cơ đăng trùng | Có sẵn từ khi làm Automation AI | ② Thiết kế + ⑥ Cổng hạ tầng | RC-SPEC + RC-TEST | [security §5](../standards/security-standard.md) · [rules/07 §9.1](../rules/07-rules-backend.md) · [qa §8.2](../standards/qa-standard.md) |

| [BUG-20260804-gio-may-lot-3-call-site](bugs/BUG-20260804-gio-may-lot-3-call-site.md) | Popup mời "Phê duyệt & chạy ngay" **sớm 1.5 tiếng** trên máy JST (⇒ đăng bài sai giờ); nhật ký automation tách đôi và release sync bỏ im lặng task của hôm nay sau 22:00 VN | [CR-20260801](changes/CR-20260801-scheduler-automation-ve-server.md) — **sót lại sau lần sửa BUG-20260803** | ⑥ Cổng hạ tầng + ⑦ Nghiệm thu | RC-IMPL + RC-PROC | **Cổng máy** [`check-tz.mjs`](../../scripts/check-tz.mjs) ([CR-20260804](changes/CR-20260804-cong-may-gio-vn.md)) · [rules/07 §8.1](../rules/07-rules-backend.md) · [rules/06](../rules/06-rules-frontend.md) · [qa §3](../standards/qa-standard.md) · [ADR-P2](../standards/team-operating-standard.md) · [spec 03](../specs/03-api-business-logic-spec.md) |

| [BUG-20260808-banner-mcp-bao-dong-gia](bugs/BUG-20260808-banner-mcp-bao-dong-gia.md) | Banner "Dr.JOY chưa xác thực — task AI sẽ không chạy" hiện thường trực dù Dr.JOY đang chạy tốt (cùng lúc đọc 146 group + đăng bài thật); còn chỉ user đi auth một connector `drjoy` không còn tồn tại | Có sẵn từ trước — viết cho thời Dr.JOY là MCP server local, hỏng khi connector chuyển sang cấp tài khoản claude.ai | ⑥ Cổng hạ tầng | RC-INTEG | Tách suy luận ra hàm thuần có test (`server/lib/mcp-auth.ts`) · nguyên tắc **"không biết thì đừng báo động"** (chỉ cảnh báo khi có bằng chứng dương) · bỏ tên connector ghi cứng trong chuỗi hướng dẫn |
| [BUG-20260813-ngay-dinh-ky-dinh-data-hom-nay](bugs/BUG-20260813-ngay-dinh-ky-dinh-data-hom-nay.md) | Chọn `17/08/2026` nhưng cột định kỳ vẫn có dấu hiệu của hôm nay: vạch giờ hiện tại còn hiện, và response cũ của hôm nay có thể ghi đè data ngày mới | Có sẵn từ trước — vùng UI task định kỳ/date loading chưa có test race theo ngày | ⑦ Nghiệm thu | RC-TEST | Sequence guard cho request `/api/tasks?date=...` · gate vạch giờ bằng `laHomNay` · test fake timer + stale response |
| [BUG-20260814-ai-dang-bai-bang-huong-dan-cu](bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md) | AI đăng bài Dr.JOY theo `ai_note` **bản cũ** (374 vs 1005 ký tự) vì task release là bản chụp definition; 10 task cùng đợt còn `action_type='none'` nên sẽ im lặng không chạy | Có sẵn từ trước — cơ chế snapshot definition→task, automation cắm lên mà không thêm cổng | ② Thiết kế | RC-SPEC | ⬜ **Chưa** — 4 hành động (fail-closed precheck, một luật ghi + cổng máy, rule snapshot phải phát hiện lệch chủ động, ca smoke bắt buộc) neo vào [CR-20260814-hop-nhat](changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md) |

> Cột **Cải tiến** ghi link tới thay đổi standard/rule đã thực hiện, hoặc `—` kèm lý do.

> **Cùng một gốc lỗi xuất hiện 2 lần** (BUG-20260803 → BUG-20260804, gốc thời gian). Lần đầu vá bằng **rule**;
> lần hai cho thấy rule không ai thi hành thì vẫn lọt, nên vá bằng **cổng máy**. Đây đúng là vòng lặp mà sổ này
> tồn tại để phát hiện — và nó chỉ nhìn thấy được vì lần đầu có hồ sơ ghi rõ "đã quét lân cận".

> **Retro 2026-08-13 — đọc theo cụm sau 8 hồ sơ BUG:** bug hiện không phân tán đều; nó dồn vào 4 họ:
> **thời gian/ngày**, **automation ghi ra ngoài**, **giả định hệ thống ngoài/MCP**, và **race/đa phiên**. Vì vậy khi sửa
> bug thuộc một trong 4 họ này, không đủ để chỉ thêm test đúng bug vừa thấy. Bắt buộc phải hỏi thêm:
> 1) có call-site cùng họ nào chưa quét bằng lệnh chạy lại được không;
> 2) có rule nào chỉ đang nằm trên giấy nhưng chưa có cổng máy/smoke thật thi hành không;
> 3) có hành vi nào nhìn đúng ở "hôm nay/happy path" nhưng sai ở ngày khác, response về trễ, hoặc hệ thống ngoài đổi trạng thái không.
> Nếu câu trả lời là "có thể" thì hành động cải tiến phải đi vào [qa-standard](../standards/qa-standard.md),
> [rules/06–09](../rules/), hoặc runbook vận hành tương ứng ngay trong cùng lần giao.

## 5b. Sổ Sai lệch & Bài học (LESSON)

> **Loại hồ sơ thứ ba, cho thứ không phải bug.** Quy trình có thể hụt mà **không** sinh ra lỗi nào
> tới tay người dùng: AC đặt sai, ước lượng lệch, tài liệu mô tả sai thực tế, cổng mô tả một thứ
> không tồn tại. Không ghi lại thì loại sai lệch đó tái diễn mãi mà không ai gộp được số liệu.

**Khi nào ghi:** có một **sai lệch so với điều đã cam kết trong artifact** (AC không đạt, DoR gật ẩu,
docs lệch code, cổng bị bỏ), **hoặc** một quyết định phải phá lệ có lý do. Không cần file riêng —
mỗi bài học là **một dòng** ở bảng dưới; chỉ tách file khi dài quá 5 dòng.

**Dùng chung mã RC ở [§3](#3-bảng-phân-loại-nguyên-nhân-rc--standard-chịu-trách-nhiệm)** để LESSON và BUG
gộp thống kê được cùng nhau — đó là lý do không đặt bảng phân loại riêng.

| # | Ngày | Nguồn | RC | Sai lệch gì | Bài học | Hành động cải tiến | TT |
|---|---|---|---|---|---|---|---|
| L-001 | 2026-08-01 | [CR-20260801](changes/CR-20260801-scheduler-automation-ve-server.md) §14.2 | RC-SPEC | AC-12 đặt mục tiêu *"`useAutomation.ts` ≤170 dòng"*; thực tế 224. Không thể vừa đạt AC-8 (`declined` bền qua F5) vừa đạt AC-12 — FR-6 **thêm** việc cho FE chứ không chỉ bớt | **Số dòng là proxy tồi cho độ phức tạp.** Đặt AC lên *chỉ số trực tiếp* (số ref bị xoá, logic đã rời khỏi tầng nào), đừng đặt lên chỉ số gián tiếp | Thêm [design-standard §7](../standards/design-standard.md) mục "Mục tiêu đo được: tránh chỉ số gián tiếp" | ✅ Xong |
| L-002 | 2026-08-01 | Audit docs | RC-DOC | Taxonomy [docs-standard §2](../standards/docs-standard.md) **không có nhóm Operations** ⇒ 3 runbook vận hành **còn hiệu lực** bị đẩy vào `_archive/` — nơi mọi người mặc định là đồ chết | Khi một doc không vừa nhóm nào, người ta nhét đại vào archive. **Taxonomy thiếu ô là nguyên nhân, không phải người cẩu thả** | Thêm nhóm `operations/` + `proposals/`; thêm cảnh báo bẫy vào §2; thêm ô checklist §9 | ✅ Xong |
| ✅ (a) [docs-standard §2](../standards/docs-standard.md) thêm nhóm **"Docs gốc repo"**; §5.1b bảng "đổi gì thì sửa doc gốc nào"; §9 + §10 + §11 cập nhật. (b) **Tự động hoá**: `scripts/check-docs.mjs` trong `npm run check` — kiểm mọi lệnh `npm run X` nhắc trong doc phải có thật, và mọi đường dẫn dòng `Nguồn` phải tồn tại. Bắt được ngay 1 drift: `npm run backup-db` được nhắc nhưng chưa có script | ✅ Xong |
| L-004 | 2026-08-01 | Audit quy trình | RC-PROC | [team-operating §6](../standards/team-operating-standard.md) cổng ⑤ ghi *"Dev → Tester: **PR** + test"*, nhưng 15/15 commit gần nhất đi **thẳng `main`**, không merge commit nào ⇒ **cổng ⑤ chưa từng tồn tại** | Chuẩn mô tả một cổng không có thật thì mọi thống kê "cổng ⑤ hụt" đều vô nghĩa | ✅ Chốt **không dùng PR** ([ADR-P1](../standards/team-operating-standard.md)): tool cá nhân, không có người thứ hai đọc diff. Cổng ⑤ đổi sang **tự soi `git diff --staged`** + commit message ghi `Ref: CR-…`; thay "PR" bằng "lần giao" trên toàn bộ chuẩn | ✅ Xong |

| L-005 | 2026-08-01 | Smoke/review trước commit của [CR-20260801](changes/CR-20260801-scheduler-automation-ve-server.md) | RC-TEST | Nút "hoãn" (đóng popup) bị viết thành ghi event `declined` — **gộp với "Không, để tôi tự làm"**. Sống sót qua: review CR, hiện thực, **116 test tự động xanh**. Chỉ lộ ra khi đọc code đối chiếu [qa-standard §5](../standards/qa-standard.md) trước lúc commit | **Không có test nào chạm logic quyết định của frontend** (`useAutomation` chôn trong hook, không test được). Lỗi làm bẩn đúng dữ liệu mà sổ này dùng để thống kê — kiểu lỗi *im lặng*, không ai báo | Tách [`src/lib/automation-ask.ts`](../../src/lib/automation-ask.ts) + **12 unit test**; thêm luật vào [rules/06 §8](../rules/06-rules-frontend.md): logic quyết định của FE phải tách hàm thuần, và mỗi hành động khác nghĩa phải có mã sự kiện khác | ✅ Xong |
| L-006 | 2026-08-01 | Thực hiện L-003 | RC-DOC | Sửa L-003 xong mới lộ: `README.md` **vẫn còn** một mục con mô tả hành vi cũ (*"copy prompt vào clipboard, dán vào Claude Desktop"*) — lần sửa trước chỉ vá phần mở đầu, **sót mục "Cách dùng"**. Cùng file, cùng lỗi, sót vì sửa bằng mắt | **Sửa nội dung bằng mắt thì sót.** Một tài liệu mô tả sai ở một chỗ thường sai ở nhiều chỗ — phải quét cả file, hoặc tốt hơn là có cổng máy kiểm. Cũng phát hiện 2 file `scripts/*prompt.template.txt` không còn code nào dùng nhưng README vẫn giới thiệu như đang dùng | Đã sửa mục 3–5 phần "Cách dùng" + ghi rõ 2 template là di tích. `scripts/check-docs.mjs` (từ L-003) là cổng máy đầu tiên cho lớp lỗi này | ✅ Xong |
| L-007 | 2026-08-01 | User hỏi *"mỗi khi code có phải lôi Leader ra không"* | RC-PROC | Hai chuẩn nói ngược nhau về đường nhanh: [team-operating §5](../standards/team-operating-standard.md) ghi *"không bỏ bước, không đảo bước"* (đọc như áp cho mọi việc), trong khi [design-standard §3](../standards/design-standard.md) miễn Change Spec cho cosmetic/bugfix nhỏ. Mà team-operating là file ghi *"đọc trước tiên"* ⇒ người đọc đúng thứ tự sẽ tưởng sửa một cái nhãn cũng phải triệu tập BA | **Quy trình nặng quá mức sẽ bị bỏ qua cả gói**, chứ không được tuân thủ một phần. Chuẩn phải tự nói rõ *khi nào KHÔNG áp dụng nó* — thiếu vế đó thì mâu thuẫn nằm im cho tới khi có người hỏi. Phát hiện từ audit trước nhưng **để trôi**, chỉ được vá khi user vấp thật | Thêm [§5.0 "Chọn đường A/B/C"](../standards/team-operating-standard.md) + bảng phân loại; đổi *"không bỏ bước"* thành *"**đã chọn đường C** thì không bỏ bước"*; đưa bảng chọn đường lên đầu `CLAUDE.md` để nạp mỗi phiên | ✅ Xong |
| L-008 | 2026-08-09 | User hỏi danh sách task còn tồn sau CR-20260808 | RC-PROC | Việc chưa làm nằm rải trong exchange, điểm dừng, operations, proposal và header CR; không có nguồn duy nhất để Leader ưu tiên, nên CR dễ bị hiểu lẫn với backlog | **Hồ sơ giao hàng không thể thay hàng đợi ưu tiên.** Muốn biết “làm gì tiếp” phải có artifact riêng, owner và gate pick rõ ràng | Tạo [backlog canonical](../backlog/README.md) do Leader sở hữu + chuẩn hóa backlog → pick → A/B/C trong [CR-20260809](changes/CR-20260809-backlog-canonical-va-luong-pick.md) | ✅ Xong |
| L-009 | 2026-08-17 | User gặp lại lỗi "chưa cấu hình CLAUDE_BIN" đã vá xong từ 14/08 | RC-PROC | [CR-20260814](changes/CR-20260814-cau-hinh-claude-bin-khong-phu-thuoc-env.md) lát 1 đã code + test + `npm run check` xanh + **commit + push**, nhưng **không `npm run package`**. App người dùng bấm hằng ngày vẫn là exe build 13/08 ⇒ lỗi tái diễn nguyên vẹn sau 3 ngày, mất thêm một buổi chẩn đoán lại đúng thứ đã sửa | **"Đã commit" không phải "đã giao"** với app đóng gói: người dùng chạy exe, không chạy repo. Definition of Done thiếu đúng bước cuối cùng nối code với người dùng — và nó là bước duy nhất không có cổng nào kiểm | (a) [CLAUDE.md](../../CLAUDE.md) cổng chất lượng: đụng `server/`/`src/` ⇒ phải `npm run package` + bật lại exe. (b) **Cổng máy** [`scripts/check-exe-fresh.mjs`](../../scripts/check-exe-fresh.mjs) trong `npm run check`: cảnh báo khi exe cũ hơn file code chạy thật (cảnh báo, không chặn — chặn cứng sẽ khiến người ta chạy `check` ít đi) | ✅ Xong |
| L-010 | 2026-09-13 | Kiểm kê code cho [CR-20260913](changes/CR-20260913-nen-tang-da-nguoi-dung.md) | RC-DOC | [CR-20260912](changes/CR-20260912-xoa-ai-automation-tai-cau-truc.md) xoá hoàn toàn AI automation + Skill Forge và **đã merge vào `main`**, nhưng hai tài liệu gốc vẫn mô tả chúng như đang chạy: `README.md` còn nguyên mục "Task automation AI", `docs/specs/02` còn `skill_forge` trong bảng tab, mục 3.8, popup automation, badge automation và Flow 2. Tức **bước 11 của `delivery-flow` (cập nhật `docs/specs/01–05`) chưa chạy** dù CR đã đóng | **Docs lệch nguy hiểm hơn code lệch ở dự án này**, vì `AGENTS.md` bắt mọi phiên đọc spec đầu phiên — người/AI vào sau sẽ thiết kế dựa trên tính năng không còn tồn tại, và không có cách nào tự phát hiện. Hai cổng máy hiện có (`check-docs.mjs`, `check-links.mjs`) **không bắt được lớp lỗi này**: chúng kiểm link còn sống và lệnh npm có thật, không kiểm **nội dung** có khớp code hay không | ⬜ **Chưa** — đã mở `BL-20260913-002` để chạy `docs-sync` dọn hai file. Câu hỏi mở cho lần siết cổng: xoá một tính năng thì có cách nào kiểm bằng máy rằng docs không còn nhắc tới nó không (vd danh sách từ khoá cấm sau mỗi CR loại Xóa/Deprecate) | ⬜ Chưa |

**Điều đã chạy tốt (cũng là dữ liệu):** vòng shift-left của CR-20260801 bắt được **3 lỗi thiết kế trước
khi viết dòng code nào** — trong đó có một lỗi (`UNIQUE(occurrence_key, event)`) sẽ làm hỏng luồng
*duyệt → hủy → duyệt lại* đang chạy, và một rủi ro mất dữ liệu bị loại bỏ hoàn toàn. Bằng chứng cổng
②③ đang hoạt động đúng ⇒ **không siết thêm** hai cổng này.

Và **smoke thủ công ([qa-standard §8](../standards/qa-standard.md)) bắt được một lỗi mà 116 test tự động
bỏ sót** (L-005) — bằng chứng không nên bỏ bước này dù test tự động đã xanh.

---

## 6. Cách thống kê

**Khi số hồ sơ còn ít (< 10):** đừng cộng số. **Đọc từng cái** và hỏi *"hai bug này có cùng một gốc không?"*
Với cỡ mẫu nhỏ, một mẫu hình lặp lại 2 lần đã đáng hành động; còn tỉ lệ phần trăm thì vô nghĩa.

**Khi đã đủ nhiều:** đếm theo ba trục, và chú ý — trục quan trọng nhất là **cổng hụt**, không phải RC.

Nguồn dữ liệu gồm **cả ba sổ**: `BUG-*` (lỗi thoát cổng), `L-*` (sai lệch không thành bug), và `CR-*`
(để biết thay đổi nào đắt). Bỏ sổ LESSON ra ngoài là bỏ mất phần lớn tín hiệu — phần lớn quy trình
hụt **không** kết thúc bằng một bug.

```bash
# Đếm theo cổng hụt (trục chính) — cổng nào hụt nhiều nhất thì siết cổng đó trước
grep -ho "✅ [①-⑧][^|]*" docs/delivery/bugs/BUG-*.md | sort | uniq -c | sort -rn

# Đếm theo loại nguyên nhân -> suy ra standard cần siết (bảng mục 3)
grep -ho "RC-[A-Z]*" docs/delivery/bugs/BUG-*.md | sort | uniq -c | sort -rn

# Bug theo từng CR -> CR nào "đắt" (sinh nhiều lỗi) thì soi lại cách nó qua DoR
grep -l "CR-20260801" docs/delivery/bugs/BUG-*.md

# Sổ LESSON: RC nào lặp, và bài học nào còn '⬜ Chưa' (nợ quy trình)
grep -o "RC-[A-Z]*" docs/delivery/README.md | sort | uniq -c | sort -rn
grep -c "⬜ Chưa" docs/delivery/README.md
```

> Đánh dấu ô đã chọn bằng `✅` thay cho `⬜` trong bảng header của hồ sơ để các lệnh trên đếm được.

**Ba câu hỏi cần trả lời được sau mỗi đợt thống kê:**
1. Cổng nào đang hụt nhiều nhất? → siết đúng cổng đó, đừng siết toàn bộ.
2. Có RC nào lặp ≥ 2 lần (tính **cả** BUG lẫn LESSON) mà **chưa** có hành động cải tiến? → nợ quy trình.
3. Có hành động cải tiến nào đã ghi mà **chưa làm** (`⬜ Chưa`)? → nợ tồn, [Leader §10.5](../standards/team-operating-standard.md) chịu trách nhiệm.

---

## 7. Nhịp rà soát

Gắn vào **Retro nhỏ** đã có ở [team-operating §9](../standards/team-operating-standard.md) — nhịp đó
trước đây không có dữ liệu đầu vào, nay lấy từ sổ này.

| Khi nào | Làm gì | Ai |
|---|---|---|
| Ngay sau khi sửa xong 1 bug | Điền mục 6 hồ sơ (hành động cải tiến) + thêm dòng vào bảng §5 | Người sửa |
| **Ngay khi nghiệm thu một CR có AC không đạt / phải phá lệ** | Thêm một dòng vào **§5b** — kể cả khi sai lệch đã được chấp nhận. *Được chấp nhận ≠ không cần học* | BA |
| Retro nhỏ (sau thay đổi Lớn / định kỳ) | Chạy mục 6, trả lời 3 câu hỏi, chốt việc siết cổng | Leader chủ trì, cả nhóm |
| Standards health check | Đối chiếu: standard nào bị RC trỏ tới nhiều mà chưa sửa? | Leader + owner standard |

---

## 8. Đặt tên

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Bài học / sai lệch | một dòng `L-<số>` ở §5b (không tạo file) | `L-001` |
| Change Request | `changes/CR-<yyyymmdd>-<slug>.md` | `CR-20260801-scheduler-automation-ve-server.md` |
| Bug | `bugs/BUG-<yyyymmdd>-<slug>.md` | `BUG-20260815-dang-trung-bai-drjoy.md` |

Khuôn: [../templates/change-spec-template.md](../templates/change-spec-template.md) ·
[../templates/bug-record-template.md](../templates/bug-record-template.md).

Hồ sơ **không xóa sau khi đóng** — chúng chính là dữ liệu thống kê.
