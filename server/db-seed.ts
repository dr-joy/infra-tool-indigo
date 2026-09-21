import type { DatabaseSync } from 'node:sqlite';

// Seed data lịch sử, tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — giữ NGUYÊN VĂN nội dung và thứ tự, không import ngược singleton
// `db` từ server/db.ts (nhận `db` làm tham số, giống mọi hàm apply*Schema).
export function runSeed(db: DatabaseSync): void {
  const defaultReleaseTemplates = [
    {
      id: 'rd',
      name: 'Toàn 研究開発部',
      content: `皆様
お疲れ様です。

定期リリース実施のお知らせです。

■ステージング環境への反映の予定日時：
{{staging.monday}}15:00～18:00（JST）

■本番環境のリリースの予定日時：
{{release.date}}15:00～18:00（JST）

■デモ環境のへの反映の予定日時：
{{demo.monday}}18:00～19:00（JST）

■影響範囲：
Dr.JOY／Pr.JOY
本リリースによるシステム停止は発生いたしません。

お手数ですが、ご確認のほどよろしくお願いいたします。`
    },
    {
      id: 'pm_vn',
      name: 'PM phía Việt Nam',
      content: `@mọi người

[Thông báo Release định kỳ ngày {{release.date}}]

Nhờ các team kiểm tra và thực hiện các nội dung sau:

2. Cập nhật thông tin liên quan:

Deadline: 09:00 - {{jack.friday}}
Nội dung: Điền thông tin vào file release schedule

3. File Release:

File: Link
Deadline cập nhật: 12:00 - {{develop.thursday}}

4. Họp confirm Schedule:

VN: Dự kiến {{develop.thursday}} (16:30 – 17:30)
JP: Dự kiến {{develop.friday}} (09:15 – 10:00)

Lưu ý:
Vui lòng tham gia đầy đủ. Chỉ từ chối khi có lý do đặc biệt và cần thông báo trước.

Nhờ mọi người kiểm tra và thực hiện đúng hạn.
Xin cảm ơn.`
    },
    {
      id: 'all_vn',
      name: 'Toàn bộ phía Việt Nam',
      content: `@mọi người

[Thông báo Release định kỳ]

Giờ merge + deploy dự kiến môi trường Staging:
13:00 – 15:00, Thứ Hai ({{staging.monday}}) – giờ VN

Giờ Deploy + release dự kiến môi trường Master (release):
13:00 – 16:00, Thứ Sáu ({{release.date}}) – giờ VN

Giờ deploy dự kiến môi trường Demo:
16:00 – 17:00, Thứ Hai ({{demo.monday}}) – giờ VN

File Release Schedule:
Link

Nhờ mọi người kiểm tra và theo dõi.
Xin cảm ơn.`
    }
  ];

  const defaultReleaseTaskDefinitions = [
    ['create-ticket', 'Tạo ticket cho web/mobile cho release định kỳ', 'demo.wednesday', '10:00', '', '<a href="https://redmine.famishare.jp/projects/drjoy_vn/versions/new">https://redmine.famishare.jp/projects/drjoy_vn/versions/new</a>\n<a href="https://docs.google.com/spreadsheets/d/18lSA-Ad1P0QDApBaoW3zK6L8KuoUE8PHVAH64aHaJ_g/edit?gid=2005030498#gid=2005030498&range=A1">https://docs.google.com/spreadsheets/d/18lSA-Ad1P0QDApBaoW3zK6L8KuoUE8PHVAH64aHaJ_g/edit?gid=2005030498#gid=2005030498&range=A1</a>'],
    ['create-release-schedule', 'Tạo file release schedule', 'demo.wednesday', '10:15', '', '<a href="https://drive.google.com/drive/folders/15deyuUu6NVpRcemVG37a_8rperzXiDxg">https://drive.google.com/drive/folders/15deyuUu6NVpRcemVG37a_8rperzXiDxg</a>'],
    ['notify-pm', 'Đăng thông báo release định kỳ và remaind cho các PM', 'jack.monday', '10:00', 'pm_vn', ''],
    ['book-meeting', 'Book mtg release định kỳ với 2 phía JP và VN', 'develop.monday', '10:00', '', ''],
    ['lock-schedule-file', 'Báo lock file release schedule và check nội dung file', 'develop.thursday', '13:00', '', ''],
    ['notify-rd-schedule', 'Thông báo lịch release trên kênh 研究開発部', 'develop.friday', '10:00', 'rd', ''],
    ['notify-vn-schedule', 'Thông báo lịch release trên VN_Dev', 'develop.friday', '10:15', 'all_vn', ''],
    ['staging-start-rd', 'Thông báo bắt đầu deploy môi trường staging trên kênh 研究開発部', 'staging.monday', '13:00', '', ''],
    ['staging-end-rd', 'Thông báo kết thúc deploy môi trường staging trên kênh 研究開発部', 'staging.monday', '16:00', '', ''],
    ['verify-staging-schedule', 'Verify release schedule file', 'staging.monday', '16:15', '', ''],
    ['release-rd', 'Thông báo release trên kênh 研究開発部', 'release.date', '13:00', '', ''],
    ['release-vn', 'Thông báo release trên kênh Dev_VN', 'release.date', '13:15', '', ''],
    ['release-end', 'Check tình hình test của các team và thông báo kết thúc release trên 2 kênh 研究開発部 và VN_dev', 'release.date', '16:00', '', ''],
    ['verify-release-schedule', 'Verify file release schedule', 'release.date', '16:15', '', ''],
    ['confirm-demo', 'Confirm tình hình chuẩn bị deploy môi trường demo với member', 'demo.monday', '14:00', '', ''],
    ['demo-rd', 'Thông báo deploy môi trường demo trên kênh 研究開発部', 'demo.monday', '16:00', '', ''],
    ['demo-vn', 'Thông báo deploy môi trường demo trên kênh Dev_VN', 'demo.monday', '16:15', '', ''],
    ['demo-end-vn', 'Thông báo kết thúc deploy môi trường demo và báo các team test', 'demo.monday', '16:45', '', ''],
    ['demo-end-rd', 'Thông báo deploy môi trường demo kết thúc  trên kênh 研究開発部', 'demo.monday', '17:00', '', ''],
    ['verify-demo-schedule', 'verify file release schedule', 'demo.tuesday', '10:00', '', ''],
    ['lock-api-monitoring', 'Khóa file monitoring API, list các team chưa điền', 'demo.monday', '09:00', '', '<a href="https://docs.google.com/spreadsheets/d/1BdrS348f0J-4NMjQ5RFAnmTEL_OdWXCivyiUU6_boYA/edit?gid=208881862#gid=208881862&range=A1">https://docs.google.com/spreadsheets/d/1BdrS348f0J-4NMjQ5RFAnmTEL_OdWXCivyiUU6_boYA/edit?gid=208881862#gid=208881862&range=A1</a>'],
    ['ask-api-latency-data', 'Nhắc thầy Phú lấy data cho file Theo dõi API latency', 'demo.monday', '09:30', '', ''],
    ['confirm-api-latency-data', 'Confirm kết quả lấy data cho file Theo dõi API latency', 'demo.tuesday', '13:00', '', ''],
    ['ask-monitoring-result', 'Nhắc thầy Phú lấy kết quả monitoring', 'demo.friday', '09:00', '', '<a href="https://docs.google.com/spreadsheets/d/13kWR4vqVDvlQWo1XZ_ZFL2iLJn382LTDep07PWt0gIU/edit?gid=549760443">https://docs.google.com/spreadsheets/d/13kWR4vqVDvlQWo1XZ_ZFL2iLJn382LTDep07PWt0gIU/edit?gid=549760443</a>'],
    ['confirm-monitoring-result', 'Confirm tình hình lấy kết quả monitoring của thầy Phú', 'demo.friday', '14:00', '', ''],
    ['lock-monitoring-files', 'Khóa file kết quả monitoring và API latency', 'afterDemo.monday', '09:00', '', '<a href="https://docs.google.com/spreadsheets/d/13kWR4vqVDvlQWo1XZ_ZFL2iLJn382LTDep07PWt0gIU/edit?gid=549760443#gid=549760443&range=A1">https://docs.google.com/spreadsheets/d/13kWR4vqVDvlQWo1XZ_ZFL2iLJn382LTDep07PWt0gIU/edit?gid=549760443#gid=549760443&range=A1</a>\n<a href="https://docs.google.com/spreadsheets/d/1BdrS348f0J-4NMjQ5RFAnmTEL_OdWXCivyiUU6_boYA/edit?gid=208881862#gid=208881862&range=1:1">https://docs.google.com/spreadsheets/d/1BdrS348f0J-4NMjQ5RFAnmTEL_OdWXCivyiUU6_boYA/edit?gid=208881862#gid=208881862&range=1:1</a>'],
    ['summary-monitoring', 'Tổng hợp các team chưa hoàn thành Task monitoring', 'afterDemo.monday', '10:00', '', '']
  ];

  const defaultEmergencyFixedTaskDefinitions = [
    ['emergency-staging-merge-confirm', 'Confirm tình hình merge stg', 'staging_deploy', -60, '', ''],
    ['emergency-staging-start-rd', 'Thông báo bắt đầu deploy stg trên kênh 研究開発部', 'staging_deploy', 0, 'rd', ''],
    ['emergency-staging-start-vn', 'Thông báo bắt đầu deploy stg trên kênh Dev_VN', 'staging_deploy', 15, 'all_vn', ''],
    ['emergency-staging-test-confirm', 'Confirm tình hình test', 'staging_deploy', 120, '', ''],
    ['emergency-staging-end-rd', 'Thông báo kết thúc deploy stg trên kênh 研究開発部', 'staging_deploy', 150, 'rd', ''],
    ['emergency-staging-end-vn', 'Thông báo kết thúc deploy stg trên kênh VN_Dev', 'staging_deploy', 165, 'all_vn', ''],
    ['emergency-release-start-rd', 'Thông báo bắt đầu release trên kênh 研究開発部', 'release_deploy', 0, 'rd', ''],
    ['emergency-release-start-vn', 'Thông báo bắt đầu release trên kênh VN_Dev', 'release_deploy', 15, 'all_vn', ''],
    ['emergency-release-test-confirm', 'Confirm tình hình test của các team', 'release_deploy', 120, '', ''],
    ['emergency-release-end-rd', 'Thông báo kết thúc release trên kênh 研究開発部', 'release_deploy', 150, 'rd', ''],
    ['emergency-release-end-vn', 'Thông báo kết thúc release trên kênh VN_Dev', 'release_deploy', 165, 'all_vn', ''],
    ['emergency-demo-start-rd', 'Thông báo bắt đầu deploy demo trên kênh 研究開発部', 'demo_deploy', 0, 'rd', ''],
    ['emergency-demo-start-vn', 'Thông báo bắt đầu deploy demo trên kênh VN_Dev', 'demo_deploy', 15, 'all_vn', ''],
    ['emergency-demo-end-rd', 'Thông báo kết thúc deploy demo trên kênh 研究開発部', 'demo_deploy', 90, 'rd', ''],
    ['emergency-demo-end-vn', 'Thông báo kết thúc deploy demo trên kênh VN_Dev', 'demo_deploy', 105, 'all_vn', '']
  ];

  const demTemplate = db.prepare('SELECT COUNT(*) AS total FROM release_templates').get() as { total: number };
  if (demTemplate.total === 0) {
    const now = new Date().toISOString();
    const insertTemplate = db.prepare('INSERT INTO release_templates (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    defaultReleaseTemplates.forEach((t) => insertTemplate.run(t.id, t.name, t.content, now, now));
  }

  const demReleaseTaskDefinition = db.prepare('SELECT COUNT(*) AS total FROM release_task_definitions').get() as { total: number };
  if (demReleaseTaskDefinition.total === 0) {
    const insertDefinition = db.prepare('INSERT INTO release_task_definitions (id, title, date_token, start_time, template_id, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
    defaultReleaseTaskDefinitions.forEach((d, index) => insertDefinition.run(...d, index));
  }

  const insertEmergencyFixedDefinition = db.prepare(`
    INSERT OR IGNORE INTO emergency_release_task_definitions (
      id, title, note, task_date, start_time, immediate_priority, relative_offset_minutes, schedule_mode, template_id, task_links, sort_order
    )
    VALUES (?, ?, ?, ?, 'relative', NULL, ?, 'custom', ?, '[]', ?)
  `);
  defaultEmergencyFixedTaskDefinitions.forEach((d, index) => {
    insertEmergencyFixedDefinition.run(String(d[0]), String(d[1]), String(d[5] || ''), String(d[2]), Number(d[3]), String(d[4] || '') || null, 100 + index);
  });

  const updateEmergencyFixedDefinitionTitle = db.prepare('UPDATE emergency_release_task_definitions SET title = ? WHERE id = ?');
  defaultEmergencyFixedTaskDefinitions.forEach((d) => updateEmergencyFixedDefinitionTitle.run(String(d[1]), String(d[0])));

  db.exec(`
    UPDATE emergency_release_task_definitions
    SET immediate_priority = COALESCE(immediate_priority, 1),
        schedule_mode = COALESCE(schedule_mode, 'after_schedule')
    WHERE task_date = 'release_deploy'
      AND COALESCE(relative_offset_minutes, 0) = 0
      AND id NOT LIKE 'emergency-release-%'
  `);
  db.exec(`
    UPDATE emergency_release_task_definitions
    SET schedule_mode = COALESCE(schedule_mode, 'custom')
    WHERE task_date IN ('staging_deploy', 'release_deploy', 'demo_deploy')
      AND COALESCE(schedule_mode, '') = ''
  `);

  // Project hệ thống "Khác" (không thể xóa) — chứa các mục tiêu/việc lẻ ngoài project.
  const demSystemProject = db.prepare('SELECT COUNT(*) AS total FROM projects WHERE is_system = 1').get() as { total: number };
  if (demSystemProject.total === 0) {
    const now = new Date().toISOString();
    const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM projects').get() as { n: number }).n;
    db.prepare('INSERT INTO projects (ten_project, pic, ngay_bat_dau, sort_order, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run('Khác', '', now.slice(0, 10), next, now, now);
  }

  // Sửa tên project hệ thống nếu bị hỏng mã hoá (lần seed cũ lưu nhầm "Kh�c")
  db.prepare("UPDATE projects SET ten_project = 'Khác' WHERE is_system = 1 AND ten_project <> 'Khác'").run();

  // Seed PIC mặc định (danh sách hard-code cũ) khi bảng còn trống
  const demPic = db.prepare('SELECT COUNT(*) AS total FROM pics').get() as { total: number };
  if (demPic.total === 0) {
    const now = new Date().toISOString();
    const insertPic = db.prepare('INSERT INTO pics (name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?)');
    ['Định', 'Cường', 'Phú', 'Nam', 'Hoàng'].forEach((name, index) => insertPic.run(name, index + 1, now, now));
  }

  const demTask = db.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: number };
  if (demTask.total === 0) {
    const seed = db.prepare(`
      INSERT INTO tasks (
        ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
        lap_lai_kieu, ngay_trong_thang, thu_trong_tuan
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const today = new Date();
    const iso = (daysAgo: number) => { const d = new Date(today); d.setDate(today.getDate() - daysAgo); return d.toISOString(); };
    const thuHomNay = today.getDay();
    const ngayHomNay = today.getDate();
    [
      ['Rà soát backlog cá nhân', 'Chốt 3 việc quan trọng nhất tuần này', 'don_le', 1, 'chua_thuc_hien', iso(3), null, null, null, null, null],
      ['Viết proposal automation', 'Gửi bản nháp trước 16h', 'don_le', 2, 'chua_thuc_hien', iso(2), null, null, null, null, null],
      ['Thanh toán hóa đơn cloud', 'Kiểm tra email invoice', 'don_le', 3, 'dang_tien_hanh', iso(1), null, null, null, null, null],
      ['Daily planning', 'Cập nhật mục tiêu trong ngày', 'dinh_ky', null, 'chua_thuc_hien', iso(8), '08:30', '08:45', 'hang_ngay', null, null],
      ['Review tài chính tuần', 'Nhìn lại chi phí và saving', 'dinh_ky', null, 'chua_thuc_hien', iso(6), '10:15', '11:00', 'hang_tuan', null, thuHomNay],
      ['Báo cáo cá nhân tháng', 'Chuẩn bị summary cho tháng', 'dinh_ky', null, 'chua_thuc_hien', iso(10), '15:45', '16:30', 'hang_thang', ngayHomNay, null]
    ].forEach((row) => seed.run(...row));
  }
}
