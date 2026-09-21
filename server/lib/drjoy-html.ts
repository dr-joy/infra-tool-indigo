
const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ESCAPE_MAP[c]);
}

/**
 * Note text thuần -> Quill HTML của Dr.JOY.
 * Trả `''` khi Note rỗng/toàn khoảng trắng (nơi gọi coi đó là "không dựng được" và fail-closed).
 */
export function noteToQuillHtml(note: string): string {
  const raw = String(note ?? '');
  if (!raw.trim()) return '';

  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // `trim()` chỉ để PHÂN LOẠI dòng trống; nội dung giữ nguyên để không mất thụt lề `　` kiểu JP.
    .map((line) => (line.trim() === '' ? '<br>' : `<p>${escapeHtml(line)}</p>`))
    .join('');
}
