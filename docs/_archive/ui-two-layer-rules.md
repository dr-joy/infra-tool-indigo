# UI Rule 2 Tầng

> 🗄️ **HẾT HIỆU LỰC — 2026-08-01.** Đã curate vào rule frontend canonical.
>
> **Thay bằng:** [../rules/06-rules-frontend.md](../rules/06-rules-frontend.md) ·
> [../playbooks/ui-refactor-playbook.md](../playbooks/ui-refactor-playbook.md) (các bước áp dụng).
> Sửa rule ⇒ sửa ở `rules/`, **không sửa file này**.

Tài liệu này định nghĩa cách chuẩn hóa UI/UX cho hệ thống khi lấy màn **Project** làm chuẩn. Mục tiêu là giữ app nhất quán và dễ dùng hơn, nhưng không làm mất bản sắc nghiệp vụ của từng module như Release, MindMap, Luyện đề.

## 1. Nguyên Tắc Chính

Chuẩn hóa UI không có nghĩa là đồng nhất hóa toàn bộ visual.

Project là chuẩn về:

- Layout làm việc.
- Mật độ thông tin.
- Vị trí action.
- Form/modal behavior.
- Scroll behavior.
- Feedback sau thao tác.
- Cách tổ chức sidebar/list/detail.

Project không phải là chuẩn tuyệt đối về:

- Màu nghiệp vụ.
- Hình dạng đặc thù.
- Timeline/canvas/graph.
- Hiệu ứng giúp đọc trạng thái.
- Visual encoding riêng của từng module.

Rule nền:

> Chuẩn hóa layout, spacing, control behavior, feedback và interaction pattern. Giữ lại màu sắc, hình dạng, canvas, timeline, badge hoặc hiệu ứng nếu chúng truyền tải ý nghĩa nghiệp vụ của domain.

## 2. Tầng 1: Core UI Rule Bắt Buộc

Tầng này áp dụng cho tất cả chức năng.

### 2.1 Layout Workbench

Mỗi màn nên đi theo một trong các dạng workbench sau:

```text
[Sidebar/List] [Detail/Work Area]
```

hoặc:

```text
[Toolbar/Filter Sticky]
[Scrollable Work Area]
```

Rule:

- App đi thẳng vào công cụ làm việc, không dùng hero/landing/marketing section.
- Vùng làm việc chính phải chiếm tối đa diện tích.
- Header hoặc toolbar quan trọng nên sticky trong vùng của nó.
- Nội dung dài scroll trong work area, không làm cả page scroll.
- Sidebar dùng cho danh sách object: project, mindmap, kỳ thi, template, history.
- Detail area dùng cho thao tác chính.

### 2.2 Density Và Spacing

Rule:

- Mật độ thông tin vừa cao, giống màn Project.
- Panel padding khoảng `16-24px`.
- Row/list item gọn, đọc nhanh.
- Action nằm gần dữ liệu liên quan.
- Không tạo card lớn chỉ để chứa 1-2 dòng.
- Không lồng card trong card.

### 2.3 Typography

Rule:

- Title màn/detail: cỡ vừa, bold, không dùng hero-size.
- Item title: `text-sm` hoặc `text-base`, semibold/bold.
- Metadata: nhỏ hơn, màu phụ.
- Button: text ngắn, rõ hành động.
- Không dùng letter spacing âm.
- Không scale font theo viewport.

### 2.4 Button Và Action

Rule:

- Primary button dùng cho hành động chính: tạo, lưu, xác nhận.
- Secondary button dùng cho action phụ: export, filter, mở rộng.
- Danger button dùng cho xóa, cancel, thao tác phá hủy.
- Icon-only button dùng cho action gần item: edit, delete, collapse, expand.
- Icon-only button phải có `title`.
- Dùng `lucide-react` nếu có icon phù hợp.
- Không tự vẽ SVG cho icon phổ biến.

### 2.5 Form Và Modal

Rule:

- Form tạo/sửa entity nên dùng modal hoặc panel rõ ràng.
- Modal có title, body, footer action.
- Nếu form dài, body scroll riêng, footer action giữ cố định.
- Label ngắn, input cùng height.
- Date/time/number dùng input đúng type.
- Select/dropdown dùng cho option hữu hạn.
- Search parent/project/entity dùng combobox nếu danh sách dài.
- Backend vẫn validate, UI chỉ validate để trải nghiệm tốt hơn.

### 2.6 List Item

Rule:

- Có active state rõ.
- Có hover state nhẹ.
- Text chính nổi bật.
- Metadata nhỏ hơn và dùng màu phụ.
- Nếu item draggable, cần có dragging state.
- Nếu list có reorder, drop target phải có feedback rõ.

