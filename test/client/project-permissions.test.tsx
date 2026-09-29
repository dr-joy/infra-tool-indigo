import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { PicProvider, ToastProvider } from '../../src/context';
import { ManHinhProject } from '../../src/screens/project';
import { LangProvider } from '../../src/useLang';

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderProjectAsMember() {
  const ownTask = {
    id: 'own', projectId: 'p1', parentId: null, level: 1, tieuDe: 'Task của tôi', ghiChu: '',
    ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-03', estimateHours: 8,
    tienDo: 20, assignee: 'Member', sortOrder: 1, executionOrder: 1, links: [], rowVersion: 1,
    assignments: [{ userId: 1, legacyPicLabel: null, startDate: '2026-09-01', endDate: '2026-09-03', estimateHours: 8 }]
  };
  const otherTask = {
    ...ownTask, id: 'other', tieuDe: 'Task của người khác', assignee: 'Leader', sortOrder: 2,
    assignments: [{ userId: 2, legacyPicLabel: null, startDate: '2026-09-04', endDate: '2026-09-06', estimateHours: 8 }]
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/auth/me') return response({ user: { id: 1, email: 'member@drjoy.jp', displayName: 'Member', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }] } });
    if (url.pathname === '/api/me/teams') return response({ teams: [{ id: 1, name: 'Dev13', description: null, role: 'member', features: ['project'] }] });
    if (url.pathname === '/api/notifications') return response({ notifications: [] });
    if (url.pathname === '/api/projects') return response([{ id: 'p1', ten: 'Project chung', pic: '', ngayBatDau: '2026-09-01', moTa: '', sortOrder: 1, closedAt: null, pendingAt: null, isSystem: false }]);
    if (url.pathname === '/api/projects/p1/tasks') return response([ownTask, otherTask]);
    if (url.pathname === '/api/teams/1/members') return response({ members: [{ id: 1, email: 'member@drjoy.jp', display_name: 'Member' }, { id: 2, email: 'leader@drjoy.jp', display_name: 'Leader' }] });
    if (url.pathname === '/api/teams/1/gantt-colors') return response({ colors: [] });
    if (url.pathname.endsWith('/goal-badge-ids') || url.pathname.endsWith('/at-risk-ids')) return response([]);
    return response([]);
  }) as typeof fetch;
  return render(<LangProvider><AuthProvider><ToastProvider><PicProvider><ManHinhProject /></PicProvider></ToastProvider></AuthProvider></LangProvider>);
}

describe('Quyền thao tác Project và Gantt', () => {
  it('Member thấy nút project/xóa task bị disable, còn task của mình vẫn sửa được', async () => {
    renderProjectAsMember();
    await waitFor(() => expect(screen.getByText('Task của tôi')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Thêm project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sửa project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xóa project' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Xóa task project' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    const ownCard = screen.getByText('Task của tôi').closest('.project-task-card')!;
    const otherCard = screen.getByText('Task của người khác').closest('.project-task-card')!;
    expect(ownCard.querySelector('select')).not.toBeDisabled();
    expect(otherCard.querySelector('select')).toBeDisabled();
  });

  it('Member chỉ có thể kéo/resize thanh Gantt được gán cho chính mình', async () => {
    renderProjectAsMember();
    await waitFor(() => expect(screen.getByText('Task của tôi')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Gantt tổng' }));

    await waitFor(() => expect(document.querySelectorAll('.project-gantt-lane-bar')).toHaveLength(2));
    const bars = Array.from(document.querySelectorAll<HTMLElement>('.project-gantt-lane-bar'));
    expect(bars.map((bar) => bar.dataset.ganttEditable)).toEqual(['true', 'false']);
    expect(bars[0].querySelectorAll('button:disabled')).toHaveLength(0);
    expect(bars[1].querySelectorAll('button:disabled')).toHaveLength(2);
  });
});
