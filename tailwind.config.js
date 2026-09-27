// Design token (BL-20260913-005, CR-20260913-c): nguồn giá trị THẬT nằm ở CSS custom property
// trong src/styles.css `:root`. File này CHỈ ánh xạ tên tiện ích Tailwind -> var(--...), không tự
// định nghĩa hex/rem riêng — đổi giá trị thì sửa ở styles.css, không sửa ở đây.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        // Tên cũ (nen/vien/muc/phu) giữ nguyên, chỉ đổi giá trị sang var(--...) — không đổi tên,
        // không cần sửa className nào đang dùng. la/bien/cam giữ hex tĩnh: chưa gán vai trò ngữ
        // nghĩa nào (kiểm kê 2026-09-13 xác nhận chưa dùng ở đâu), để nguyên ngoài hệ token mới.
        nen: 'var(--color-bg)',
        vien: 'var(--color-border)',
        muc: 'var(--color-text)',
        phu: 'var(--color-muted)',
        la: '#dff3df',
        bien: '#dff1f7',
        cam: '#ffe8c7',
        // Vai trò mới — chưa có tên tiện ích tương ứng trước đây.
        surface: 'var(--color-surface)',
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        'primary-soft': 'var(--color-primary-soft)',
        record: 'var(--color-record)',
        // *-soft (Pha 3): dùng thay vì `bg-danger/15` v.v. — hậu tố opacity Tailwind KHÔNG sinh ra
        // rule nào cho màu custom dạng chuỗi `var(--...)` (xác nhận bằng build thật), nền sẽ trong
        // suốt âm thầm nếu dùng opacity trên các token này. Luôn dùng *-soft, không dùng /NN.
        danger: 'var(--color-danger)',
        'danger-soft': 'var(--color-danger-soft)',
        warning: 'var(--color-warning)',
        'warning-soft': 'var(--color-warning-soft)',
        success: 'var(--color-success)',
        'success-soft': 'var(--color-success-soft)',
        // Thêm CR-20260926 (Pha 1, bảng "Chàm Nửa Đêm"): surface phụ, muted yếu hơn, cặp
        // secondary (accent phụ hồng tím) + chữ-trên-nền-primary/secondary.
        'surface-2': 'var(--color-surface-2)',
        'muted-2': 'var(--color-muted-2)',
        // Quy tắc chọn primary hay secondary khi thay 1 màu xanh dương/indigo/sky hardcode cũ
        // (Council review CR-20260926, run c45edac5, đợt 3-15 nêu: 2 đợt khác nhau đổi "cùng là
        // xanh dương" ra 2 token khác nhau, không có quy tắc thành văn — ghi lại đây, KHÔNG phải giữ
        // đúng tông màu gốc): xét VAI TRÒ phần tử, không xét hue cũ. Chữ định danh/nhãn đi kèm nội
        // dung khác (vd tên PIC cạnh ngày tháng, `project.tsx`) -> `primary` (màu nhấn chính, dùng
        // cho MỌI thứ "thông tin nổi bật" trong app). Nút hành động độc lập/toggle bật-tắt tách biệt
        // khỏi luồng nút chính (vd nút thêm trong 1 popup phụ, toggle định dạng trong MindMap) ->
        // `secondary` (accent phụ, để không lẫn với nút hành động primary chính của màn).
        secondary: 'var(--color-secondary)',
        'secondary-soft': 'var(--color-secondary-soft)',
        'on-primary': 'var(--color-on-primary)',
        'on-secondary': 'var(--color-on-secondary)'
      },
      fontSize: {
        label: ['var(--font-size-label)', 'var(--line-height-label)'],
        body: ['var(--font-size-body)', 'var(--line-height-body)'],
        heading: ['var(--font-size-heading)', 'var(--line-height-heading)']
      },
      spacing: {
        xs: 'var(--space-xs)',
        sm: 'var(--space-sm)',
        md: 'var(--space-md)',
        lg: 'var(--space-lg)'
      },
      height: {
        control: 'var(--control-height)'
      },
      width: {
        'control-icon': 'var(--control-icon-size)'
      },
      // Đặt tên KHÔNG trùng thang mặc định Tailwind (sm/md/lg) — trùng tên sẽ ghi đè `rounded-sm`/
      // `shadow-sm`/`shadow-md` mặc định đang dùng ở nhiều chỗ CHƯA di trú sang "Chàm Nửa Đêm"
      // (Pha 3 chưa chạm tới), làm chúng đổi màu/bóng ngoài ý muốn ngay từ Pha 1.
      borderRadius: {
        'token-sm': 'var(--radius-sm)',
        'token-md': 'var(--radius-md)',
        'token-lg': 'var(--radius-lg)'
      },
      boxShadow: {
        'token-sm': 'var(--shadow-sm)',
        'token-md': 'var(--shadow-md)'
      }
    }
  },
  plugins: []
};
