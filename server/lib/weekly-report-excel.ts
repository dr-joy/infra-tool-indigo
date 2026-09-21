// Xuất file Excel cho report kind "Báo cáo DM" — CR-20260915-xuat-excel-bao-cao-dm.
// Layout đã duyệt qua prototype với user (xem docs/exchanges/2026-09-15.md mục 5): Project → PIC → Task,
// 2 vùng (Tiến độ đến hết tuần trước + Status + Note / Mục tiêu tuần này + Note), merge dọc Project/PIC,
// KHÔNG merge cột nội dung, ô không có mục = "-" căn giữa 2 chiều, nền trắng, mọi dòng cao bằng nhau.
//
// Tách riêng khỏi weekly-report.ts (đã dài) theo tinh thần tách module CR-20260912-tach-module. Không phụ
// thuộc dữ liệu Risk (đó là dữ liệu của POST /weeks/:weekStart/dm-report, không liên quan file này).
import ExcelJS from 'exceljs';
import type { WeekData, GoalView } from './weekly-report.js';
import { ddmm, slashDate, addDays } from './weekly-report.js';

const HEADERS = ['Project', 'PIC', 'Tiến độ đến hết tuần trước', 'Status', 'Note', 'Mục tiêu tuần này', 'Note'];
const COL_WIDTHS = [20, 12, 42, 16, 26, 42, 26];
const COL_COUNT = HEADERS.length;
const HEADER_ROW = 2;
const DATA_START_ROW = 3;

const ARGB = {
  titleBg: 'FF1F3A5B',
  headerBg: 'FF21388C',
  white: 'FFFFFFFF',
  okBg: 'FFC6EFCE', okFg: 'FF006100',
  badBg: 'FFFFC7CE', badFg: 'FF9C0006',
  dashFg: 'FF808080',
  border: 'FFBFBFBF',
};

// FR-8: "viền mảnh xám toàn bảng" — áp cho CẢ title/header, không chỉ vùng dữ liệu.
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: ARGB.border } },
  left: { style: 'thin', color: { argb: ARGB.border } },
  bottom: { style: 'thin', color: { argb: ARGB.border } },
  right: { style: 'thin', color: { argb: ARGB.border } },
};

// Cùng luật tách người phụ trách với memberSection() trong weekly-report.ts (assignee dạng "A, B" ->
// nhân theo từng người); rỗng -> nhóm vào '(Chưa gán)' giống hệt convention đã có.
function splitAssignees(assignee: string): string[] {
  const members = assignee ? assignee.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return members.length > 0 ? members : ['(Chưa gán)'];
}

export interface DmReportRow {
  project: string;
  pic: string;
  lastWeekText: string;
  lastWeekStatus: string; // 'Hoàn thành' | 'Không hoàn thành' | '-'
  lastWeekNote: string;
  thisWeekText: string;
  thisWeekNote: string;
  projectMergeSpan?: number; // chỉ set ở dòng đầu của mỗi project
  picMergeSpan?: number;     // chỉ set ở dòng đầu của mỗi PIC
}

// Suy hàng dữ liệu Project -> PIC -> Task từ WeekData có sẵn (buildWeekData). Không đụng dữ liệu Risk.
export function buildDmReportRows(data: WeekData): DmReportRow[] {
  const rows: DmReportRow[] = [];

  for (const grp of data.groups) {
    if (grp.goals.length === 0 && grp.lastWeekGoals.length === 0) continue;

    const byPic = new Map<string, { lastWeek: GoalView[]; thisWeek: GoalView[] }>();
    const bucket = (pic: string) => {
      if (!byPic.has(pic)) byPic.set(pic, { lastWeek: [], thisWeek: [] });
      return byPic.get(pic)!;
    };
    grp.lastWeekGoals.forEach((g) => splitAssignees(g.assignee).forEach((pic) => bucket(pic).lastWeek.push(g)));
    grp.goals.forEach((g) => splitAssignees(g.assignee).forEach((pic) => bucket(pic).thisWeek.push(g)));

    const pics = [...byPic.keys()].sort((a, b) =>
      a === '(Chưa gán)' ? 1 : b === '(Chưa gán)' ? -1 : a.localeCompare(b, 'vi'));

    const projectStart = rows.length;
    for (const pic of pics) {
      const b = byPic.get(pic)!;
      const n = Math.max(b.lastWeek.length, b.thisWeek.length, 1);
      const picStart = rows.length;
      for (let i = 0; i < n; i++) {
        const lw = b.lastWeek[i];
        const tw = b.thisWeek[i];
        rows.push({
          project: grp.name,
          pic,
          lastWeekText: lw ? lw.text : '-',
          lastWeekStatus: lw ? (lw.status === 'khong_dat' ? 'Không hoàn thành' : 'Hoàn thành') : '-',
          // Note chỉ có khi Không hoàn thành (FR-5) — Hoàn thành/Vượt không kèm lý do.
          lastWeekNote: lw && lw.status === 'khong_dat' ? lw.note : '',
          thisWeekText: tw ? (tw.targetProgress != null ? `${tw.text} (→${tw.targetProgress}%)` : tw.text) : '-',
          // Chưa có nguồn dữ liệu note riêng cho mục tiêu tuần này (FR-6) — để trống, không tự chế.
          thisWeekNote: '',
        });
      }
      rows[picStart].picMergeSpan = n;
    }
    rows[projectStart].projectMergeSpan = rows.length - projectStart;
  }

  return rows;
}

