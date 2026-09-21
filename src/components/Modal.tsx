import React, { useEffect } from 'react';

// Ngăn xếp các pop-up đang mở: chỉ pop-up trên cùng mới phản hồi phím Esc
// (tránh trường hợp 2 pop-up chồng nhau bị đóng cùng lúc).
const modalEscStack: Array<() => void> = [];

// Khuôn chung cho mọi cửa sổ pop-up: lớp nền mờ + đóng khi bấm ra ngoài + đóng bằng phím Esc
// + đánh dấu cho trình đọc màn hình (role="dialog"). Nội dung pop-up truyền vào qua children.
// dismissable=false để khóa đóng (vd đang lưu/xóa dở). scroll/nested cho biến thể cuộn/lồng nhau.
export function Modal({
  onClose,
  children,
  dismissable = true,
  scroll = false,
  nested = false,
}: {
  onClose: () => void;
  children: React.ReactNode;
  dismissable?: boolean;
  scroll?: boolean;
  nested?: boolean;
}) {
  useEffect(() => {
    if (!dismissable) return;
    const handler = () => onClose();
    modalEscStack.push(handler);
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && modalEscStack[modalEscStack.length - 1] === handler) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const idx = modalEscStack.indexOf(handler);
      if (idx >= 0) modalEscStack.splice(idx, 1);
    };
  }, [onClose, dismissable]);

  const className = ['overlay', scroll && 'overlay-scroll', nested && 'overlay-nested'].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
