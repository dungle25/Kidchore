## Tóm tắt

<!-- Mô tả ngắn gọn PR này làm gì và vì sao cần. -->

## Loại thay đổi

- [ ] Sửa lỗi (không đổi hành vi hiện có)
- [ ] Tính năng mới
- [ ] Thay đổi schema / migration database
- [ ] Refactor (không đổi hành vi)
- [ ] Tài liệu / CI

## Đã kiểm tra

- [ ] `npm run lint` sạch
- [ ] `npm run typecheck` sạch
- [ ] `npm run build` thành công
- [ ] `npm run test:db` pass (nếu có đụng vào database)
- [ ] `npm run test:e2e` pass (nếu có đụng vào route hoặc phân quyền)
- [ ] Đã thử tay trên trình duyệt (ghi rõ màn hình nào)

## Checklist bảo mật

Phần này quan trọng hơn phần còn lại, vì ứng dụng chứa dữ liệu của trẻ em.

- [ ] **Không có secret nào bị commit.** `.env.local` vẫn nằm trong `.gitignore`; không có key thật trong code, test hay tài liệu.
- [ ] **Không thêm quyền truy cập bảng trực tiếp.** Mọi thao tác ghi vẫn đi qua function `SECURITY DEFINER`. Nếu có bảng mới, đã bật RLS cho nó.
- [ ] **Danh tính lấy từ session.** Không có chỗ nào nhận `user_id` / `child_id` từ client rồi tin ngay. Việc uỷ quyền dựa trên `auth.uid()`, không dựa trên tham số.
- [ ] **Điểm và phần thưởng được kiểm tra ở database.** Số điểm đọc từ bảng `tasks`, không lấy từ tham số; số dư được kiểm tra trước khi trừ.
- [ ] **Thao tác ghi vẫn idempotent.** Bấm hai lần không cộng/trừ điểm hai lần.
- [ ] **RLS vẫn còn hiệu lực.** `anon` vẫn không đọc được bảng nào. Đã chạy lại bước kiểm tra trong `test:db` nếu có đụng vào policy.

## Nếu có migration

- [ ] File migration mới được đánh số tiếp theo trong `db/migrations/`
- [ ] Đã chạy `npm run db:migrate` thành công trên project thử nghiệm
- [ ] Migration **idempotent** (chạy lại không lỗi)
- [ ] Đã nghĩ tới dữ liệu đang có: migration không làm hỏng row hiện tại
- [ ] Đã bật RLS cho bảng mới (nếu có)

## Ghi chú cho người review

<!-- Điểm cần chú ý, chỗ đánh đổi, hoặc việc còn để lại cho PR sau. -->
