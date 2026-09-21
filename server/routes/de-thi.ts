import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import {
  type DeThiKyThiBody,
  type DeThiImportBody,
  type DeThiCapNhatCauHoiBody,
  type DeThiLuuPhienBody,
  type DeThiCauHoiImport
} from '../types.js';
import { HttpError, sendRouteError } from '../lib/utils.js';

const router = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────────
function loadCauHoiCuaBo(boId: number) {
  const cauHoi = db.prepare(`
    SELECT * FROM de_thi_cau_hoi WHERE bo_id = ? ORDER BY sort_order ASC, id ASC
  `).all(boId) as Record<string, unknown>[];
  const dapAn = db.prepare(`
    SELECT da.* FROM de_thi_dap_an da
    JOIN de_thi_cau_hoi ch ON ch.id = da.cau_hoi_id
    WHERE ch.bo_id = ? ORDER BY da.cau_hoi_id ASC, da.sort_order ASC, da.id ASC
  `).all(boId) as Record<string, unknown>[];

  const dapAnTheoCau = new Map<number, Record<string, unknown>[]>();
  for (const da of dapAn) {
    const cid = Number(da.cau_hoi_id);
    if (!dapAnTheoCau.has(cid)) dapAnTheoCau.set(cid, []);
    dapAnTheoCau.get(cid)!.push(da);
  }

  return cauHoi.map((ch) => {
    const id = Number(ch.id);
    return {
      id,
      loai: String(ch.loai),
      noiDungEn: String(ch.noi_dung_en),
      noiDungVi: String(ch.noi_dung_vi || ''),
      giaiThichEn: String(ch.giai_thich_en || ''),
      giaiThichVi: String(ch.giai_thich_vi || ''),
      chuDe: String(ch.chu_de || ''),
      doKho: String(ch.do_kho || ''),
      dichThuCong: Number(ch.dich_thu_cong) === 1,
      dapAn: (dapAnTheoCau.get(id) || []).map((da) => ({
        id: Number(da.id),
        noiDungEn: String(da.noi_dung_en),
        noiDungVi: String(da.noi_dung_vi || ''),
        laDapAnDung: Number(da.la_dap_an_dung) === 1
      }))
    };
  });
}

// ── Danh sách kỳ thi / chứng chỉ (kèm số bộ đề) ──────────────────────────────────
router.get('/de-thi/ky-thi', (_req, res) => {
  const rows = db.prepare(`
    SELECT k.*, (SELECT COUNT(*) FROM de_thi_bo b WHERE b.ky_thi_id = k.id) AS so_bo
    FROM de_thi_ky_thi k
    ORDER BY k.nhom ASC, k.sort_order ASC, k.id ASC
  `).all() as Record<string, unknown>[];
  res.json(rows.map((r) => ({
    id: Number(r.id),
    nhom: String(r.nhom || ''),
    ten: String(r.ten),
    ghiChu: String(r.ghi_chu || ''),
    examSoCau: r.exam_so_cau == null ? null : Number(r.exam_so_cau),
    examThoiGianPhut: r.exam_thoi_gian_phut == null ? null : Number(r.exam_thoi_gian_phut),
    soBo: Number(r.so_bo || 0),
    createdAt: String(r.created_at)
  })));
});

