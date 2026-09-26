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
        danger: 'var(--color-danger)',
        warning: 'var(--color-warning)',
        success: 'var(--color-success)',
        // Thêm CR-20260926 (Pha 1, bảng "Chàm Nửa Đêm"): surface phụ, muted yếu hơn, cặp
        // secondary (accent phụ hồng tím) + chữ-trên-nền-primary/secondary.
        'surface-2': 'var(--color-surface-2)',
        'muted-2': 'var(--color-muted-2)',
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
        mem: '0 18px 45px rgba(31, 42, 46, 0.08)',
        'token-sm': 'var(--shadow-sm)',
        'token-md': 'var(--shadow-md)'
      }
    }
  },
  plugins: []
};
