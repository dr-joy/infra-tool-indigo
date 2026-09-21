
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteToQuillHtml } from '../../server/lib/drjoy-html.js';

test('AC-1: ca thật 2026-08-17 — dòng trống thành <br> giữa các <p>', () => {
  const note = '皆様\nお疲れ様です。\n\nステージング環境への反映作業が完了しました。\n\n引き続きよろしくお願いいたします。';
  assert.equal(
    noteToQuillHtml(note),
    '<p>皆様</p><p>お疲れ様です。</p><br><p>ステージング環境への反映作業が完了しました。</p><br><p>引き続きよろしくお願いいたします。</p>'
  );
});

test('AC-2: escape &, <, > — Note không biến thành thẻ thật', () => {
  assert.equal(
    noteToQuillHtml('a & b\n<script>alert(1)</script>'),
    '<p>a &amp; b</p><p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
  );
});

test('AC-3: 2 dòng trống liên tiếp -> 2 <br>, không gộp', () => {
  assert.equal(noteToQuillHtml('a\n\n\nb'), '<p>a</p><br><br><p>b</p>');
});

test('AC-3b: dòng trống ở đầu và cuối vẫn giữ', () => {
  assert.equal(noteToQuillHtml('\na\n'), '<br><p>a</p><br>');
});

test('AC-4: Note rỗng hoặc toàn khoảng trắng -> chuỗi rỗng', () => {
  assert.equal(noteToQuillHtml(''), '');
  assert.equal(noteToQuillHtml('   '), '');
  assert.equal(noteToQuillHtml('\n\n'), '');
});

test('AC-5: khoảng trắng full-width đầu dòng được giữ (thụt lề kiểu JP)', () => {
  assert.equal(noteToQuillHtml('■ 予定\n　13:00 – 15:00'), '<p>■ 予定</p><p>　13:00 – 15:00</p>');
});

test('CRLF và CR được chuẩn hoá như LF', () => {
  assert.equal(noteToQuillHtml('a\r\n\r\nb'), '<p>a</p><br><p>b</p>');
  assert.equal(noteToQuillHtml('a\r\rb'), '<p>a</p><br><p>b</p>');
});

test('dấu nháy KHÔNG bị escape (Quill lưu nguyên, escape thừa sẽ hiện &#39; cho người đọc)', () => {
  assert.equal(noteToQuillHtml(`nháy ' và "`), `<p>nháy ' và "</p>`);
});

test('Note một dòng -> đúng một <p>, không có <br>', () => {
  assert.equal(noteToQuillHtml('chỉ một dòng'), '<p>chỉ một dòng</p>');
});

test('khoảng trắng thường ở dòng trống vẫn tính là dòng trống', () => {
  assert.equal(noteToQuillHtml('a\n   \nb'), '<p>a</p><br><p>b</p>');
});