// Số nguyên dương hợp lệ hoặc null (cho cấu hình thi thử). Giá trị <= 0 / không phải số -> null.
function posIntOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.post('/de-thi/ky-thi', (req, res) => {
  const body = req.body as DeThiKyThiBody;
  const ten = body.ten?.trim();
  if (!ten) return res.status(400).json({ message: 'Tên chứng chỉ là bắt buộc' });
  const now = new Date().toISOString();
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM de_thi_ky_thi').get() as { n: number };
  const result = db.prepare(`
    INSERT INTO de_thi_ky_thi (nhom, ten, ghi_chu, exam_so_cau, exam_thoi_gian_phut, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.nhom?.trim() || '',
    ten,
    body.ghiChu?.trim() || '',
    posIntOrNull(body.examSoCau),
    posIntOrNull(body.examThoiGianPhut),
    next.n, now, now
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.patch('/de-thi/ky-thi/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID không hợp lệ' });
  const body = req.body as DeThiKyThiBody;
  const existing = db.prepare('SELECT id FROM de_thi_ky_thi WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ message: 'Không tìm thấy chứng chỉ' });
  // exam_* chỉ cập nhật khi field có mặt trong body (cho phép đặt null để xóa cấu hình).
  const hasExamSoCau = body.examSoCau !== undefined;
  const hasExamPhut = body.examThoiGianPhut !== undefined;
  db.prepare(`
    UPDATE de_thi_ky_thi
    SET nhom = COALESCE(?, nhom), ten = COALESCE(?, ten), ghi_chu = COALESCE(?, ghi_chu),
        exam_so_cau = CASE WHEN ? THEN ? ELSE exam_so_cau END,
        exam_thoi_gian_phut = CASE WHEN ? THEN ? ELSE exam_thoi_gian_phut END,
        updated_at = ?
    WHERE id = ?
  `).run(
    body.nhom ?? null, body.ten?.trim() || null, body.ghiChu ?? null,
    hasExamSoCau ? 1 : 0, hasExamSoCau ? posIntOrNull(body.examSoCau) : null,
    hasExamPhut ? 1 : 0, hasExamPhut ? posIntOrNull(body.examThoiGianPhut) : null,
    new Date().toISOString(), id
  );
  res.json({ updated: true });
});

// Xóa kỳ thi -> xóa toàn bộ bộ đề (và câu hỏi/đáp án) thuộc nó.
router.delete('/de-thi/ky-thi/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID không hợp lệ' });
  try {
    const deleted = withTransaction(() => {
      // FK ON DELETE CASCADE trên de_thi_cau_hoi/dap_an lo phần con khi xóa bộ đề.
      db.prepare('DELETE FROM de_thi_bo WHERE ky_thi_id = ?').run(id);
      return db.prepare('DELETE FROM de_thi_ky_thi WHERE id = ?').run(id).changes;
    });
    res.json({ deleted });
  } catch (error) {
    sendRouteError(res, error, 'Không thể xóa chứng chỉ');
  }
});

// Nạp đầy đủ câu hỏi + đáp án theo danh sách id, giữ đúng thứ tự id truyền vào.
function loadCauHoiByIds(ids: number[]) {
  if (ids.length === 0) return [] as ReturnType<typeof loadCauHoiCuaBo>;
  const ph = ids.map(() => '?').join(', ');
  const cauHoi = db.prepare(`SELECT * FROM de_thi_cau_hoi WHERE id IN (${ph})`).all(...ids) as Record<string, unknown>[];
  const dapAn = db.prepare(`SELECT * FROM de_thi_dap_an WHERE cau_hoi_id IN (${ph}) ORDER BY cau_hoi_id ASC, sort_order ASC, id ASC`).all(...ids) as Record<string, unknown>[];
  const dapAnTheoCau = new Map<number, Record<string, unknown>[]>();
  for (const da of dapAn) {
    const cid = Number(da.cau_hoi_id);
    if (!dapAnTheoCau.has(cid)) dapAnTheoCau.set(cid, []);
    dapAnTheoCau.get(cid)!.push(da);
  }
  const byId = new Map<number, Record<string, unknown>>();
  for (const ch of cauHoi) byId.set(Number(ch.id), ch);
  return ids
    .map((id) => byId.get(id))
    .filter((ch): ch is Record<string, unknown> => Boolean(ch))
    .map((ch) => {
      const id = Number(ch.id);
      return {
        id,
        loai: String(ch.loai),
        noiDungEn: String(ch.noi_dung_en),
        noiDungVi: String(ch.noi_dung_vi || ''),
        giaiThichEn: String(ch.giai_thich_en || ''),
        giaiThichVi: String(ch.giai_thich_vi || ''),
        chuDe: String(ch.chu_de || ''),
        doKho: String(ch.do_kho || ''),
        dichThuCong: Number(ch.dich_thu_cong) === 1,
        dapAn: (dapAnTheoCau.get(id) || []).map((da) => ({
          id: Number(da.id),
          noiDungEn: String(da.noi_dung_en),
          noiDungVi: String(da.noi_dung_vi || ''),
          laDapAnDung: Number(da.la_dap_an_dung) === 1
        }))
      };
    });
}

// ── Rút câu hỏi để làm bài (công bằng) ───────────────────────────────────────────
// Nguồn = 1 bộ đề (boId) hoặc gộp cả chứng chỉ (kyThiId). Rút công bằng: ưu tiên câu
// có lan_ra nhỏ nhất (ít được ra nhất), trong nhóm cùng mức ưu tiên câu lâu chưa ra nhất
// rồi random trong nhóm cùng thời điểm -> mọi câu đều có lượt trước khi lặp lại, đồng thời
// tránh lấy lại câu vừa gặp sau khi hoàn tất một vòng. Mỗi câu được rút sẽ tăng lan_ra.
router.post('/de-thi/rut-cau', (req, res) => {
  const body = req.body as { boId?: number | null; kyThiId?: number | null; soCau?: number | 'all' };
  let boIds: number[] = [];
  let ten = '';
  let nhom = '';
  if (body.boId != null) {
    const bo = db.prepare('SELECT * FROM de_thi_bo WHERE id = ?').get(Number(body.boId)) as Record<string, unknown> | undefined;
    if (!bo) return res.status(404).json({ message: 'Không tìm thấy bộ đề' });
    boIds = [Number(bo.id)];
    ten = String(bo.ten);
  } else if (body.kyThiId != null) {
    const kyThi = db.prepare('SELECT * FROM de_thi_ky_thi WHERE id = ?').get(Number(body.kyThiId)) as Record<string, unknown> | undefined;
    if (!kyThi) return res.status(404).json({ message: 'Không tìm thấy chứng chỉ' });
    nhom = String(kyThi.nhom || '');
    ten = `Tổng hợp · ${nhom ? nhom + ' ' : ''}${String(kyThi.ten)}`;
    boIds = (db.prepare('SELECT id FROM de_thi_bo WHERE ky_thi_id = ?').all(Number(body.kyThiId)) as { id: number }[]).map((r) => Number(r.id));
  } else {
    return res.status(400).json({ message: 'Thiếu boId hoặc kyThiId' });
  }

  if (boIds.length === 0) return res.json({ ten, nhom, passPercent: null, durationSeconds: null, soCauNguon: 0, cauHoi: [] });

  const ph = boIds.map(() => '?').join(', ');
  const boMeta = db.prepare(`
    SELECT pass_percent, duration_seconds,
      (SELECT COUNT(*) FROM de_thi_cau_hoi c WHERE c.bo_id = b.id) AS so_cau
    FROM de_thi_bo b WHERE b.id IN (${ph})
  `).all(...boIds) as Record<string, unknown>[];
  const soCauNguon = boMeta.reduce((s, b) => s + Number(b.so_cau || 0), 0);
  const totalDuration = boMeta.reduce((s, b) => s + (b.duration_seconds == null ? 0 : Number(b.duration_seconds)), 0);
  const passPercent = boMeta.map((b) => b.pass_percent).find((v) => v != null);

  // QA-2026-09-12: soCau âm trước đây lọt xuống SQL `LIMIT <n>` — SQLite coi LIMIT âm là "không giới
  // hạn", nên soCau=-1 trả về TOÀN BỘ ngân hàng câu hỏi thay vì 0/bị từ chối. Dropdown FE chỉ có giá
  // trị dương cố định nên không tự gặp được, nhưng vẫn kẹp ở đây để route không tin ngầm định SQL.
  const limit = body.soCau === 'all' || body.soCau == null ? soCauNguon : Math.max(0, Math.min(Number(body.soCau) || 0, soCauNguon));
  const picked = db.prepare(
    `SELECT id FROM de_thi_cau_hoi WHERE bo_id IN (${ph}) ORDER BY lan_ra ASC, last_rut_at ASC, RANDOM() LIMIT ?`
  ).all(...boIds, limit) as { id: number }[];
  const ids = picked.map((p) => Number(p.id));

  if (ids.length > 0) {
    const idPh = ids.map(() => '?').join(', ');
    db.prepare(`UPDATE de_thi_cau_hoi SET lan_ra = lan_ra + 1, last_rut_at = ? WHERE id IN (${idPh})`).run(new Date().toISOString(), ...ids);
  }

  const perQ = totalDuration && soCauNguon ? totalDuration / soCauNguon : 0;
  const durationSeconds = perQ ? Math.round(perQ * ids.length) : null;

  res.json({
    ten,
    nhom,
    passPercent: passPercent == null ? null : Number(passPercent),
    durationSeconds,
    soCauNguon,
    cauHoi: loadCauHoiByIds(ids)
  });
});

// ── Xóa toàn bộ ngân hàng (mọi bộ đề + câu hỏi/đáp án) của một chứng chỉ ─────────
router.delete('/de-thi/ky-thi/:id/bo', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID không hợp lệ' });
  // FK ON DELETE CASCADE trên de_thi_cau_hoi/dap_an lo phần con khi xóa bộ đề.
  const r = db.prepare('DELETE FROM de_thi_bo WHERE ky_thi_id = ?').run(id);
  res.json({ deleted: r.changes });
});

// ── Tên các file đã import của một chứng chỉ (để chặn import trùng tên) ──────────
router.get('/de-thi/ky-thi/:id/file-names', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID không hợp lệ' });
  const rows = db.prepare("SELECT DISTINCT file_name FROM de_thi_bo WHERE ky_thi_id = ? AND file_name <> ''").all(id) as { file_name: string }[];
  res.json(rows.map((r) => r.file_name));
});

// ── Ngân hàng câu hỏi của một chứng chỉ (chỉ nội dung câu hỏi, không kèm đáp án) ──
router.get('/de-thi/ky-thi/:id/cau-hoi', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID không hợp lệ' });
  const rows = db.prepare(`
    SELECT c.id, c.noi_dung_en, c.noi_dung_vi
    FROM de_thi_cau_hoi c
    JOIN de_thi_bo b ON b.id = c.bo_id
    WHERE b.ky_thi_id = ?
    ORDER BY b.sort_order ASC, b.id ASC, c.sort_order ASC, c.id ASC
  `).all(id) as { id: number; noi_dung_en: string; noi_dung_vi: string }[];
  res.json(rows.map((r) => ({ id: Number(r.id), noiDungEn: String(r.noi_dung_en), noiDungVi: String(r.noi_dung_vi || '') })));
});

// ── Danh sách bộ đề (lọc theo kỳ thi qua ?kyThiId; kèm số câu, số câu đã dịch) ────
router.get('/de-thi/bo', (req, res) => {
  const kyThiId = req.query.kyThiId ? Number(req.query.kyThiId) : null;
  const baseSelect = `
    SELECT
      b.*,
      (SELECT COUNT(*) FROM de_thi_cau_hoi c WHERE c.bo_id = b.id) AS so_cau
    FROM de_thi_bo b
  `;
  const rows = (kyThiId
    ? db.prepare(`${baseSelect} WHERE b.ky_thi_id = ? ORDER BY b.sort_order ASC, b.id DESC`).all(kyThiId)
    : db.prepare(`${baseSelect} ORDER BY b.sort_order ASC, b.id DESC`).all()
  ) as Record<string, unknown>[];
  res.json(rows.map((r) => ({
    id: Number(r.id),
    kyThiId: r.ky_thi_id == null ? null : Number(r.ky_thi_id),
    ten: String(r.ten),
    nguon: String(r.nguon || ''),
    ghiChu: String(r.ghi_chu || ''),
    passPercent: r.pass_percent == null ? null : Number(r.pass_percent),
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    soCau: Number(r.so_cau || 0),
    createdAt: String(r.created_at)
  })));
});

// ── Chi tiết một bộ (kèm toàn bộ câu hỏi + đáp án) ───────────────────────────────
router.get('/de-thi/bo/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID bộ đề không hợp lệ' });
  const bo = db.prepare('SELECT * FROM de_thi_bo WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!bo) return res.status(404).json({ message: 'Không tìm thấy bộ đề' });
  res.json({
    id: Number(bo.id),
    ten: String(bo.ten),
    nguon: String(bo.nguon || ''),
    ghiChu: String(bo.ghi_chu || ''),
    passPercent: bo.pass_percent == null ? null : Number(bo.pass_percent),
    durationSeconds: bo.duration_seconds == null ? null : Number(bo.duration_seconds),
    cauHoi: loadCauHoiCuaBo(id)
  });
});

// ── Import một bộ đề (FE đã bóc quizData từ HTML thành cấu trúc chuẩn) ────────────
router.post('/de-thi/import', (req, res) => {
  const body = req.body as DeThiImportBody;
  const ten = body.ten?.trim();
  if (!ten) return res.status(400).json({ message: 'Tên bộ đề là bắt buộc' });
  if (!Array.isArray(body.cauHoi) || body.cauHoi.length === 0) {
    return res.status(400).json({ message: 'Bộ đề không có câu hỏi nào' });
  }

  // Chặn import trùng tên file trong cùng một chứng chỉ.
  const fileName = body.fileName?.trim() || '';
  if (fileName && body.kyThiId != null) {
    const trung = db.prepare('SELECT id FROM de_thi_bo WHERE ky_thi_id = ? AND file_name = ?').get(body.kyThiId, fileName);
    if (trung) return res.status(409).json({ message: `File "${fileName}" đã được import trước đó` });
  }

  const now = new Date().toISOString();
  try {
    const result = withTransaction(() => {
      const nextSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM de_thi_bo').get() as { next: number };
      const boResult = db.prepare(`
        INSERT INTO de_thi_bo (ky_thi_id, ten, nguon, file_name, ghi_chu, pass_percent, duration_seconds, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        body.kyThiId ?? null,
        ten,
        body.nguon?.trim() || '',
        fileName,
        body.ghiChu?.trim() || '',
        body.passPercent ?? null,
        body.durationSeconds ?? null,
        nextSort.next,
        now,
        now
      );
      const boId = Number(boResult.lastInsertRowid);

      const insertCau = db.prepare(`
        INSERT INTO de_thi_cau_hoi
          (bo_id, loai, noi_dung_en, noi_dung_vi, giai_thich_en, giai_thich_vi, chu_de, do_kho, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertDap = db.prepare(`
        INSERT INTO de_thi_dap_an (cau_hoi_id, noi_dung_en, noi_dung_vi, la_dap_an_dung, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `);

      let soCau = 0;
      body.cauHoi!.forEach((cau: DeThiCauHoiImport, index) => {
        const noiDungEn = cau.noiDungEn?.trim();
        if (!noiDungEn) throw new HttpError(400, `Câu hỏi #${index + 1} thiếu nội dung`);
        if (!Array.isArray(cau.dapAn) || cau.dapAn.length < 2) {
          throw new HttpError(400, `Câu hỏi #${index + 1} cần ít nhất 2 đáp án`);
        }
        const loai = cau.loai === 'multi' ? 'multi' : 'single';
        const cauResult = insertCau.run(
          boId,
          loai,
          noiDungEn,
          cau.noiDungVi?.trim() || '',
          cau.giaiThichEn?.trim() || '',
          cau.giaiThichVi?.trim() || '',
          cau.chuDe?.trim() || '',
          cau.doKho?.trim() || '',
          index,
          now,
          now
        );
        const cauId = Number(cauResult.lastInsertRowid);
        cau.dapAn.forEach((da, di) => {
          insertDap.run(cauId, (da.noiDungEn || '').trim(), (da.noiDungVi || '').trim(), da.laDapAnDung ? 1 : 0, di);
        });
        soCau++;
      });

      return { boId, soCau };
    });
    res.status(201).json(result);
  } catch (error) {
    sendRouteError(res, error, 'Không thể import bộ đề');
  }
});

