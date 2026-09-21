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
        success: 'var(--color-success)'
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
      boxShadow: {
        mem: '0 18px 45px rgba(31, 42, 46, 0.08)'
      }
    }
  },
  plugins: []
};
