// BUG-20260928: PATCH /projects/:id/tasks/:id luôn trả 409 "Có người vừa thay đổi task này" dù
// không ai sửa trùng. Root cause: Lát 4 (CR-20260913) thêm optimistic lock row_version ở tầng route
// (server/routes/projects.ts, UPDATE ... WHERE row_version = ?, dùng body.rowVersion ?? -1) nhưng
// PopupTaoProjectTask.submit() (src/components/dialogs.tsx) không đọc `task.rowVersion` để gửi lại
// -> mọi PATCH đều thiếu field này, server luôn coi là -1, luôn lệch với row_version thật (>=1).
//
// Test này tái hiện đúng bug ở tầng gọi onCreated() (chỗ dialog build body PATCH), không cần dựng cả
// server thật — vì bug là FE thiếu field trong payload, không phải logic server (đã có test route
// riêng khoá đúng hành vi 409 khi conflict thật).
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PopupTaoProjectTask } from '../../src/components/dialogs';
import type { ProjectItem, ProjectTaskItem } from '../../src/types';

const project: ProjectItem = {
  id: '1', ten: 'Dự án test', teamId: 1, responsibleUserId: 1, legacyPicLabel: null,
  ngayBatDau: '2026-09-01', sortOrder: 0, closedAt: null, pendingAt: null, isSystem: false, rowVersion: 1
};

const task: ProjectTaskItem = {
  id: '10', projectId: '1', parentId: null, level: 1,
  tieuDe: 'Task cũ', ghiChu: '', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-02',
  estimateHours: null, tienDo: 0, assignee: '', sortOrder: 0, executionOrder: 0, links: [],
  rowVersion: 7
};

function renderPopup(onCreated: (body: unknown) => Promise<void>) {
  return render(
    <LangProvider>
      <PopupTaoProjectTask
        project={project}
        parentTask={null}
        task={task}
        hasChildren={false}
        teamMembers={[]}
        onClose={() => {}}
        onCreated={onCreated}
        skipEmptyAssignmentConfirm
      />
    </LangProvider>
  );
}

describe('BUG-20260928: PopupTaoProjectTask phải gửi kèm rowVersion khi sửa task', () => {
  it('submit task đang sửa (task có rowVersion) -> payload PATCH phải kèm đúng rowVersion đó', async () => {
    const onCreated = vi.fn(async () => {});
    const { container } = renderPopup(onCreated);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const body = onCreated.mock.calls[0][0] as Record<string, unknown>;
    expect(body.rowVersion).toBe(7);
  });
});