// ── Sửa bản dịch / chủ đề / độ khó của một câu ───────────────────────────────────
router.patch('/de-thi/cau-hoi/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID câu hỏi không hợp lệ' });
  const body = req.body as DeThiCapNhatCauHoiBody;
  const existing = db.prepare('SELECT id FROM de_thi_cau_hoi WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ message: 'Không tìm thấy câu hỏi' });

  const now = new Date().toISOString();
  try {
    withTransaction(() => {
      db.prepare(`
        UPDATE de_thi_cau_hoi
        SET noi_dung_vi = COALESCE(?, noi_dung_vi),
            giai_thich_vi = COALESCE(?, giai_thich_vi),
            chu_de = COALESCE(?, chu_de),
            do_kho = COALESCE(?, do_kho),
            dich_thu_cong = COALESCE(?, dich_thu_cong),
            updated_at = ?
        WHERE id = ?
      `).run(
        body.noiDungVi ?? null,
        body.giaiThichVi ?? null,
        body.chuDe ?? null,
        body.doKho ?? null,
        body.dichThuCong == null ? null : (body.dichThuCong ? 1 : 0),
        now,
        id
      );
      if (Array.isArray(body.dapAnVi)) {
        const upd = db.prepare('UPDATE de_thi_dap_an SET noi_dung_vi = ? WHERE id = ? AND cau_hoi_id = ?');
        for (const da of body.dapAnVi) {
          if (Number.isInteger(da.id)) upd.run(da.noiDungVi || '', da.id, id);
        }
      }
    });
    res.json({ updated: true });
  } catch (error) {
    sendRouteError(res, error, 'Không thể cập nhật câu hỏi');
  }
});