// Ước lượng số dòng wrap cần cho 1 ô, dựa trên độ rộng cột (đơn vị Excel ~ số ký tự Calibri 11).
// KHÔNG có Excel thật trên server để auto-fit chính xác (khác với bản prototype dựng bằng Excel COM) —
// đây là ước lượng đủ dùng, làm tròn LÊN để tránh cắt chữ thật (thà dư khoảng trắng còn hơn mất nội dung.
function estimateLines(text: string, columnWidth: number): number {
  if (!text) return 1;
  const charsPerLine = Math.max(1, Math.floor(columnWidth));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

export function buildDmReportWorkbook(data: WeekData): ExcelJS.Workbook {
  const rows = buildDmReportRows(data);
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Bao cao tuan', { views: [{ state: 'frozen', ySplit: DATA_START_ROW - 1 }] });

  ws.properties.defaultRowHeight = 15;
  for (let c = 0; c < COL_COUNT; c++) ws.getColumn(c + 1).width = COL_WIDTHS[c];

  // Row 1: tiêu đề
  const title = `BÁO CÁO TUẦN ${ddmm(data.weekStart)} – ${slashDate(data.weekEnd)}  ·  Tuần trước: ${ddmm(data.prevWeekStart)} – ${ddmm(addDays(data.prevWeekStart, 6))}`;
  ws.mergeCells(1, 1, 1, COL_COUNT);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: ARGB.white } } as ExcelJS.Font;
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.titleBg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.border = THIN_BORDER;
  ws.getRow(1).height = 26;

  // Row 2: header
  HEADERS.forEach((label, i) => {
    const cell = ws.getCell(HEADER_ROW, i + 1);
    cell.value = label;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } } as ExcelJS.Font;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.headerBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });
  ws.getRow(HEADER_ROW).height = 24;
  ws.autoFilter = `A${HEADER_ROW}:G${HEADER_ROW}`;

  // Data rows
  rows.forEach((row, i) => {
    const r = DATA_START_ROW + i;
    const values = [row.project, row.pic, row.lastWeekText, row.lastWeekStatus, row.lastWeekNote, row.thisWeekText, row.thisWeekNote];
    values.forEach((v, c) => { ws.getCell(r, c + 1).value = v; });
  });
  const lastRow = DATA_START_ROW + rows.length - 1;

  if (rows.length > 0) {
    // Wrap + top-align + viền mảnh cho toàn bảng dữ liệu.
    for (let r = DATA_START_ROW; r <= lastRow; r++) {
      for (let c = 1; c <= COL_COUNT; c++) {
        const cell = ws.getCell(r, c);
        cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
        cell.font = { name: 'Calibri', size: 10.5 };
        cell.border = THIN_BORDER;
      }
    }

    // Merge Project (A) / PIC (B) theo span đã tính; căn giữa cả 2 chiều cho 2 cột này.
    let r = DATA_START_ROW;
    for (const row of rows) {
      if (row.projectMergeSpan) {
        const span = row.projectMergeSpan;
        if (span > 1) ws.mergeCells(r, 1, r + span - 1, 1);
        const cell = ws.getCell(r, 1);
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.font = { name: 'Calibri', size: 10.5, bold: true };
      }
      if (row.picMergeSpan) {
        const span = row.picMergeSpan;
        if (span > 1) ws.mergeCells(r, 2, r + span - 1, 2);
        const cell = ws.getCell(r, 2);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
      r++;
    }

    // Ô "-" (không có mục ở vùng đó) -> căn giữa 2 chiều, chữ xám nhạt, KHÔNG tô nền (đã chốt bỏ tô màu).
    // Status -> tô màu theo giá trị (Hoàn thành/Không hoàn thành/-).
    rows.forEach((row, i) => {
      const rr = DATA_START_ROW + i;
      if (row.lastWeekText === '-') {
        const cell = ws.getCell(rr, 3);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 10.5, color: { argb: ARGB.dashFg } };
      }
      if (row.thisWeekText === '-') {
        const cell = ws.getCell(rr, 6);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 10.5, color: { argb: ARGB.dashFg } };
      }
      const statusCell = ws.getCell(rr, 4);
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (row.lastWeekStatus === 'Hoàn thành') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.okBg } };
        statusCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: ARGB.okFg } };
      } else if (row.lastWeekStatus === 'Không hoàn thành') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.badBg } };
        statusCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: ARGB.badFg } };
      } else {
        statusCell.font = { name: 'Calibri', size: 10.5, color: { argb: ARGB.dashFg } };
      }
    });

    // Chiều cao dòng ĐỀU NHAU: ước lượng số dòng wrap cần cho mỗi ô (xem estimateLines — không có Excel
    // thật trên server để auto-fit chính xác như bản prototype), lấy MAX rồi áp cho MỌI dòng dữ liệu.
    let maxLines = 1;
    rows.forEach((row) => {
      const candidates = [
        estimateLines(row.project, COL_WIDTHS[0]),
        estimateLines(row.pic, COL_WIDTHS[1]),
        estimateLines(row.lastWeekText, COL_WIDTHS[2]),
        estimateLines(row.lastWeekNote, COL_WIDTHS[4]),
        estimateLines(row.thisWeekText, COL_WIDTHS[5]),
        estimateLines(row.thisWeekNote, COL_WIDTHS[6]),
      ];
      maxLines = Math.max(maxLines, ...candidates);
    });
    const uniformHeight = Math.max(20, maxLines * 14 + 6);
    for (let rr = DATA_START_ROW; rr <= lastRow; rr++) ws.getRow(rr).height = uniformHeight;
  }

  return workbook;
}
