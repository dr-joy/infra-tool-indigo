<!--
  TEMPLATE Hồ sơ Bug — copy file này thành:
    docs/delivery/bugs/BUG-<yyyymmdd>-<slug>.md
  rồi điền. Xoá các dòng hướng dẫn <!-- ... -->.
  CHỈ mở hồ sơ cho bug đã THOÁT CỔNG (lọt tới sau nghiệm thu / phát hiện lúc dùng thật).
  Bug bắt được ngay trong lúc code/test → không cần hồ sơ.
  Quy chuẩn: docs/delivery/README.md · Quy trình sửa: docs/standards/qa-standard.md §3

  LƯU Ý VỀ LINK: file này là KHUÔN, không phải doc thật. Tham chiếu chéo trong đây dùng
  code span (`docs/...`) thay vì link tương đối — link tương đối đúng ở thư mục đích
  (delivery/bugs/) thì lại gãy ở thư mục templates/, và ngược lại. Khi đã copy sang
  delivery/bugs/, cứ đổi thành link tương đối bình thường nếu muốn.
-->

# BUG-<yyyymmdd>-<slug> — <Triệu chứng một câu, nhìn từ người dùng>

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | <yyyy-mm-dd> |
| Người phát hiện | <tên / vai trò> |
| Backlog item | `BL-<yyyymmdd>-<nnn>` hoặc `—` nếu bug khẩn cấp/thoát cổng được mở trực tiếp |
| Mức nghiêm trọng | ⬜ Chặn dùng ⬜ Sai dữ liệu ⬜ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ⬜ `CR-<yyyymmdd>-<slug>` (link tới `../changes/CR-….md`) ⬜ Có sẵn từ trước khi có CR ⬜ Không truy được |
| **Cổng lẽ ra phải bắt** | ⬜ ① Yêu cầu ⬜ ② Thiết kế ⬜ ③ Feedback sớm ⬜ ④ DoR ⬜ ⑤ Bàn giao test ⬜ ⑥ Cổng hạ tầng ⬜ ⑦ Nghiệm thu ⬜ ⑧ Chốt/ship |
| **Loại nguyên nhân** | ⬜ RC-REQ ⬜ RC-SPEC ⬜ RC-IMPL ⬜ RC-TEST ⬜ RC-DATA ⬜ RC-INTEG ⬜ RC-PERF ⬜ RC-SEC ⬜ RC-DOC ⬜ RC-PROC |
| Trạng thái | ⬜ Mới ⬜ Đã có test đỏ ⬜ Đã sửa ⬜ Đã rút kinh nghiệm |
| Test tái hiện | `<đường dẫn::tên test>` |

## 1. Triệu chứng
<!-- Người dùng thấy gì. Không đoán nguyên nhân ở mục này. -->

## 2. Tái hiện
<!-- Các bước tối thiểu. Dữ liệu/điều kiện cần. -->
1. …
2. …
- **Kỳ vọng:** …
- **Thực tế:** …

## 3. Nguyên nhân gốc
<!-- Không dừng ở "code sai dòng X". Hỏi tiếp: vì sao dòng đó được viết sai mà không ai bắt được?
     Đây là phần nuôi thống kê — viết hời hợt thì cả hồ sơ vô dụng. -->

- **Sai ở đâu (kỹ thuật):** …
- **Vì sao lọt qua:** …

## 4. Cổng nào hụt & vì sao
<!-- Đối chiếu team-operating-standard §6. Nêu ĐÚNG MỘT cổng chịu trách nhiệm chính. -->

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| <①–⑧> | … | … |

## 5. Cách sửa
- **Test đỏ tái hiện** (viết TRƯỚC khi sửa — `docs/standards/qa-standard.md` §3): …
- **Sửa:** …
- **Quét lân cận** (nhánh cùng gốc lỗi đã cover chưa): …

## 6. Hành động cải tiến
<!-- Phần QUAN TRỌNG NHẤT. Bug chỉ có giá trị khi để lại một thay đổi khiến loại bug này
     khó tái diễn. "Lần sau cẩn thận hơn" KHÔNG phải hành động cải tiến. -->

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | <thêm checklist / sửa rule / thêm cổng / thêm ca test bắt buộc> | <link tới standard hoặc rule cụ thể> | ⬜ Chưa ⬜ Xong |

- **Nếu không có hành động cải tiến nào:** ghi rõ lý do (vd "lỗi một lần, chi phí phòng ngừa lớn hơn
  thiệt hại") — để lần sau thống kê không hiểu nhầm là bỏ sót.

## 7. Liên kết
- CR liên quan: …
- Commit sửa: …
- Bug tương tự đã từng gặp: …
