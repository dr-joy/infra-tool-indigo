import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Luyện đề thi (Exam Practice). Tách khỏi server/db.ts (kế hoạch Council
// run 022dd1e5, xem docs/exchanges/2026-09-12.md) — nội dung SQL và các ALTER/seed nội bộ đi
// kèm ngay sau khi tạo bảng (thêm cột cho DB cũ, seed category từ dữ liệu đang dùng) giữ nguyên
// văn, đúng thứ tự khóa ngoại: de_thi_ky_thi ← de_thi_bo ← de_thi_cau_hoi ← de_thi_dap_an,
// de_thi_bo ← de_thi_phien ← de_thi_tra_loi. Bảy bảng: de_thi_ky_thi, de_thi_bo, de_thi_cau_hoi,
// de_thi_dap_an, de_thi_phien, de_thi_tra_loi, de_thi_category.
//
// Ngân hàng đề gom về một chỗ. Mỗi câu hỏi lưu song ngữ (Anh gốc + Việt dịch sẵn),
// đáp án đúng đánh dấu trực tiếp trên từng đáp án. Hỗ trợ MCQ chọn-1 và chọn-nhiều.
export function applyLuyenDeSchema(db: DatabaseSync): void {
  db.exec(`
    -- Kỳ thi / chứng chỉ: nhom = nhà cung cấp (AWS, Scrum...), ten = chứng chỉ (SAA-C03).
    CREATE TABLE IF NOT EXISTS de_thi_ky_thi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nhom TEXT NOT NULL DEFAULT '',
      ten TEXT NOT NULL,
      ghi_chu TEXT NOT NULL DEFAULT '',
      -- Cấu hình thi thử chuẩn của chứng chỉ (số câu + thời gian phút). NULL = chưa đặt.
      exam_so_cau INTEGER,
      exam_thoi_gian_phut INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS de_thi_bo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ky_thi_id INTEGER,
      ten TEXT NOT NULL,
      nguon TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      ghi_chu TEXT NOT NULL DEFAULT '',
      pass_percent INTEGER,
      duration_seconds INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS de_thi_cau_hoi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bo_id INTEGER NOT NULL REFERENCES de_thi_bo(id) ON DELETE CASCADE,
      -- single = chọn 1, multi = chọn nhiều
      loai TEXT NOT NULL DEFAULT 'single' CHECK (loai IN ('single', 'multi')),
      noi_dung_en TEXT NOT NULL,
      noi_dung_vi TEXT NOT NULL DEFAULT '',
      giai_thich_en TEXT NOT NULL DEFAULT '',
      giai_thich_vi TEXT NOT NULL DEFAULT '',
      chu_de TEXT NOT NULL DEFAULT '',
      do_kho TEXT NOT NULL DEFAULT '',
      -- 1 nếu bản dịch đã được sửa tay -> "Dịch lại" sẽ không ghi đè
      dich_thu_cong INTEGER NOT NULL DEFAULT 0,
      -- số lần câu đã được rút ra làm bài (dùng để rút công bằng, ưu tiên câu ít ra nhất)
      lan_ra INTEGER NOT NULL DEFAULT 0,
      -- lần gần nhất câu được rút; dùng để tránh lặp lại câu vừa gặp khi các câu có cùng lan_ra
      last_rut_at TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS de_thi_dap_an (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cau_hoi_id INTEGER NOT NULL REFERENCES de_thi_cau_hoi(id) ON DELETE CASCADE,
      noi_dung_en TEXT NOT NULL,
      noi_dung_vi TEXT NOT NULL DEFAULT '',
      la_dap_an_dung INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS de_thi_phien (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bo_id INTEGER REFERENCES de_thi_bo(id) ON DELETE SET NULL,
      che_do TEXT NOT NULL DEFAULT 'review',
      so_cau INTEGER NOT NULL DEFAULT 0,
      so_dung INTEGER NOT NULL DEFAULT 0,
      thoi_gian_giay INTEGER NOT NULL DEFAULT 0,
      cau_hinh_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS de_thi_tra_loi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phien_id INTEGER NOT NULL REFERENCES de_thi_phien(id) ON DELETE CASCADE,
      cau_hoi_id INTEGER NOT NULL,
      dap_an_chon_json TEXT NOT NULL DEFAULT '[]',
      dung_sai INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_de_thi_cau_hoi_bo ON de_thi_cau_hoi(bo_id);
    CREATE INDEX IF NOT EXISTS idx_de_thi_dap_an_cau ON de_thi_dap_an(cau_hoi_id);
    CREATE INDEX IF NOT EXISTS idx_de_thi_tra_loi_phien ON de_thi_tra_loi(phien_id);
  `);

  // Migration: thêm ky_thi_id cho DB đã tạo de_thi_bo trước khi có khái niệm kỳ thi.
  // Phải chạy TRƯỚC khi tạo index trên cột này (DB cũ chưa có cột).
  const deThiBoColumns = db.prepare('PRAGMA table_info(de_thi_bo)').all() as { name: string }[];
  if (!deThiBoColumns.some((c) => c.name === 'ky_thi_id')) {
    db.exec('ALTER TABLE de_thi_bo ADD COLUMN ky_thi_id INTEGER');
  }
  if (!deThiBoColumns.some((c) => c.name === 'file_name')) {
    db.exec("ALTER TABLE de_thi_bo ADD COLUMN file_name TEXT NOT NULL DEFAULT ''");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_de_thi_bo_ky_thi ON de_thi_bo(ky_thi_id)');

  // Migration: cấu hình thi thử chuẩn cho chứng chỉ (số câu + thời gian) trên DB đã tạo trước.
  const deThiKyThiColumns = db.prepare('PRAGMA table_info(de_thi_ky_thi)').all() as { name: string }[];
  if (deThiKyThiColumns.length > 0 && !deThiKyThiColumns.some((c) => c.name === 'exam_so_cau')) {
    db.exec('ALTER TABLE de_thi_ky_thi ADD COLUMN exam_so_cau INTEGER');
  }
  if (deThiKyThiColumns.length > 0 && !deThiKyThiColumns.some((c) => c.name === 'exam_thoi_gian_phut')) {
    db.exec('ALTER TABLE de_thi_ky_thi ADD COLUMN exam_thoi_gian_phut INTEGER');
  }

  // Migration: lan_ra = số lần câu hỏi đã được rút ra làm bài, để rút công bằng (ưu tiên câu ít ra nhất).
  const deThiCauHoiColumns = db.prepare('PRAGMA table_info(de_thi_cau_hoi)').all() as { name: string }[];
  if (deThiCauHoiColumns.length > 0 && !deThiCauHoiColumns.some((c) => c.name === 'lan_ra')) {
    db.exec('ALTER TABLE de_thi_cau_hoi ADD COLUMN lan_ra INTEGER NOT NULL DEFAULT 0');
  }
  if (deThiCauHoiColumns.length > 0 && !deThiCauHoiColumns.some((c) => c.name === 'last_rut_at')) {
    db.exec("ALTER TABLE de_thi_cau_hoi ADD COLUMN last_rut_at TEXT NOT NULL DEFAULT ''");
  }

  // Category đề luyện (nhóm/nhà cung cấp chứng chỉ) quản lý động — pick-list cho de_thi_ky_thi.nhom,
  // giống cách bảng pics là pick-list cho người phụ trách. Đổi tên category sẽ lan sang nhom đang dùng.
  db.exec(`
    CREATE TABLE IF NOT EXISTS de_thi_category (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Seed từ các nhóm đang dùng trong de_thi_ky_thi khi bảng còn trống, để không mất danh mục cũ.
  const demDeThiCategory = db.prepare('SELECT COUNT(*) AS total FROM de_thi_category').get() as { total: number };
  if (demDeThiCategory.total === 0) {
    const now = new Date().toISOString();
    const nhomDangDung = db.prepare("SELECT DISTINCT nhom FROM de_thi_ky_thi WHERE nhom IS NOT NULL AND nhom <> '' ORDER BY nhom ASC").all() as { nhom: string }[];
    const insertCategory = db.prepare('INSERT OR IGNORE INTO de_thi_category (name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?)');
    nhomDangDung.forEach((r, i) => insertCategory.run(r.nhom, i + 1, now, now));
  }
}
