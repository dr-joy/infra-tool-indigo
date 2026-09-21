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
  }

  // 'audit_log'.'read' KHÔNG khai ở đây — policyKind: 'audit' có luật riêng hẳn (Admin luôn qua, global,
  // projection metadata; Leader/Member chỉ qua khi scope.teamId là đúng team mình, projection chi tiết
  // đầy đủ — FR-11a, sửa 19/09 lần 14 thêm Member). Đây không phải lookup role-list đơn giản như
  // team_feature nên xử lý trực tiếp trong authorize.ts, không ép vào bảng này.
};
