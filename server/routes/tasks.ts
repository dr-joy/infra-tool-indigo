import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { type TaoTaskBody, type CapNhatTaskBody, type CapNhatLichBody, type TrangThai } from '../types.js';
import { HttpError, normalizeTaskLinks, parseDateParam, toMinutes } from '../lib/utils.js';
import { mapTask, recurringMatchesDate } from '../lib/mappers.js';
import { isSameLocalDate } from '../lib/utils.js';
import {
  buildDefinitionTargetPayload, diffTaskAgainstDefinition,
  type ReleaseTaskDefinitionRow, type TaskRowForDiff
} from '../lib/release-render.js';

const router = Router();

function chuanHoaThuTrongTuan(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.filter((v): v is number => Number.isInteger(v) && v >= 0 && v <= 6);
  if (Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= 6) return [raw as number];
  return [];
}

// QA-2026-09-12: FE cho chọn "Kiểu lặp" (dropdown) độc lập với ô chi tiết (thứ trong tuần / ngày
// trong tháng) — không có gì chặn lưu ở trạng thái vô nghĩa trước khi sửa (hang_tuan không tick thứ
// nào, hoặc hang_thang không nhập ngày). `recurrenceMatches()` (server/lib/recurrence.ts) coi 2
// trạng thái này là "không bao giờ khớp ngày nào" — task sinh ra nằm im vĩnh viễn, không hiện ở đâu,
// và (task cá nhân, khác Release) không có màn nào liệt kê lại để sửa/xoá. FE đã chặn ở
// src/screens/personal-task.tsx (loiDinhKyKhongHopLe) — chặn thêm ở đây làm phòng tuyến thứ 2, vì
// FE có 3 form riêng và vì route này gọi được trực tiếp ngoài UI.
function xacThucKieuLapDinhKy(lapLaiKieu: string, thuTrongTuan: number[], ngayTrongThang: number | null) {
  if (lapLaiKieu === 'hang_tuan' && thuTrongTuan.length === 0) {
    throw new HttpError(400, 'Kiểu lặp "Hàng tuần" cần ít nhất 1 thứ trong tuần');
  }
  if (lapLaiKieu === 'hang_thang' && !(Number.isInteger(ngayTrongThang) && (ngayTrongThang as number) >= 1 && (ngayTrongThang as number) <= 31)) {
    throw new HttpError(400, 'Kiểu lặp "Hàng tháng" cần ngày trong tháng hợp lệ (1-31)');
  }
}

function tinhLechDefinitionBulk(rows: Record<string, unknown>[]): Map<number, boolean> {
  const ketQua = new Map<number, boolean>();
  const originRefs = [...new Set(
    rows.map((r) => (r.origin_ref == null ? null : String(r.origin_ref))).filter((v): v is string => Boolean(v))
  )];
  if (originRefs.length === 0) return ketQua;

  const defPlaceholders = originRefs.map(() => '?').join(', ');
  const definitions = db.prepare(`SELECT * FROM release_task_definitions WHERE id IN (${defPlaceholders})`)
    .all(...originRefs) as unknown as ReleaseTaskDefinitionRow[];
  if (definitions.length === 0) return ketQua;
  const definitionsById = new Map(definitions.map((d) => [d.id, d]));

  const templateIds = [...new Set(definitions.map((d) => d.template_id).filter((v): v is string => Boolean(v)))];
  const templatesById = new Map<string, string>();
  if (templateIds.length > 0) {
    const tplPlaceholders = templateIds.map(() => '?').join(', ');
    (db.prepare(`SELECT id, content FROM release_templates WHERE id IN (${tplPlaceholders})`).all(...templateIds) as { id: string; content: string }[])
      .forEach((tpl) => templatesById.set(tpl.id, tpl.content));
  }

  for (const row of rows) {
    const originRef = row.origin_ref == null ? null : String(row.origin_ref);
    if (!originRef) continue;
    const definition = definitionsById.get(originRef);
    if (!definition) continue;
    const releaseDate = row.release_date == null ? null : String(row.release_date);
    if (!releaseDate) continue;
    const templateContent = definition.template_id ? (templatesById.get(String(definition.template_id)) ?? null) : null;
    const target = buildDefinitionTargetPayload(definition, releaseDate, templateContent);
    const changed = diffTaskAgainstDefinition(row as unknown as TaskRowForDiff, target);
    if (changed.length > 0) ketQua.set(Number(row.id), true);
  }
  return ketQua;
}