// ── Xóa bộ đề (cascade câu hỏi + đáp án qua FK) ──────────────────────────────────
router.delete('/de-thi/bo/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID bộ đề không hợp lệ' });
  const result = db.prepare('DELETE FROM de_thi_bo WHERE id = ?').run(id);
  res.json({ deleted: result.changes });
});

// ── Lưu một phiên làm bài ────────────────────────────────────────────────────────
router.post('/de-thi/phien', (req, res) => {
  const body = req.body as DeThiLuuPhienBody;
  const traLoi = Array.isArray(body.traLoi) ? body.traLoi : [];
  const soCau = traLoi.length;
  const soDung = traLoi.filter((t) => t.dungSai).length;
  const now = new Date().toISOString();
  try {
    const phienId = withTransaction(() => {
      const result = db.prepare(`
        INSERT INTO de_thi_phien (bo_id, che_do, so_cau, so_dung, thoi_gian_giay, cau_hinh_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        body.boId ?? null,
        body.cheDo === 'exam' ? 'exam' : 'review',
        soCau,
        soDung,
        Number(body.thoiGianGiay) || 0,
        JSON.stringify(body.cauHinh || {}),
        now
      );
      const pid = Number(result.lastInsertRowid);
      const insert = db.prepare(`
        INSERT INTO de_thi_tra_loi (phien_id, cau_hoi_id, dap_an_chon_json, dung_sai) VALUES (?, ?, ?, ?)
      `);
      for (const t of traLoi) {
        insert.run(pid, Number(t.cauHoiId), JSON.stringify(Array.isArray(t.dapAnChon) ? t.dapAnChon : []), t.dungSai ? 1 : 0);
      }
      return pid;
    });
    res.status(201).json({ phienId, soCau, soDung });
  } catch (error) {
    sendRouteError(res, error, 'Không thể lưu phiên làm bài');
  }
});

// ── Lịch sử các phiên (tùy chọn lọc theo bộ) ─────────────────────────────────────
router.get('/de-thi/phien', (req, res) => {
  const boId = req.query.boId ? Number(req.query.boId) : null;
  const rows = (boId
    ? db.prepare('SELECT p.*, b.ten AS bo_ten FROM de_thi_phien p LEFT JOIN de_thi_bo b ON b.id = p.bo_id WHERE p.bo_id = ? ORDER BY p.created_at DESC LIMIT 100').all(boId)
    : db.prepare('SELECT p.*, b.ten AS bo_ten FROM de_thi_phien p LEFT JOIN de_thi_bo b ON b.id = p.bo_id ORDER BY p.created_at DESC LIMIT 100').all()
  ) as Record<string, unknown>[];
  res.json(rows.map((r) => ({
    id: Number(r.id),
    boId: r.bo_id == null ? null : Number(r.bo_id),
    boTen: r.bo_ten == null ? null : String(r.bo_ten),
    cheDo: String(r.che_do),
    soCau: Number(r.so_cau),
    soDung: Number(r.so_dung),
    thoiGianGiay: Number(r.thoi_gian_giay),
    createdAt: String(r.created_at)
  })));
});

// ── Xuất ngân hàng câu hỏi của một chứng chỉ ra JSON (để nhờ AI dịch ngoài tool) ──
// Cấu trúc song ngữ kèm id; AI chỉ cần điền các trường *Vi rồi import lại để cập nhật bản dịch.
router.get('/de-thi/ky-thi/:id/export', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID không hợp lệ' });
  const kyThi = db.prepare('SELECT * FROM de_thi_ky_thi WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!kyThi) return res.status(404).json({ message: 'Không tìm thấy chứng chỉ' });

  const boRows = db.prepare('SELECT id, ten FROM de_thi_bo WHERE ky_thi_id = ? ORDER BY sort_order ASC, id ASC').all(id) as Record<string, unknown>[];
  const boDe = boRows.map((b) => ({
    id: Number(b.id),
    ten: String(b.ten),
    cauHoi: loadCauHoiCuaBo(Number(b.id)).map((c) => ({
      id: c.id,
      loai: c.loai,
      noiDungEn: c.noiDungEn,
      noiDungVi: c.noiDungVi,
      giaiThichEn: c.giaiThichEn,
      giaiThichVi: c.giaiThichVi,
      dapAn: c.dapAn.map((d) => ({ id: d.id, noiDungEn: d.noiDungEn, noiDungVi: d.noiDungVi, laDapAnDung: d.laDapAnDung }))
    }))
  }));

  res.json({
    version: 1,
    huongDan: 'Đây là ngân hàng câu hỏi song ngữ. Hãy DỊCH sang tiếng Việt và điền vào các trường có hậu tố "Vi" (noiDungVi, giaiThichVi, và dapAn[].noiDungVi) dựa trên trường "En" tương ứng. GIỮ NGUYÊN toàn bộ "id", các trường "En" và "laDapAnDung". KHÔNG thêm/bớt/đổi thứ tự câu hỏi hay đáp án. Trả về đúng cấu trúc JSON này để import ngược lại.',
    kyThi: { ten: String(kyThi.ten), nhom: String(kyThi.nhom || '') },
    boDe
  });
});

// ── Import JSON (cập nhật bản dịch): khớp theo id, chỉ ghi các trường *Vi có nội dung ──
router.post('/de-thi/import-json', (req, res) => {
  const body = req.body as { boDe?: { cauHoi?: { id?: number; noiDungVi?: string; giaiThichVi?: string; dapAn?: { id?: number; noiDungVi?: string }[] }[] }[] };
  if (!body || !Array.isArray(body.boDe)) {
    return res.status(400).json({ message: 'File JSON không đúng định dạng (thiếu mảng "boDe").' });
  }
  const now = new Date().toISOString();
  let capNhat = 0;
  let boQua = 0;
  try {
    withTransaction(() => {
      // CASE WHEN ? <> '' : chỉ ghi đè khi JSON có nội dung, tránh xóa mất bản dịch cũ khi để trống.
      const updCau = db.prepare(`
        UPDATE de_thi_cau_hoi
        SET noi_dung_vi = CASE WHEN ? <> '' THEN ? ELSE noi_dung_vi END,
            giai_thich_vi = CASE WHEN ? <> '' THEN ? ELSE giai_thich_vi END,
            updated_at = ?
        WHERE id = ?
      `);
      const updDap = db.prepare('UPDATE de_thi_dap_an SET noi_dung_vi = ? WHERE id = ?');
      for (const bo of body.boDe!) {
        if (!Array.isArray(bo.cauHoi)) continue;
        for (const c of bo.cauHoi) {
          const cid = Number(c.id);
          if (!Number.isInteger(cid)) { boQua++; continue; }
          const nd = typeof c.noiDungVi === 'string' ? c.noiDungVi : '';
          const gt = typeof c.giaiThichVi === 'string' ? c.giaiThichVi : '';
          const r = updCau.run(nd, nd, gt, gt, now, cid);
          if (r.changes === 0) { boQua++; continue; }
          capNhat++;
          if (Array.isArray(c.dapAn)) {
            for (const d of c.dapAn) {
              const did = Number(d.id);
              if (Number.isInteger(did) && typeof d.noiDungVi === 'string' && d.noiDungVi.trim() !== '') updDap.run(d.noiDungVi, did);
            }
          }
        }
      }
    });
    res.json({ capNhat, boQua });
  } catch (error) {
    sendRouteError(res, error, 'Không thể import JSON');
  }
});

// ── Category (nhóm/nhà cung cấp chứng chỉ) — pick-list quản lý động ──────────────
function mapCategory(row: Record<string, unknown>) {
  return { id: Number(row.id), name: String(row.name), sortOrder: Number(row.sort_order || 0) };
}

router.get('/de-thi/category', (_req, res) => {
  const rows = db.prepare('SELECT * FROM de_thi_category ORDER BY sort_order ASC, id ASC').all() as Record<string, unknown>[];
  // Số chứng chỉ đang gắn từng nhóm -> dùng để khóa nút xóa khi còn chứng chỉ dùng category.
  const counts = db.prepare("SELECT nhom, COUNT(*) AS c FROM de_thi_ky_thi WHERE nhom <> '' GROUP BY nhom").all() as { nhom: string; c: number }[];
  const soChungChiTheoNhom = new Map(counts.map((r) => [r.nhom, Number(r.c)]));
  res.json(rows.map((r) => ({ ...mapCategory(r), soChungChi: soChungChiTheoNhom.get(String(r.name)) || 0 })));
});

router.post('/de-thi/category', (req, res) => {
  const name = (req.body as { name?: string }).name?.trim();
  if (!name) return res.status(400).json({ message: 'Tên category là bắt buộc' });
  const existing = db.prepare('SELECT id FROM de_thi_category WHERE name = ?').get(name);
  if (existing) return res.status(400).json({ message: 'Category này đã tồn tại' });
  const now = new Date().toISOString();
  const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM de_thi_category').get() as { n: number }).n;
  const result = db.prepare('INSERT INTO de_thi_category (name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, next, now, now);
  const row = db.prepare('SELECT * FROM de_thi_category WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  res.status(201).json(mapCategory(row));
});

router.patch('/de-thi/category/reorder', (req, res) => {
  const raw = (req.body as { ids?: Array<string | number> }).ids;
  const ids = Array.isArray(raw) ? raw.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ message: 'Thứ tự category không hợp lệ' });
  const now = new Date().toISOString();
  const upd = db.prepare('UPDATE de_thi_category SET sort_order = ?, updated_at = ? WHERE id = ?');
  ids.forEach((id, index) => upd.run(index + 1, now, id));
  const rows = db.prepare('SELECT * FROM de_thi_category ORDER BY sort_order ASC, id ASC').all() as Record<string, unknown>[];
  res.json(rows.map(mapCategory));
});

router.patch('/de-thi/category/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Category không hợp lệ' });
  const cat = db.prepare('SELECT * FROM de_thi_category WHERE id = ?').get(id) as { name: string } | undefined;
  if (!cat) return res.status(404).json({ message: 'Không tìm thấy category' });
  const name = (req.body as { name?: string }).name?.trim();
  if (!name) return res.status(400).json({ message: 'Tên category là bắt buộc' });
  const dup = db.prepare('SELECT id FROM de_thi_category WHERE name = ? AND id <> ?').get(name, id);
  if (dup) return res.status(400).json({ message: 'Category này đã tồn tại' });
  const now = new Date().toISOString();
  const oldName = cat.name;
  try {
    withTransaction(() => {
      db.prepare('UPDATE de_thi_category SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
      // Đổi tên lan sang các chứng chỉ đang gắn nhóm cũ (de_thi_ky_thi.nhom lưu bằng tên).
      if (name !== oldName) {
        db.prepare('UPDATE de_thi_ky_thi SET nhom = ?, updated_at = ? WHERE nhom = ?').run(name, now, oldName);
      }
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể đổi tên category');
  }
  const row = db.prepare('SELECT * FROM de_thi_category WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapCategory(row));
});

// Chỉ cho xóa khi không còn chứng chỉ nào đang gắn category này.
router.delete('/de-thi/category/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Category không hợp lệ' });
  const cat = db.prepare('SELECT name FROM de_thi_category WHERE id = ?').get(id) as { name: string } | undefined;
  if (!cat) return res.status(404).json({ message: 'Không tìm thấy category' });
  const dangDung = (db.prepare('SELECT COUNT(*) AS c FROM de_thi_ky_thi WHERE nhom = ?').get(cat.name) as { c: number }).c;
  if (dangDung > 0) {
    return res.status(400).json({ message: 'Không thể xóa: còn chứng chỉ đang dùng category này.' });
  }
  db.prepare('DELETE FROM de_thi_category WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
