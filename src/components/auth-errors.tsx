// Component lỗi dùng chung — CR-20260913 §6.1a "Component lỗi dùng chung, làm SỚM (không phải cuối)":
//   1. Popup "mất quyền" (FR-4a) — 2 trong 3 nhánh nội dung hiện ở ĐÂY dưới dạng popup (mất team /
//      đổi vai trò); nhánh thứ 3 (tài khoản bị khoá hẳn) KHÔNG hiện popup — CR nói rõ "đưa thẳng về
//      trạng thái không được phép truy cập của vỏ xác thực, không quay vòng login/logout", nên nhánh
//      đó được AuthProvider xử lý bằng cách chuyển `phase` sang 'disabled' (xem src/auth-context.tsx),
//      hiện màn riêng ở src/screens/auth-shell.tsx — không phải component này.
//   2. Component lỗi 409 dùng chung (FR-18/FR-46) — bắt buộc có nút tải lại dữ liệu mới, không chỉ toast.
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Modal } from './Modal';
import type { ApiError } from '../api';

// FR-4a: "hiện popup rõ ràng... không phải thông báo lỗi chung chung khiến người dùng tưởng app hỏng".
// Rủi ro dùng chung (§6.1a): phải phân biệt rõ 3 tình huống để người dùng biết nên hỏi Leader hay Admin.
function describePermissionLost(code: string | undefined): { title: string; message: string; contact: string } {
  if (code === 'NOT_TEAM_MEMBER') {
    return {
      title: 'Bạn không còn là thành viên của team này',
      message: 'Ai đó (Leader hoặc Admin) vừa gỡ bạn khỏi team đang chọn, hoặc team đã đổi trong lúc bạn thao tác.',
      contact: 'Hãy liên hệ Leader team này hoặc Admin nếu bạn cho rằng đây là nhầm lẫn.'
    };
  }
  if (code === 'ROLE_FORBIDDEN') {
    return {
      title: 'Vai trò của bạn đã bị thay đổi',
      message: 'Quyền của bạn trong team vừa bị đổi (ví dụ từ Leader xuống Member) nên thao tác này không còn thực hiện được nữa.',
      contact: 'Hãy xác nhận lại với Leader hoặc Admin nếu bạn cần quyền như trước.'
    };
  }
  return {
    title: 'Quyền của bạn đã bị thay đổi',
    message: 'Hệ thống vừa từ chối một thao tác vì quyền hiện tại của bạn không còn đủ.',
    contact: 'Hãy xác nhận lại với Leader hoặc Admin.'
  };
}

export function PermissionLostModal({ error, onClose }: { error: ApiError; onClose: () => void }) {
  const { title, message, contact } = describePermissionLost(error.code);
  return (
    <Modal onClose={onClose}>
      <div className="popup w-full max-w-md">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-rose-700">
            <AlertTriangle size={20} /> {title}
          </h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="mb-2 text-sm leading-6 text-phu">{message}</p>
        <p className="mb-5 text-sm leading-6 text-phu">{contact}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="nut-phu" onClick={onClose}>Đóng</button>
          <button type="button" className="nut-chinh" onClick={() => window.location.reload()}>
            Tải lại trang
          </button>
        </div>
      </div>
    </Modal>
  );
}

// FR-18/FR-46: banner dùng chung cho lỗi 409 optimistic-concurrency — bắt buộc có nút "tải lại dữ
// liệu mới" (chỉ toast rồi giữ nguyên form cũ khiến người dùng tiếp tục sửa trên dữ liệu lỗi thời).
// Dùng cho các lệnh gọi MỚI wiring trong đợt này (team switcher, pics theo team); màn đã có cách xử lý
// 409 riêng (release.tsx, weekly.tsx) giữ nguyên như đang có — audit không thấy có lợi tương xứng để
// refactor lại toàn bộ trong lượt việc chỉ tập trung nền tảng đa người dùng này.
export function Conflict409Notice({
  message = 'Dữ liệu này vừa bị người khác thay đổi.',
  onReload
}: {
  message?: string;
  onReload: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span className="flex items-center gap-2"><AlertTriangle size={16} /> {message}</span>
      <button type="button" className="flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100" onClick={onReload}>
        <RefreshCw size={13} /> Tải lại dữ liệu mới
      </button>
    </div>
  );
}