router.get('/tasks', (req, res) => {
  const selectedDate = parseDateParam(req.query.date);

  const khoTask = (db.prepare(
    "SELECT * FROM tasks WHERE loai_task = 'don_le' AND trang_thai = 'chua_thuc_hien' ORDER BY id DESC"
  ).all() as Record<string, unknown>[]).map(mapTask);

  const taskHomNay = (db.prepare(
    "SELECT * FROM tasks WHERE loai_task = 'don_le' AND trang_thai = 'dang_tien_hanh' ORDER BY id DESC"
  ).all() as Record<string, unknown>[]).map(mapTask);

  const lichSu = (db.prepare(
    "SELECT * FROM tasks WHERE loai_task = 'don_le' AND trang_thai IN ('da_hoan_thanh', 'canceled') ORDER BY ngay_hoan_thanh DESC, id DESC"
  ).all() as Record<string, unknown>[]).map(mapTask);

  const allDinhKyRows = db.prepare(
    "SELECT * FROM tasks WHERE loai_task = 'dinh_ky' AND trang_thai != 'canceled' ORDER BY id DESC"
  ).all() as Record<string, unknown>[];
  const rawDinhKyById = new Map(allDinhKyRows.map((r) => [Number(r.id), r]));
  const allDinhKy = allDinhKyRows.map(mapTask);

  const taskDinhKyKhopNgay = allDinhKy
    .filter((task) => recurringMatchesDate(task, selectedDate))
    .map((task) => ({
      ...task,
      trangThai:
        task.trangThai === 'da_hoan_thanh' && !isSameLocalDate(task.ngayHoanThanh, selectedDate)
          ? 'chua_thuc_hien' as TrangThai
          : task.trangThai
    }))
    .sort((a, b) => String(a.gioBatDau).localeCompare(String(b.gioBatDau)));

  const lechMap = tinhLechDefinitionBulk(
    taskDinhKyKhopNgay.map((t) => rawDinhKyById.get(t.id)).filter((r): r is Record<string, unknown> => Boolean(r))
  );
  const taskDinhKy = taskDinhKyKhopNgay.map((task) => ({ ...task, lechDefinition: lechMap.get(task.id) || false }));

  res.json({ khoTask, taskHomNay, taskDinhKy, lichSu });
});

router.get('/history', (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const baseWhere = "loai_task = 'don_le' AND trang_thai IN ('da_hoan_thanh', 'canceled')";
  const rows = (keyword
    ? db.prepare(`
        SELECT * FROM tasks
        WHERE ${baseWhere}
          AND (ten_task LIKE ? OR ghi_chu LIKE ? OR trang_thai LIKE ? OR ngay_tao LIKE ? OR ngay_hoan_thanh LIKE ?)
        ORDER BY ngay_hoan_thanh DESC, id DESC
      `).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    : db.prepare(`SELECT * FROM tasks WHERE ${baseWhere} ORDER BY ngay_hoan_thanh DESC, id DESC`).all()
  ) as Record<string, unknown>[];
  res.json(rows.map(mapTask));
});

