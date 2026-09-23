// Luật năng lực (tầng 3, FR-8) — object literal cố định trong code, KHÔNG lưu DB. Đây là "MỘT nguồn sự
// thật" cho hàm authorize() (server/lib/authorize.ts) tra `AUTHORIZATION_POLICY[resource][action]`.
//
// `feature` khai báo NGAY TẠI ĐÂY cho từng resource (không phải route/caller tự truyền `null` mỗi lần
// gọi) — quyết định chốt qua Council `f0a0e1bb` (21/09, xem docs/exchanges/2026-09-21.md): route mới
// quên khai `feature` sẽ bị TypeScript báo thiếu field (fail-closed ở compile-time), khác với việc tin
// route tự nhớ truyền `null` đúng chỗ (dễ quên, phá fail-closed âm thầm).
//
// `roles` có 2 miền giá trị khác nhau tuỳ route có `scope.teamId` cụ thể hay không (xem authorize.ts):
// - Có `scope.teamId` (route theo team, vd `team_member.*`): roles là vai trò TRONG TEAM (`leader`|`member`).
// - Không có `scope.teamId` (route toàn cục, vd `team.*`, `user_account.*`): roles là `system_role`
//   (`user`|`admin`) — đa số chỉ có `admin`.
export type FeatureKey = 'personal_task' | 'project' | 'weekly_report' | 'release' | 'mind_map';

export interface PolicyEntry {
  feature: FeatureKey | null;
  roles: readonly string[];
}

