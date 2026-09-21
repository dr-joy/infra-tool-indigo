import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from '../../src/components/Modal';
import { CopyNoteButton, TaskLinkBadges, SortIcon } from '../../src/components/task-atoms';
import { PopupXacNhanXoa } from '../../src/components/dialogs';
import { LangProvider } from '../../src/useLang';
import { CotDinhKy } from '../../src/screens/personal-task';
import type { Task } from '../../src/types';

afterEach(() => {
  vi.useRealTimers();
});

describe('components render', () => {
  it('Modal hiển thị children + đóng khi bấm nền', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>Nội dung</p></Modal>);
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog); // bấm ngay overlay (target === currentTarget)
    expect(onClose).toHaveBeenCalled();
  });

  it('TaskLinkBadges render badge cho từng link, ẩn khi rỗng', () => {
    const { container, rerender } = render(<TaskLinkBadges links={[{ type: 'git', url: 'https://github.com/x' }]} />);
    expect(container.querySelector('a.task-link-git')).toBeTruthy();
    rerender(<TaskLinkBadges links={[]} />);
    expect(container.querySelector('a.task-link-git')).toBeFalsy();
  });

  it('CopyNoteButton disabled khi không có text', () => {
    const { rerender } = render(<CopyNoteButton text="" />);
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<CopyNoteButton text="abc" />);
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('SortIcon đổi icon theo hướng (render không nổ)', () => {
    const { container } = render(<SortIcon sort={{ truong: 'ngayTao', huong: 'asc' }} truong="ngayTao" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('PopupXacNhanXoa gọi onConfirm khi submit', async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<PopupXacNhanXoa title="Xóa task" message="Chắc chưa?" onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText('Xóa task')).toBeInTheDocument();
    expect(screen.getByText('Chắc chưa?')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: /xóa|delete/i }).closest('form')!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });

  it('CotDinhKy chỉ hiện vạch giờ hiện tại khi đang xem hôm nay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T07:01:03.000Z')); // 14:01:03 giờ VN
    const task = {
      id: 1, tenTask: 'task thứ hai', ghiChu: '', loaiTask: 'dinh_ky', trangThai: 'chua_thuc_hien',
      ngayTao: '2026-08-13', ngayHoanThanh: null, gioBatDau: '13:00', gioKetThuc: '13:15',
      lapLaiKieu: 'hang_tuan', ngayTrongThang: null, thuTrongTuan: 1, ngayCuThe: null,
      releaseMonth: null, releaseDate: null, links: []
    } as unknown as Task;
    const props = {
      tasks: [task],
      onChangeNgay: vi.fn(),
      onToday: vi.fn(),
      onComplete: vi.fn(),
      onEdit: vi.fn(),
      onTimeChange: vi.fn(async () => {})
    };

    const { rerender } = render(
      <LangProvider><CotDinhKy {...props} ngayDinhKy="2026-08-13" /></LangProvider>
    );
    expect(screen.getByText('14:01:03')).toBeInTheDocument();

    rerender(<LangProvider><CotDinhKy {...props} ngayDinhKy="2026-08-17" /></LangProvider>);
    expect(screen.queryByText('14:01:03')).toBeNull();
  });
});
