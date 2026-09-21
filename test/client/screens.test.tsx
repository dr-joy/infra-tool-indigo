import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PicProvider, ToastProvider } from '../../src/context';
import { ManHinhProject } from '../../src/screens/project';
import { ManHinhBaoCaoTuan } from '../../src/screens/weekly';
import { ManHinhLenLich } from '../../src/screens/release';

// Mock fetch trả dữ liệu tối thiểu hợp lệ cho mọi endpoint mà màn hình gọi lúc mount.
function mockApi() {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    let body: unknown = [];
    if (u.includes('/api/tasks?')) body = { khoTask: [], taskHomNay: [], taskDinhKy: [], lichSu: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LangProvider>
      <ToastProvider>
        <PicProvider>{ui}</PicProvider>
      </ToastProvider>
    </LangProvider>
  );
}

describe('Render smoke — màn hình lớn (mount không nổ với fetch mock)', () => {
  beforeEach(() => mockApi());

  it('ManHinhProject mount + hiển thị mà không throw', async () => {
    const { container } = renderWithProviders(<ManHinhProject />);
    await waitFor(() => expect(container.querySelector('section, div')).toBeTruthy());
    expect(container).toBeTruthy();
  });

  it('ManHinhBaoCaoTuan mount không throw', async () => {
    const { container } = renderWithProviders(<ManHinhBaoCaoTuan />);
    await waitFor(() => expect(container.querySelector('section, div')).toBeTruthy());
    expect(container).toBeTruthy();
  });

  it('ManHinhLenLich (release) mount không throw', async () => {
    const { container } = renderWithProviders(<ManHinhLenLich onTasksCreated={async () => {}} />);
    await waitFor(() => expect(container.querySelector('section, div')).toBeTruthy());
    expect(container).toBeTruthy();
  });
});
