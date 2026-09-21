
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PopupChonNgayReleaseKhanCap } from '../../src/screens/release';

function oTen() {
  return screen.getAllByPlaceholderText('Sơn');
}

function dienBatchBatBuoc(teams = 'Dev5') {
  fireEvent.change(screen.getByPlaceholderText('Dev5, Dev12'), { target: { value: teams } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Dr.JOY' }));
}

describe('PopupChonNgayReleaseKhanCap — ô nhập mention (CR-20260819)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('không có initialDate thì KHÔNG tự default hôm nay, bắt user chọn ngày release khẩn cấp', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    const dateInput = screen.getByLabelText(/Release date/i) as HTMLInputElement;
    expect(dateInput.value).toBe('');
    fireEvent.submit(dateInput.closest('form')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gõ tên -> mentionName đúng tên đã trim', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    expect(oTen()).toHaveLength(1);
    fireEvent.change(oTen()[0], { target: { value: '  Sơn  ' } });
    dienBatchBatBuoc();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('2026-08-21', 'Sơn', ['Dev5'], ['Dr.JOY'])
    );
  });

  it('để trống hết mention -> mentionName rỗng (giữ hành vi cũ) — vẫn cần đủ team/hệ thống', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    dienBatchBatBuoc();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('2026-08-21', '', ['Dev5'], ['Dr.JOY']));
  });

  it('bấm "+" 2 lần, điền 3 người -> mentionName nối cả 3 theo quy tắc "A, B, C"', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Thêm người/ }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm người/ }));

    const ten = oTen();
    expect(ten).toHaveLength(3);
    fireEvent.change(ten[0], { target: { value: 'Sơn' } });
    fireEvent.change(ten[1], { target: { value: 'Cường' } });
    fireEvent.change(ten[2], { target: { value: 'Anh Tuấn' } });

    dienBatchBatBuoc('Dev1, Dev5');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        '2026-08-21',
        'Sơn, Cường, Anh Tuấn',
        ['Dev1', 'Dev5'],
        ['Dr.JOY']
      )
    );
  });

  it('xoá 1 ô giữa chừng (tên của dòng đó biến mất khỏi chuỗi mention)', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Thêm người/ }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm người/ }));
    const ten = oTen();
    fireEvent.change(ten[0], { target: { value: 'Sơn' } });
    fireEvent.change(ten[1], { target: { value: 'Cường' } });
    fireEvent.change(ten[2], { target: { value: 'Anh Tuấn' } });

    fireEvent.click(screen.getByRole('button', { name: /Xoá người 2/ }));

    dienBatchBatBuoc();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('2026-08-21', 'Sơn, Anh Tuấn', ['Dev5'], ['Dr.JOY'])
    );
  });

  it('dòng đầu KHÔNG cho xoá; từ dòng 2 mới xoá được', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Thêm người/ }));
    const nutXoaDong1 = screen.getByRole('button', { name: /Xoá người 1/ }) as HTMLButtonElement;
    const nutXoaDong2 = screen.getByRole('button', { name: /Xoá người 2/ }) as HTMLButtonElement;
    expect(nutXoaDong1.disabled).toBe(true);
    expect(nutXoaDong2.disabled).toBe(false);

    fireEvent.click(nutXoaDong1);
    expect(oTen()).toHaveLength(2); // không đổi gì

    fireEvent.change(oTen()[0], { target: { value: 'Sơn' } });
    fireEvent.click(nutXoaDong2);
    expect(oTen()).toHaveLength(1);

    dienBatchBatBuoc();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('2026-08-21', 'Sơn', ['Dev5'], ['Dr.JOY']));
  });

  // ── CR-20260822 FR-3: validate team/hệ thống bắt buộc ─────────────────────────

  it('thiếu team (để trống) -> KHÔNG submit, hiện lỗi validate', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Dr.JOY' })); // có hệ thống, thiếu team
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/team.*hệ thống/i));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('thiếu hệ thống (không tick gì) -> KHÔNG submit, hiện lỗi validate', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Dev5, Dev12'), { target: { value: 'Dev5' } }); // có team, thiếu hệ thống
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/team.*hệ thống/i));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gõ nhiều team cách nhau bằng dấu phẩy, có khoảng trắng thừa -> tách đúng, loại trùng', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <LangProvider>
        <PopupChonNgayReleaseKhanCap initialDate="2026-08-21" onClose={() => {}} onConfirm={onConfirm} />
      </LangProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Dev5, Dev12'), { target: { value: ' Dev5 ,Dev12 ,Dev5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dr.JOY' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pr.JOY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('2026-08-21', '', ['Dev5', 'Dev12'], ['Dr.JOY', 'Pr.JOY'])
    );
  });
});