router.post('/tasks', (req, res) => {
  const body = req.body as TaoTaskBody;
  if (!body.tenTask?.trim()) throw new HttpError(400, 'Tên task là bắt buộc');

  const loaiTask = body.loaiTask || 'don_le';
  if (loaiTask !== 'don_le' && loaiTask !== 'dinh_ky') throw new HttpError(400, 'Loại task không hợp lệ');
  const lapLaiKieu = body.lapLaiKieu || 'hang_ngay';
  const thuTrongTuanList = chuanHoaThuTrongTuan(body.thuTrongTuan);
  const ngayTrongThangValue = Number.isInteger(body.ngayTrongThang) ? (body.ngayTrongThang as number) : null;
  if (loaiTask === 'dinh_ky') xacThucKieuLapDinhKy(lapLaiKieu, thuTrongTuanList, ngayTrongThangValue);

  const trangThai: TrangThai = loaiTask === 'don_le' && body.thucHienNgay ? 'dang_tien_hanh' : 'chua_thuc_hien';
  const taskLinks = normalizeTaskLinks(body.links);
  const result = db.prepare(`
    INSERT INTO tasks (
      ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
      lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, task_links
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.tenTask.trim(),
    body.ghiChu?.trim() || '',
    loaiTask,
    null,
    trangThai,
    new Date().toISOString(),
    loaiTask === 'dinh_ky' ? body.gioBatDau || '09:00' : null,
    loaiTask === 'dinh_ky' ? body.gioKetThuc || null : null,
    loaiTask === 'dinh_ky' ? lapLaiKieu : null,
    loaiTask === 'dinh_ky' ? ngayTrongThangValue : null,
    loaiTask === 'dinh_ky' ? (thuTrongTuanList.join(',') || null) : null,
    JSON.stringify(taskLinks)
  );
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  const newTask = mapTask(row);
  res.status(201).json(newTask);
});

router.patch('/tasks/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const trangThai = req.body.trangThai as TrangThai;
  if (!['chua_thuc_hien', 'dang_tien_hanh', 'da_hoan_thanh', 'canceled'].includes(trangThai)) {
    throw new HttpError(400, 'Trạng thái không hợp lệ');
  }
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Không tìm thấy task');
  db.prepare('UPDATE tasks SET trang_thai = ?, ngay_hoan_thanh = ? WHERE id = ?').run(
    trangThai,
    ['da_hoan_thanh', 'canceled'].includes(trangThai) ? new Date().toISOString() : null,
    id
  );
  res.json({ ok: true });
});

router.patch('/tasks/:id/schedule', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as CapNhatLichBody;
  const timePattern = /^\d{2}:\d{2}$/;
  if (!body.gioBatDau || !body.gioKetThuc || !timePattern.test(body.gioBatDau) || !timePattern.test(body.gioKetThuc)) {
    throw new HttpError(400, 'Giờ không hợp lệ');
  }
  // Capture giá trị đã narrow (string) để dùng trong closure transaction bên dưới.
  const gioBatDau = body.gioBatDau;
  const gioKetThuc = body.gioKetThuc;

  const start = toMinutes(gioBatDau);
  const end = toMinutes(gioKetThuc);
  if (start < 7 * 60 + 30 || end > 18 * 60 || end <= start) {
    throw new HttpError(400, 'Khoảng giờ không hợp lệ');
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!task) throw new HttpError(404, 'Không tìm thấy task');
  if (task.loai_task !== 'dinh_ky') throw new HttpError(400, 'Chỉ task định kỳ mới có thể đổi lịch');

  db.prepare('UPDATE tasks SET gio_bat_dau = ?, gio_ket_thuc = ? WHERE id = ?').run(gioBatDau, gioKetThuc, id);
  res.json({ ok: true, taskId: id });
});

router.patch('/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as CapNhatTaskBody;
  if (!body.tenTask?.trim()) throw new HttpError(400, 'Tên task là bắt buộc');

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!task) throw new HttpError(404, 'Không tìm thấy task');

  // PATCH = vá MỘT PHẦN cho MỌI trường: field không có trong body (`undefined`) thì GIỮ NGUYÊN giá trị
  // cũ; muốn xoá thì phải gửi tường minh giá trị rỗng/null.
  // BUG-20260807: trước đây một số trường theo đúng luật này, còn ghiChu/links/gioKetThuc/lapLaiKieu/
  // ngayTrongThang/thuTrongTuan thì thiếu = XOÁ TRẮNG (riêng lapLaiKieu còn tự nhảy về 'hang_ngay').
  // Hậu quả thật: gọi PATCH để sửa một trường nhỏ làm bay sạch các trường khác không được gửi kèm.
  const title = body.tenTask.trim();
  const note = body.ghiChu === undefined ? String(task.ghi_chu || '') : body.ghiChu.trim();
  const linksJson = body.links === undefined
    ? String(task.task_links || '[]')
    : JSON.stringify(normalizeTaskLinks(body.links));
  const taskMonthDay = task.ngay_trong_thang == null ? null : Number(task.ngay_trong_thang);
  const laTaskDinhKyThuCong = task.loai_task === 'dinh_ky' && !task.release_month && !task.release_date;
  const nextStartTime = laTaskDinhKyThuCong ? body.gioBatDau || String(task.gio_bat_dau || '09:00') : task.gio_bat_dau == null ? null : String(task.gio_bat_dau);
  const nextEndTime = laTaskDinhKyThuCong
    ? body.gioKetThuc === undefined ? (task.gio_ket_thuc == null ? null : String(task.gio_ket_thuc)) : body.gioKetThuc || null
    : task.gio_ket_thuc == null ? null : String(task.gio_ket_thuc);
  const nextRepeat = laTaskDinhKyThuCong
    ? body.lapLaiKieu === undefined ? String(task.lap_lai_kieu || 'hang_ngay') : body.lapLaiKieu || 'hang_ngay'
    : task.lap_lai_kieu == null ? null : String(task.lap_lai_kieu);
  const nextMonthDay = laTaskDinhKyThuCong
    ? body.ngayTrongThang === undefined ? taskMonthDay : body.ngayTrongThang ?? null
    : taskMonthDay;
  const taskWeekdays = task.thu_trong_tuan == null ? null : String(task.thu_trong_tuan);
  const nextWeekdays = laTaskDinhKyThuCong
    ? body.thuTrongTuan === undefined
      ? taskWeekdays
      : chuanHoaThuTrongTuan(body.thuTrongTuan).join(',') || null
    : taskWeekdays;

  if (laTaskDinhKyThuCong) xacThucKieuLapDinhKy(nextRepeat as string, nextWeekdays ? nextWeekdays.split(',').map(Number) : [], nextMonthDay);

  withTransaction(() => {
  if (task.loai_task === 'dinh_ky' && body.updateRelated) {
    const result = db.prepare(`
      UPDATE tasks
      SET ten_task = ?, ghi_chu = ?, do_uu_tien = NULL, task_links = ?,
          gio_bat_dau = ?, gio_ket_thuc = ?, lap_lai_kieu = ?, ngay_trong_thang = ?, thu_trong_tuan = ?
      WHERE loai_task = 'dinh_ky'
        AND COALESCE(release_month, '') = ''
        AND COALESCE(release_date, '') = ''
        AND ten_task = ?
        AND COALESCE(lap_lai_kieu, '') = COALESCE(?, '')
        AND COALESCE(ngay_trong_thang, -1) = COALESCE(?, -1)
        AND COALESCE(thu_trong_tuan, '') = COALESCE(?, '')
        AND COALESCE(ngay_cu_the, '') = COALESCE(?, '')
        AND COALESCE(gio_bat_dau, '') = COALESCE(?, '')
        AND COALESCE(gio_ket_thuc, '') = COALESCE(?, '')
    `).run(
      title, note, linksJson, nextStartTime, nextEndTime, nextRepeat, nextMonthDay, nextWeekdays,
      String(task.ten_task),
      task.lap_lai_kieu == null ? null : String(task.lap_lai_kieu),
      taskMonthDay,
      task.thu_trong_tuan == null ? null : String(task.thu_trong_tuan),
      task.ngay_cu_the == null ? null : String(task.ngay_cu_the),
      task.gio_bat_dau == null ? null : String(task.gio_bat_dau),
      task.gio_ket_thuc == null ? null : String(task.gio_ket_thuc)
    );
    if (result.changes === 0) {
      db.prepare(`
        UPDATE tasks
        SET ten_task = ?, ghi_chu = ?, do_uu_tien = NULL, task_links = ?,
            gio_bat_dau = ?, gio_ket_thuc = ?, lap_lai_kieu = ?, ngay_trong_thang = ?, thu_trong_tuan = ?
        WHERE id = ?
      `).run(title, note, linksJson, nextStartTime, nextEndTime, nextRepeat, nextMonthDay, nextWeekdays, id);
    }
  } else {
    db.prepare(`
      UPDATE tasks
      SET ten_task = ?, ghi_chu = ?, do_uu_tien = NULL, task_links = ?,
          gio_bat_dau = ?, gio_ket_thuc = ?, lap_lai_kieu = ?, ngay_trong_thang = ?, thu_trong_tuan = ?
      WHERE id = ?
    `).run(title, note, linksJson, nextStartTime, nextEndTime, nextRepeat, nextMonthDay, nextWeekdays, id);
  }
  });
  res.json({ ok: true, taskId: id });
});

router.delete('/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (result.changes === 0) throw new HttpError(404, 'Không tìm thấy task');
  res.json({ ok: true });
});

export default router;