export const AUTHORIZATION_POLICY: Record<string, Record<string, PolicyEntry>> = {
  // Lát 2 (đã có route, refactor sang authorize() ở Lát 3) — toàn cục, không gắn 1 team.
  join_request: {
    list: { feature: null, roles: ['admin'] },
    approve: { feature: null, roles: ['admin'] },
    reject: { feature: null, roles: ['admin'] }
  },
  user_account: {
    list: { feature: null, roles: ['admin'] },
    disable: { feature: null, roles: ['admin'] },
    enable: { feature: null, roles: ['admin'] },
    revoke_sessions: { feature: null, roles: ['admin'] }
  },

  // Lát 3 mới — toàn cục (Admin quản trị team/cấu hình hệ thống).
  team: {
    list: { feature: null, roles: ['admin'] },
    create: { feature: null, roles: ['admin'] },
    update: { feature: null, roles: ['admin'] },
    change_leader: { feature: null, roles: ['admin'] }
  },
  feature_visibility: {
    read: { feature: null, roles: ['admin'] },
    update: { feature: null, roles: ['admin'] }
  },
  // Tên resource CỐ Ý khác 'release_coordinator' (tên đó dành riêng cho bước 4 của policyKind
  // 'team_feature' trong authorize.ts — kiểm actor là Leader hiệu lực của team điều phối, dùng ở Lát 6
  // cho các route điều phối liên team; xem CR §6.2). Route Admin CẤU HÌNH ai là team điều phối không
  // cần actor bản thân là Leader của team đó, nên phải dùng resource riêng để không vô tình kích hoạt
  // nhánh kiểm tra đó.
  release_coordinator_config: {
    read: { feature: null, roles: ['admin'] },
    update: { feature: null, roles: ['admin'] }
  },

  // Lát 3 mới — có scope.teamId thật, roles là vai trò TRONG TEAM (không phải system_role).
  team_member: {
    list: { feature: null, roles: ['leader', 'member'] },
    list_own: { feature: null, roles: ['user', 'admin'] }, // không có scope.teamId — mọi actor đã đăng nhập
    create: { feature: null, roles: ['leader'] },
    delete: { feature: null, roles: ['leader'] }
  },

  // Lát 4 mới — Project & Gantt (CR §3.1/AC-7/AC-8, docs/exchanges/2026-09-13.md mục 3.1). "Sửa task
  // mình được gán phụ trách" cho Member không tách được thành role-list đơn giản (phụ thuộc TỪNG bản
  // ghi) — route tự kiểm thêm sau khi authorize() cho qua theo bảng dưới (xem comment ở projects.ts).
  project: {
    list: { feature: 'project', roles: ['leader', 'member'] },
    create: { feature: 'project', roles: ['leader'] },
    update: { feature: 'project', roles: ['leader'] },
    delete: { feature: 'project', roles: ['leader'] },
    close: { feature: 'project', roles: ['leader'] },
    reorder: { feature: 'project', roles: ['leader'] }
  },
  project_task: {
    list: { feature: 'project', roles: ['leader', 'member'] },
    create: { feature: 'project', roles: ['leader', 'member'] },
    update: { feature: 'project', roles: ['leader', 'member'] }, // Member: route tự kiểm chỉ task được gán
    delete: { feature: 'project', roles: ['leader'] },
    reorder: { feature: 'project', roles: ['leader', 'member'] },
    execution_order: { feature: 'project', roles: ['leader'] } // "kéo đổi thứ tự thực thi Gantt" — Leader-only
  },
  project_task_assignment: {
    // Cả Leader lẫn Member đều gán được người phụ trách (Leader gán bất kỳ ai, Member tự nhận/tự rút
    // việc của chính mình) — route tự so diff mảng cũ/mới để chặn Member đụng dòng người khác.
    update: { feature: 'project', roles: ['leader', 'member'] }
  },

  // Lát 4 mới — Báo cáo tuần (CR §3.2/FR-21, sửa 13/09: KHÔNG có luồng Member tự đặt mục tiêu — Member
  // chỉ xem, mọi thao tác ghi/xoá thuộc Leader).
  weekly_goal: {
    list: { feature: 'weekly_report', roles: ['leader', 'member'] },
    delete_one: { feature: 'weekly_report', roles: ['leader'] },
    delete_all: { feature: 'weekly_report', roles: ['leader'] }
  },
  weekly_report: {
    badges: { feature: 'weekly_report', roles: ['leader', 'member'] }, // goal-badge-ids/at-risk-ids/goal-task-ids/report-kinds
    plan: { feature: 'weekly_report', roles: ['leader'] },
    apply: { feature: 'weekly_report', roles: ['leader'] }, // chốt tuần (wizard "Xác nhận & lưu")
    render: { feature: 'weekly_report', roles: ['leader', 'member'] }, // text/dm-report/xlsx — chỉ đọc/xuất, không ghi DB
    history_list: { feature: 'weekly_report', roles: ['leader', 'member'] },
    history_create: { feature: 'weekly_report', roles: ['leader'] }, // phê duyệt/finalize báo cáo
    history_delete: { feature: 'weekly_report', roles: ['leader'] }
  },

  // Lát 4 mới (Council review run e6cd1c8c, 22/09 — lỗ hổng thật: 5 route pics.ts không hề qua authorize()
  // trước bản sửa này). PIC đã chuyển hẳn thành dữ liệu lịch sử chỉ-đọc (CR §6.3, không còn là nguồn chọn
  // người) — không gắn với feature bật/tắt nào trong 5 feature ở trên nên `feature: null`, giống
  // `team_member`. GET cho Leader+Member xem đúng team mình; POST/PATCH/PATCH reorder/DELETE giới hạn
  // Leader-only — GIẢ ĐỊNH cần Leader xác nhận lại (xem comment đầu server/routes/pics.ts).
  pic: {
    list: { feature: null, roles: ['leader', 'member'] },
    create: { feature: null, roles: ['leader'] },
    update: { feature: null, roles: ['leader'] },
    reorder: { feature: null, roles: ['leader'] },
    delete: { feature: null, roles: ['leader'] }
  },

  // Lát 5 (FR-14/FR-31) — Task cá nhân. `roles` KHÔNG dùng ở policyKind 'personal_task' (authorize.ts
  // chỉ đọc `feature` của policy này + tự so `scope.ownerId === actor.userId`), để mảng rỗng cho rõ.
  personal_task: {
    own: { feature: 'personal_task', roles: [] }
  },

  // Lát 5 (FR-32) — Mind Map: "chỉ chủ sở hữu mới sửa" dùng lại NGUYÊN khuôn ownerId của
  // policyKind 'personal_task' (feature 'mind_map' thay vì 'personal_task'); "đang thuộc ≥1 team Bật
  // Mind Map" (gate trước khi route tự lọc private/shared theo từng dòng) dùng khuôn
  // 'cross_team_release'. `roles` không dùng ở cả 2 policyKind này, để mảng rỗng cho rõ — route
  // server/routes/mindmaps.ts tự kiểm thêm quyền theo TỪNG BẢN GHI (owner/visibility/shared_team_id)
  // sau khi authorize() cho qua bước gate chung, đúng khuôn "route tự kiểm thêm" đã dùng ở
  // project_task cho Member.
  mind_map: {
    browse: { feature: 'mind_map', roles: [] },
    create: { feature: 'mind_map', roles: [] },
    update: { feature: 'mind_map', roles: [] },
    delete: { feature: 'mind_map', roles: [] },
    upload_attachment: { feature: 'mind_map', roles: [] },
    delete_attachment: { feature: 'mind_map', roles: [] }
  },

  // Lát 5 (FR-33) — Redmine. Khoá cá nhân: toàn cục, mọi actor đã đăng nhập tự quản lý CỦA MÌNH
  // (route tự ép `scope.ownerId = actor.userId` khi đọc/ghi, giống 'team_member'.'list_own'). URL hệ
  // thống: toàn cục, chỉ Admin.
  redmine_config: {
    read_self: { feature: null, roles: ['user', 'admin'] },
    write_self: { feature: null, roles: ['user', 'admin'] },
    delete_self_key: { feature: null, roles: ['user', 'admin'] },
    test_self: { feature: null, roles: ['user', 'admin'] },
    read_admin_url: { feature: null, roles: ['admin'] },
    write_admin_url: { feature: null, roles: ['admin'] }
  },

  // Lát 5 (FR-22) — cấu hình loại báo cáo tuần theo team + Risk theo team/tuần/loại/project.
  weekly_report_kind: {
    list: { feature: 'weekly_report', roles: ['leader', 'member'] },
    create: { feature: 'weekly_report', roles: ['leader'] },
    update: { feature: 'weekly_report', roles: ['leader'] }
  },
  weekly_project_risk: {
    list: { feature: 'weekly_report', roles: ['leader', 'member'] },
    upsert: { feature: 'weekly_report', roles: ['leader'] }
  },

  // Khai báo TRƯỚC cho Lát 6 (FR-24, CR §6.2: `GET /api/release/schedule-board`) — CHƯA có route nào
  // gọi (đúng policyKind 'cross_team_release', `roles` không dùng ở policyKind này). Khai sớm đúng
  // TÊN RESOURCE thật CR đã chốt, không phải đoán — giữ ý nghĩa cho test/unit/authorize.test.ts (viết
  // từ trước Lát 5) tiếp tục kiểm đúng kịch bản "gate theo feature 'release'", không đổi sang feature
  // khác chỉ vì cần một entry hợp lệ.
  release_schedule: {
    read: { feature: 'release', roles: [] }
  }

  // 'audit_log'.'read' KHÔNG khai ở đây — policyKind: 'audit' có luật riêng hẳn (Admin luôn qua, global,
  // projection metadata; Leader/Member chỉ qua khi scope.teamId là đúng team mình, projection chi tiết
  // đầy đủ — FR-11a, sửa 19/09 lần 14 thêm Member). Đây không phải lookup role-list đơn giản như
  // team_feature nên xử lý trực tiếp trong authorize.ts, không ép vào bảng này.
};
