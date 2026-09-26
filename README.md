# KidChore

Ứng dụng web quản lý việc nhà, thói quen và phần thưởng cho trẻ trong gia đình.
Bố/mẹ đăng nhập bằng Google, các bé đăng nhập bằng mã PIN.

## Kiến trúc

- **Next.js 16** (App Router, Server Components, Server Actions) + React 19 + Tailwind v4
- **Supabase** cho Postgres, Auth (Google) và Storage
- **Toàn bộ logic nghiệp vụ nằm trong Postgres**, dưới dạng các function
  `SECURITY DEFINER`

### Mô hình bảo mật

Đây là phần quan trọng nhất cần hiểu trước khi sửa code:

1. **RLS bật trên mọi bảng, mặc định từ chối.** Role `anon` (publishable key)
   không đọc và không ghi được bất kỳ bảng nào. Đây là điều ngăn một người lạ có
   key công khai đọc dữ liệu gia đình bạn.

2. **Mọi thao tác ghi đều đi qua RPC.** Các function trong
   `db/migrations/0001_security_lockdown_and_rpc.sql` kiểm tra vai trò, xác thực
   giá trị (điểm dương, đủ điểm, chống cộng trùng) rồi mới ghi. Bảng **không**
   được cấp quyền ghi trực tiếp, vì làm vậy sẽ bỏ qua toàn bộ kiểm tra này.

3. **Danh tính lấy từ session, không bao giờ từ tham số.** Các function tự suy ra
   người gọi qua `auth.uid()`. Không có chỗ nào tin `child_id` do client gửi lên,
   nên một bé không thể nộp bài hay tiêu điểm của bé khác.

4. **Token phiên do ứng dụng tự ký.** `lib/session.ts` ký JWT bằng
   `SUPABASE_JWT_SECRET`, với `sub` là `auth_user_id`. Nhờ vậy PostgREST chấp nhận
   token và `auth.uid()` phân giải đúng người dùng. Cookie là `HttpOnly`, chữ ký
   HMAC được so sánh constant-time.

5. **PIN không bao giờ rời database.** PIN được băm bằng bcrypt
   (`pgcrypto`) ngay trong Postgres và chỉ so sánh ở đó. Không có hash nào được trả
   về client. Sai 8 lần sẽ khoá 15 phút.

### Cấu trúc thư mục

```
app/
  actions/        Server Actions (auth, task, reward, family)
  parent/         Khu vực của bố/mẹ
  kid/            Khu vực của bé
  login/          Đăng nhập Google + PIN
  auth/callback/  Nhận redirect OAuth
  onboarding/     Tạo gia đình lần đầu
components/       UI dùng chung
lib/
  dal.ts          Lớp truy cập dữ liệu + guard phân quyền (server-only)
  session.ts      Ký và kiểm tra token phiên (không phụ thuộc Supabase)
  supabase-*.ts   Các client Supabase
db/migrations/    Toàn bộ schema + RLS + RPC
scripts/          Chạy migration, test luồng nghiệp vụ
proxy.ts          Bảo vệ route (Next 16 đổi tên từ middleware.ts)
```

## Chạy tại máy

```bash
npm install
cp .env.example .env.local   # rồi điền các giá trị
node scripts/migrate.mjs     # tạo schema, bật RLS, cài các RPC
npm run dev
```

Mở http://localhost:3000

## Kiểm thử

```bash
npm run typecheck    # kiểm tra kiểu
npm run lint         # lint
npm run db:status    # migration nào đã chạy
npm run test:db      # 27 kiểm tra luồng nghiệp vụ trên database
npm run test:e2e     # 19 kiểm tra HTTP (cần app đang chạy)
```

`test:db` tạo một gia đình tạm rồi chạy qua toàn bộ luồng (nộp bài → duyệt → cộng
điểm, đổi thưởng, đăng nhập PIN), bao gồm cả các trường hợp **phải bị từ chối**:
nộp bài của bé khác, cộng điểm hai lần khi bấm duyệt twice, sửa chữ ký token, và
đọc bảng trực tiếp bằng publishable key.

`test:e2e` chạy app thật rồi kiểm tra qua HTTP: người lạ bị chuyển về `/login`,
bố/mẹ không vào được khu của bé và ngược lại, các trang render đúng dữ liệu của
gia đình mình, token bị sửa không có tác dụng, và một gia đình khác không nhìn thấy
dữ liệu gia đình này.

Cách chạy test e2e:

```bash
npm run build && npm start   # ở terminal thứ nhất
npm run test:e2e             # ở terminal thứ hai
```

Cả hai bộ test đều tự dọn dữ liệu tạm sau khi chạy.

## Cấu hình Google login

Việc này chỉ làm được trong Supabase Dashboard:

1. Google Cloud Console → APIs & Services → Credentials → tạo **OAuth client ID**
   (Web application).
2. Authorized redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. Supabase Dashboard → Authentication → Providers → **Google** → bật và dán
   Client ID + Client Secret.
4. Supabase Dashboard → Authentication → URL Configuration:
   - Site URL: domain thật của bạn (ví dụ `https://kidchore.vercel.app`)
   - Redirect URLs: thêm `http://localhost:3000/auth/callback` và
     `https://<domain>/auth/callback`

## Triển khai miễn phí

**Vercel Hobby + Supabase Free** là đủ cho một gia đình.

1. Push repo lên GitHub.
2. Vercel → New Project → import repo.
3. Thêm các biến môi trường trong Vercel (giống `.env.local`, nhưng **không** cần
   `DATABASE_URL` khi chạy).
4. Deploy, rồi thêm domain của Vercel vào Redirect URLs ở bước cấu hình Google.

Lưu ý về gói miễn phí:

- **Supabase Free tạm dừng project sau 7 ngày không hoạt động.** Lần mở đầu tiên
  sau đó sẽ chậm hoặc lỗi; vào Dashboard bấm khôi phục. Nếu thấy phiền, có thể
  dùng một cron ping định kỳ.
- Vercel Hobby dành cho mục đích phi thương mại — dùng cho gia đình là hợp lệ.
- Storage miễn phí 1GB. Nếu bật ảnh bằng chứng, nên nén ảnh ở client trước khi
  upload.

## Chức năng đã có

- Bố/mẹ: tổng quan, duyệt bài kèm ảnh bằng chứng, quản lý việc nhà (CRUD, lịch lặp
  lại, giao theo bé hoặc cả nhà), kho phần thưởng, duyệt đổi thưởng, quản lý tài
  khoản các bé (tạo, đổi PIN, đổi tên, cộng/trừ điểm thủ công có ghi log)
- Bé: xem việc hôm nay, nộp bài, xem điểm, đổi quà
- PWA: cài được lên màn hình chính, có icon và theme

## Chưa có

- Ảnh bằng chứng: cột `proof_image_url` và giao diện hiển thị đã có, nhưng chưa có
  phần upload/nén ảnh ở client.
- Báo cáo/biểu đồ theo tuần, tháng và chuỗi ngày (streak).
- Badge/huy hiệu cho bé.
- Thông báo real-time khi bé nộp bài.
