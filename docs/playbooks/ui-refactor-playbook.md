# UI Refactor Playbook

Dung khi chuan hoa UI/UX hoac sua style.

## 1. Xac Dinh Tang UI

Phan loai moi vung:

- App shell/menu.
- Container lon.
- Toolbar/filter.
- Record/list item.
- Work area phu.
- Domain visual.
- Action button.

## 2. Ap Dung Two-Layer Rule

- Container lon: `bg-white`.
- Record/list item/work area phu: `bg-slate-50`.
- Border: xam trung binh, mac dinh 1px.
- Active/selected: teal hoac semantic color cua domain.

## 3. Button / Navigation

- Primary action: teal.
- Delete/danger: red.
- Prev/next: `ChevronLeft` / `ChevronRight`, nen teal `#0d9488`, icon/text trang, hover `#0f766e`.
- Segmented control: khung ngoai co border, nut con khong tao double-border.
- Icon-only button co `title`/`aria-label`.

## 4. Bao Ve Domain Visual

Truoc khi sua, liet ke `khong duoc mat`.

Vi du:

- MindMap: mau nhanh, canvas, duong noi, drop hint.
- Release: timeline, mau emergency/regular, token visual.
- Luyen de: dung/sai, selected answer, timer.
- Project: tree level, Gantt, progress, carry-over.

## 5. Sua Nho Theo Cum

Thu tu an toan:

1. Token mau/border chung.
2. Container lon.
3. Record/list item.
4. Button/navigation.
5. Form/modal.
6. Empty/loading/error.
7. Domain visual neu that su can.

Khong quet CSS hang loat khi chua hieu y nghia domain.

## 6. Checklist Sau Refactor

- UI co con dung 2 tang trang/xam khong?
- Border co dong nhat khong?
- Record hover co thong nhat border teal nhat, nen teal rat nhat, shadow mong va khong nhay layout khong?
- Co double-border/nham nho o segmented control khong?
- Button them/submit/save co dung teal khong?
- Delete co van la red khong?
- Prev/next co dung icon chevron khong?
- Domain visual co bi mat khong?
- Build co pass khong?