### 2.7 Feedback

Mọi thao tác ghi dữ liệu phải có feedback.

Rule:

- Thành công: toast ngắn như `Đã lưu`, `Đã tạo`.
- Lỗi: toast hoặc inline error rõ.
- Loading: spinner/skeleton/disabled state.
- Empty: lời nhắc ngắn + action tiếp theo.
- Conflict: dùng modal hoặc message có lựa chọn xử lý.
- Không im lặng khi save fail.

### 2.8 Scroll Behavior

Rule:

- App shell không scroll toàn trang nếu có thể tránh.
- Work area scroll riêng.
- Header của detail/list nên sticky nếu nội dung dài.
- Modal dài scroll trong body modal.
- Không để action chính biến mất khi người dùng scroll sâu.

### 2.9 Interaction

Rule:

- Thao tác thường xuyên cần nằm trong 1-2 click.
- Thao tác lặp lại nên có shortcut.
- Kéo thả phải có:
  - Drag source state.
  - Drop target state.
  - Vạch chèn nếu có before/after.
  - Hint nếu có nhiều kiểu drop.
- Nếu người dùng đang ở context A, tạo object liên quan tới A phải được prefill context.
- Không bắt người dùng đi vào đúng vị trí trong cây chỉ để tạo child; nên có search parent.

### 2.10 Color Core

Rule:

- Nền app có thể có pattern nhẹ.
- Work panel nên dùng trắng/xám nhạt để dễ đọc.
- Border dùng để phân vùng rõ.
- Màu semantic dùng nhất quán:
  - Xanh/teal: active/success.
  - Blue/sky: info/action phụ.
  - Amber/orange: warning.
  - Rose/red: danger.
  - Slate: text/border mạnh.
- Không dùng một màu phủ toàn bộ màn nếu không có ý nghĩa nghiệp vụ.

## 3. Tầng 2: Domain Visual Rule Được Bảo Vệ

Tầng này cho phép từng module giữ visual riêng nếu visual đó giúp hiểu nghiệp vụ.

### 3.1 Nguyên Tắc Bảo Vệ Domain Visual

Không xóa hoặc làm mờ các visual có vai trò sau:

- Phân biệt trạng thái.
- Phân biệt nhóm nghiệp vụ.
- Thể hiện quan hệ cha-con, timeline, graph, flow.
- Giúp thao tác trực quan hơn.
- Là bản chất của module.

Trước khi refactor một màn, phải ghi rõ danh sách `Không được mất`.

## 4. Rule Theo Module

### 4.1 Project

Project là chuẩn tham chiếu chính.

Giữ:

- Sidebar project.
- Detail panel.
- Header sticky.
- Tree task 3 level.
- Gantt/roadmap nếu đang dùng.
- Border rõ, density cao.
- Action gần task.

Chuẩn hóa từ Project sang module khác:

- Cách tổ chức list/detail.
- Cách đặt action.
- Form tạo/sửa.
- Empty/loading/error state.
- Reorder/drag feedback.

### 4.2 MindMap

MindMap không được bị biến thành list/table kiểu Project.

Không được mất:

- Canvas.
- Grid nền.
- Màu từng nhánh.
- Node color/background/text/icon.
- Đường nối cong.
- Floating toolbar.
- Kéo thả node.
- Visual drop target.
- Collapse/expand node.

Nên chuẩn hóa:

- Sidebar danh sách map theo kiểu project sidebar.
- Toolbar/action size thống nhất.
- Modal export/create task giống modal chuẩn.
- Toast/error/loading giống app.
- Empty state gọn.

Rule:

> MindMap dùng Project làm chuẩn shell và action, nhưng giữ canvas và branch visual làm core domain.

### 4.3 Release

Release có nhiều visual giúp hiểu lịch, stage, emergency/regular.

Không được mất:

- Màu phân biệt release thường/khẩn cấp.
- Timeline/step/stage visual.
- Màu trạng thái schedule.
- Template/token highlighting.
- CSS động nếu nó giúp nhận biết stage hoặc ngày.

Nên chuẩn hóa:

- Header/action placement.
- Form tạo/sửa template.
- List template/task definition.
- Modal confirm/delete.
- Empty/loading/error.

Rule:

> Release dùng Project làm chuẩn quản trị dữ liệu, nhưng giữ timeline và màu trạng thái vì đó là semantic visual.

### 4.4 Luyện Đề

Không được mất:

- Màu đúng/sai.
- Badge luyện tập/thi thử.
- Timer state.
- Highlight đáp án được chọn.
- Review câu sai.
- Cấu trúc câu hỏi/đáp án dễ đọc.

