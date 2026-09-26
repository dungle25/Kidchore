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
npm run test:storage # 10 kiểm tra upload ảnh bằng chứng
npm run test:onboarding # 13 kiểm tra luồng tạo gia đình
npm run test:e2e     # 32 kiểm tra HTTP (cần app đang chạy)
npm run validate:ci  # kiểm tra cấu hình CI
```

Kiểm chứng trên bản **đã deploy** (không cần chạy app ở máy):

```bash
node scripts/preflight-signin.mjs https://<domain>       # chuỗi đăng nhập
node scripts/test-deployed-workflow.mjs https://<domain> # 19 kiểm tra toàn bộ luồng
node scripts/check-onboarding-state.mjs                  # đã có gia đình chưa
node scripts/check-deployment-env.mjs https://<domain>    # biến môi trường
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

Việc này chỉ làm được trong Supabase Dashboard.

1. Google Cloud Console → APIs & Services → Credentials → tạo **OAuth client ID**
   (Web application).
2. **Authorized redirect URIs** phải chứa **chính xác** dòng này:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
   Sai một ký tự ở đây sẽ làm bước đổi code lấy token thất bại, với thông báo
   `Unable to exchange external code`.
3. Supabase Dashboard → Authentication → Providers → **Google** → bật và dán
   Client ID + Client Secret của **đúng client đó**.
4. Supabase Dashboard → Authentication → **URL Configuration**:
   - **Site URL**: domain thật, ví dụ `https://kidchore-omega.vercel.app`
   - **Redirect URLs**: thêm **cả hai**
     ```
     http://localhost:3000/auth/callback
     https://<domain>/auth/callback
     ```
   - Bấm **Save changes** ở **từng khối**. Hai khối lưu riêng, nên phải bấm hai
     lần; form nhìn như đã điền vẫn có thể chưa được lưu.

### Vì sao bước 4 bắt buộc, không phải tùy chọn

`redirect_to` mà app gửi lên **phải có trong Redirect URLs**. Nếu không, Supabase
**thay bằng Site URL** thay vì báo lỗi, nên người dùng bị đưa về sai chỗ và rất khó
đoán ra nguyên nhân. Xem
[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) và
[troubleshooting chính thức](https://supabase.com/docs/guides/troubleshooting/why-am-i-being-redirected-to-the-wrong-url-when-using-auth-redirectto-option-_vqIeO).

Để đối chiếu giá trị Supabase gửi cho Google:

```bash
node scripts/diagnose-google-oauth.mjs
```

### Một điều không thể kiểm tra qua API

Endpoint `/auth/v1/settings` **không** trả về `site_url` hay `uri_allow_list`, nên
không có cách nào xác nhận cấu hình bước 4 từ bên ngoài. Việc kiểm tra allow list
cũng chỉ xảy ra **sau khi Google trả về**, không phải lúc bắt đầu flow — nên một
request thử với host lạ vẫn "thành công" dù allow list đã bật.

Cách xác minh duy nhất đáng tin: **đăng nhập thật trong cửa sổ ẩn danh**. Nếu vào
được trang onboarding là cấu hình đã có hiệu lực.

## Triển khai miễn phí

**Vercel Hobby + Supabase Free** là đủ cho một gia đình.

1. Push repo lên GitHub.
2. Vercel → New Project → import repo.
3. Thêm các biến môi trường trong Vercel — đúng 4 biến, **không** cần
   `DATABASE_URL` khi chạy:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_JWT_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`

   `npm run vercel:env` ghi ra `vercel-env.txt` (đã gitignore) để copy cho nhanh.
4. Deploy, rồi thêm domain Vercel vào **Redirect URLs** ở bước 4 phía trên.
5. Tùy chọn — bật thông báo đẩy: thêm 3 biến nữa, xem mục dưới.

Kiểm tra deployment đã nhận biến chưa:

```bash
node scripts/check-deployment-env.mjs https://<domain>
node scripts/compare-deployment-credentials.mjs https://<domain>
```

Lưu ý về gói miễn phí:

- **Supabase Free tạm dừng project sau 7 ngày không hoạt động.** Lần mở đầu tiên
  sau đó sẽ chậm hoặc lỗi; vào Dashboard bấm khôi phục. Nếu thấy phiền, có thể
  dùng một cron ping định kỳ.
- Vercel Hobby dành cho mục đích phi thương mại — dùng cho gia đình là hợp lệ.
- Storage miễn phí 1GB. Nếu bật ảnh bằng chứng, nên nén ảnh ở client trước khi
  upload.

## Bật thông báo đẩy

Không bắt buộc. Không có 3 biến dưới đây thì app chạy y như thường, chỉ là không có
nút "Bật thông báo" (giao diện tự ẩn).

1. Sinh một cặp khoá:

   ```bash
   npx web-push generate-vapid-keys --json
   ```

2. Thêm vào Vercel (Production **và** Preview):
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — khoá công khai, đưa cho trình duyệt khi đăng ký
   - `VAPID_PRIVATE_KEY` — để loại **Sensitive**, không bao giờ lộ ra ngoài
   - `VAPID_SUBJECT` — `mailto:` hoặc URL `https:` của bản deploy

   `npm run vercel:env` xuất cả ba vào `vercel-env.txt` kèm kiểm tra hình dạng.

3. Trên từng thiết bị: mở app bằng **Safari** → nút **Chia sẻ** → **Thêm vào Màn hình
   chính** → mở KidChore từ biểu tượng vừa thêm → bấm **Bật thông báo**.

Ba điều đáng biết trước, vì chúng không phải lỗi:

- **Phải cài vào Màn hình chính.** Safari chỉ cho web app đã thêm vào Màn hình chính
  nhận thông báo; trong tab Safari thì không có cách nào. Trang sẽ tự hướng dẫn khi
  phát hiện đang mở trên iPhone/iPad mà chưa cài.
- **Cần iOS/iPadOS 18.4 trở lên.** Từ đó Safari hiển thị được thông báo mà không cần
  service worker (Declarative Web Push), nên app cố ý không có service worker. Trên
  16.4–18.3 thông báo sẽ được nhận nhưng không hiện.
- **Xoá app khỏi Màn hình chính là mất đăng ký.** Mở lại app và bật lại là xong.

## Chức năng đã có

- Bố/mẹ: tổng quan, duyệt bài kèm ảnh bằng chứng, quản lý việc nhà (CRUD, lịch lặp
  lại, giao theo bé hoặc cả nhà), kho phần thưởng, duyệt đổi thưởng, quản lý tài
  khoản các bé (tạo, đổi PIN, đổi tên, cộng/trừ điểm thủ công có ghi log), thưởng
  nhanh và phạt nhanh một chạm kèm hoàn tác, báo cáo 7/30/90 ngày
- Bé: xem việc hôm nay, nộp bài kèm ảnh, xem điểm, đổi quà, xem huy hiệu và chuỗi ngày
- Điểm âm: bé tiêu hết điểm vẫn bị phạt, phần âm là "điểm nợ" hiển thị rõ và phải làm
  việc để trả
- Thông báo đẩy theo sự kiện (nộp bài, duyệt, thưởng/phạt điểm, đổi quà)
- PWA: cài được lên màn hình chính, có icon và theme

## Chưa có

- Nhắc theo lịch (ví dụ 19:00 nhắc bé chưa làm bài). Thông báo hiện tại chỉ theo sự
  kiện; muốn theo lịch thì cần một cron, và gói Vercel Hobby giới hạn tần suất cron.
- Sàn cho điểm nợ: hiện không giới hạn, bé có thể âm bao nhiêu cũng được.