Nên chuẩn hóa:

- Kỳ thi/bộ đề dạng sidebar + detail.
- Import/export modal.
- List item style.
- Header sticky trong màn làm bài.
- Empty/loading/error.

Rule:

> Luyện đề dùng Project làm chuẩn quản lý ngân hàng đề, nhưng giữ màu trạng thái học tập và thi thử.

### 4.5 Báo Cáo Tuần

Không được mất:

- Trạng thái đạt/vượt/không đạt.
- Phân nhóm theo project/PIC nếu có.
- Preview report.
- History report.

Nên chuẩn hóa:

- Left panel chọn tuần/history.
- Right panel editor/preview.
- Sticky action: tạo, lưu, copy.
- Modal xác nhận xóa.

Rule:

> Báo cáo tuần nên là workbench biên tập, không phải dashboard trang trí.

### 4.6 Settings

Không được mất:

- Cảnh báo liên quan secret/API key.
- Trạng thái đã cấu hình/chưa cấu hình.

Nên chuẩn hóa:

- Sidebar nhóm setting.
- Detail form bên phải.
- Section có border-bottom thay vì card dày.
- Save/test/delete action rõ.

Rule:

> Settings là màn form workbench, ưu tiên rõ ràng và an toàn hơn trang trí.

## 5. Quy Trình Refactor UI An Toàn

### Bước 1: Chụp Lại Vai Trò Visual

Trước khi refactor, ghi rõ:

- Màn này dùng để làm gì?
- Người dùng thao tác gì thường nhất?
- Visual nào chỉ trang trí?
- Visual nào mang ý nghĩa nghiệp vụ?
- Visual nào không được mất?

### Bước 2: Chỉ Refactor Shell Trước

Ưu tiên chỉnh:

- Layout.
- Sidebar/detail.
- Header/toolbar.
- Scroll.
- Action placement.
- Modal/form.

Không chỉnh vội:

- Màu domain.
- Canvas.
- Timeline.
- Badge trạng thái.
- Hiệu ứng nghiệp vụ.

### Bước 3: Tách Shared Component

Chỉ tách component nếu nó thật sự dùng chung:

- Button.
- Icon button.
- Modal.
- Empty state.
- Loading state.
- Confirm dialog.
- Search combobox.

Không ép tách:

- MindMap node.
- Release timeline item.
- Luyện đề answer option.
- Gantt bar.

### Bước 4: Refactor Theo Từng Module Nhỏ

Không refactor toàn bộ CSS một lần.

Thứ tự nên làm:

1. Header/toolbar.
2. Sidebar/list item.
3. Modal/form.
4. Empty/loading/error.
5. Action feedback.
6. Domain visual nếu cần tinh chỉnh.

### Bước 5: Kiểm Tra Regression Visual

Sau refactor, kiểm tra:

- Màn còn nhận ra domain cũ không?
- Màu trạng thái có còn rõ không?
- Kéo thả/collapse/timeline/canvas còn hoạt động không?
- Action chính có nhanh hơn không?
- Có mất thông tin nào từng hiển thị không?

## 6. Checklist Trước Khi Merge UI Refactor

- Có giữ domain visual quan trọng không?
- Có làm mất màu nhánh MindMap không?
- Có làm mất màu/timeline Release không?
- Có làm mất màu đúng/sai Luyện đề không?
- Header/action có nhất quán hơn không?
- Scroll có tốt hơn không?
- Modal/form có rõ hơn không?
- Empty/loading/error có đủ không?
- Build chạy qua không?
- Có cần screenshot so sánh trước/sau không?

## 7. Anti-Patterns

Tránh:

- Quét CSS hàng loạt làm mọi màn giống Project tuyệt đối.
- Xóa màu domain vì nghĩ màu đó là trang trí.
- Biến MindMap canvas thành list/table.
- Biến Release timeline thành form thuần.
- Tạo card quá nhiều trong card.
- Dùng hero/title lớn trong app workbench.
- Đưa action chính xuống cuối vùng scroll dài.
- Dùng text giải thích dài thay cho UI rõ.
- Tạo style mới khi style core đã có thể dùng lại.

## 8. Rule Ngắn Gọn Để Ghi Nhớ

> Project là chuẩn xương khung UX, không phải skin CSS duy nhất.

> Core UI phải nhất quán; domain visual có ý nghĩa nghiệp vụ phải được bảo vệ.

> Refactor UI bắt đầu từ shell, layout, action và feedback; không bắt đầu bằng xóa màu, xóa timeline, xóa canvas.

