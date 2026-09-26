# Quy ước dự án KidChore

Tài liệu này là chuẩn của dự án. Nó ghi lại **cách làm** và **những bẫy đã thực sự gặp**,
để lần sau không ai phải học lại bằng cách làm hỏng dữ liệu thật.

Đọc `README.md` để biết cách chạy và triển khai. Đọc file này trước khi sửa code.

---

## 1. Nguyên tắc bất di bất dịch

Bốn điều dưới đây là nền móng. Phá một trong bốn là phá cả mô hình bảo mật.

### 1.1. Danh tính luôn lấy từ session, không bao giờ từ tham số

Không có hàm nào nhận `child_id` rồi tin ngay. Hàm tự suy ra người gọi qua `auth.uid()`
bên trong database. Nhờ vậy một bé không thể nộp bài hay tiêu điểm của bé khác dù có sửa
request.

```ts
// SAI: client quyết định đây là ai
await callRpc(db, "approve_task_instance", { p_instance_id, p_parent_id: fromForm });

// ĐÚNG: hàm tự biết người gọi là ai
await callRpc(db, "approve_task_instance", { p_instance_id: instanceId });
```

### 1.2. Mọi thao tác ghi đi qua function `SECURITY DEFINER`

Bảng **không** được cấp quyền ghi cho `anon` hay `authenticated`. Cấp quyền ghi trực tiếp
sẽ bỏ qua toàn bộ kiểm tra về vai trò, số dư và tính idempotent. RLS bật trên mọi bảng,
mặc định từ chối.

Nếu bạn cần một thao tác ghi mới: viết một function trong `db/migrations/`, đừng mở quyền
bảng.

### 1.3. Điểm số được kiểm tra ở database, không ở client

Số điểm đọc từ bảng `tasks`, số dư kiểm tra trước khi trừ. Client chỉ hiển thị. Một tham
số `points` do client gửi lên là một lỗ hổng, không phải một tiện lợi.

### 1.4. PIN không bao giờ rời database

PIN được băm bằng bcrypt ngay trong Postgres (`pgcrypto`) và chỉ so sánh ở đó. Không có
hash nào được trả về client. Sai 8 lần thì khoá 15 phút.

---

## 2. Kiến trúc: cái gì nằm ở đâu

| Việc | Nơi làm |
|---|---|
| Đọc/ghi dữ liệu | function SQL trong `db/migrations/` |
| Xác thực người gọi, phân quyền | `lib/dal.ts` |
| Ký và kiểm tra token phiên | `lib/session.ts` (không phụ thuộc Supabase) |
| Tạo Supabase client | `lib/supabase-server.ts`, `lib/supabase-browser.ts`, `lib/supabase-oauth.ts` |
| Mutation từ UI | Server Action trong `app/actions/` |
| Kiểu dữ liệu và thông báo lỗi | `lib/domain.ts` |
| Bảo vệ route | `proxy.ts` (Next 16 đổi tên từ `middleware.ts`) |

`lib/dal.ts` là ranh giới. Mọi thứ khác đi qua nó. ESLint chặn việc import thẳng
`@supabase/supabase-js` hay `@supabase/ssr` trong `app/` và `components/`, để không ai vô
tình dựng client riêng rồi bỏ qua phân quyền. Import các wrapper trong `lib/supabase-*.ts`
là đường được phép — đó chính là ranh giới.

### Ai được dùng service role key

`createAdminClient()` bỏ qua toàn bộ RLS. Đúng **hai** chỗ cần nó, cả hai vì không có danh
tính người dùng nào để phân quyền:

| Chỗ | Vì sao |
|---|---|
| Xác minh PIN của bé | Xảy ra trước khi có session. `child_login_subject` chỉ cấp cho `service_role`, không cấp cho `anon` |
| Tải ảnh minh chứng lên Storage | Bucket chưa có policy cho `authenticated`. Đường dẫn object lấy từ `family_id` do database trả về, không từ client |

Mọi thứ khác phục vụ dữ liệu trang cho người đã đăng nhập thì **không** được dùng. Ví dụ
`listChildProfiles()` trước đây dùng admin client dù `list_child_profiles` đã được cấp cho
`anon` — nay dùng `createAnonClient()`. Cấp thừa quyền không gây lỗi ngay, nó chỉ biến một
thay đổi sau này thành lỗ hổng.

### Thông báo đẩy: ai quyết định người nhận

Việc gửi push **phải** chạy ở Node, vì payload được mã hoá bằng khoá công khai của thiết
bị và ký bằng khoá riêng VAPID — không làm được trong SQL. Nhưng câu hỏi "ai được phép
biết chuyện này" là câu hỏi phân quyền, và phân quyền thuộc về database.

Nên trách nhiệm chia đôi:

- `public.push_recipients(p_kind, p_subject_id, p_amount)` tự suy ra người nhận từ
  `auth.uid()` và từ chính dòng dữ liệu mà sự kiện nói tới, rồi trả về cả nội dung tin
  nhắn. Không có tham số nào của client trở thành chữ trong thông báo.
- `lib/push.ts` chỉ mã hoá và gửi những gì được đưa cho.

Đường dễ đi nhưng **sai**: đọc subscription của người khác bằng service role key rồi gửi.
Cách đó bỏ qua RLS đúng ở chỗ mà RLS là thứ duy nhất đang bảo vệ dữ liệu.

Hai điều dễ quên khi sửa phần này:

- **`await notifyEvent(...)`, đừng thả trôi.** Trên serverless, tiến trình có thể bị đóng
  băng ngay khi response được gửi đi, nên một promise không `await` là một thông báo
  không bao giờ tới.
- **`notifyEvent` không bao giờ throw.** Gửi push là tiện ích thêm vào một việc gia đình
  đã làm xong; để nó làm hỏng việc đó là biến "dịch vụ push trục trặc" thành "bố không
  duyệt được việc cho con".

Sửa schema thì **luôn thêm file mới** trong `db/migrations/`, không sửa file đã chạy.
Migration runner ghi checksum nên file đã apply mà bị sửa sẽ báo `CHANGED since applied`.

---

## 3. Code style

Định dạng do ESLint quyết định. Chạy `npm run lint` trước khi commit.

Muốn biết **thật sự** rule nào đang bật, đừng đọc file này — hỏi ESLint:

```bash
npx eslint --print-config lib/dal.ts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).rules;console.log(r['@typescript-eslint/no-floating-promises'], r['@typescript-eslint/no-non-null-assertion'])})"
```

### Bắt buộc bởi lint

- **Không dùng `any`.** `lib/domain.ts` mô tả mọi payload mà function trả về.
- **Không dùng `!` non-null assertion.** Nó che mất đúng trường hợp mà kiểm tra sinh ra để bắt.
- **Không để promise trôi nổi.** Trong Server Action, promise không `await` nghĩa là action
  trả về trước khi việc xong: trang revalidate với dữ liệu cũ và lỗi biến mất.
  Trong React event handler, dùng `void asyncFn().catch(...)`.
- **`===` chứ không `==`** (trừ so với `null`).
- Chỉ `throw new Error(...)`, không throw literal.

### Quy ước viết

- **Comment giải thích vì sao, không giải thích cái gì.** Tên hàm đã nói cái gì. Comment
  nên nói lý do chọn cách này, hoặc ghi lại cái bẫy đã gặp.
- **Comment bằng tiếng Anh trong code**, tiếng Việt cho nội dung hướng tới người dùng và
  cho commit message.
- **Chữ hiển thị cho người dùng bằng tiếng Việt**, gom trong `lib/domain.ts`
  (`DB_ERROR_MESSAGES`) và trong component, không rải trong SQL.
- **Ngày tháng và số dùng `text` của Postgres khi trả về client** để tránh lệch múi giờ
  giữa server UTC và gia đình ở GMT+7. Đây là lý do `due_date` được trả dạng chuỗi.
- **Một file một việc.** Component trang trí dài quá thì tách thành component riêng, như
  `child-card.tsx` tách khỏi `page.tsx`.

---

## 4. Kiểm thử

Nguyên tắc: **kiểm chứng bằng hành vi thật, không suy luận từ cấu hình.** Nhiều lần trong
dự án này, cấu hình trông đúng nhưng hành vi sai.

| Lệnh | Cần gì | Kiểm cái gì |
|---|---|---|
| `npm run lint` | — | Rule ở mục 3 |
| `npm run typecheck` | — | `next typegen && tsc --noEmit` |
| `npm run test:db` | database | Nghiệp vụ: nộp bài, duyệt, đổi quà, số dư |
| `npm run test:onboarding` | database | Tạo gia đình, thêm bé, đăng nhập bằng PIN |
| `npm run test:storage` | database + Storage | Tải ảnh minh chứng lên bucket |
| `npm run test:reports` | database | Báo cáo, streak, huy hiệu |
| `npm run test:award` | database | Thưởng nhanh và phạt nhanh, cả trường hợp phải bị từ chối |
| `npm run test:push` | database | Đăng ký thiết bị nhận thông báo, và ai được báo về sự kiện nào |
| `npm run test:suggested` | — | Danh mục việc gợi ý và luật của thao tác thêm nhanh (trùng tên, điểm không hợp lệ) |
| `npm run test:e2e` | app đang chạy | Kiểm tra HTTP: chặn route, cookie, Server Action |
| `npm run validate:ci` | — | File workflow có hợp lệ và có chạy đúng script không |

Mỗi bộ in ra số kiểm tra ở cuối lần chạy. **Đừng chép số đó vào tài liệu này** — bảng trên
từng ghi số cụ thể và đã sai hai lần, vì số kiểm tra tăng mà tài liệu thì không. Cái đáng
ghi lại là bộ test **kiểm cái gì**, không phải nó có bao nhiêu dòng `check()`.

Kiểm chứng trên bản đã deploy:

```bash
node scripts/preflight-signin.mjs https://<domain>
node scripts/test-deployed-workflow.mjs https://<domain>
node scripts/test-deployed-child-flow.mjs https://<domain>
node scripts/test-deployed-profile-switch.mjs https://<domain>
```

### Quy tắc viết test

- **Luôn kiểm tra cả trường hợp phải bị từ chối.** Test chỉ có happy path là test không
  chứng minh được gì về bảo mật.
- **Test phải tự dọn dẹp, và không được xoá dữ liệu thật.** Xem mục 6.1.
- **Comment nói rõ kỳ vọng**, đặc biệt với logic dễ sai như streak.

---

## 5. Quy trình Pull Request

`main` được bảo vệ. Không push thẳng.

1. Tạo nhánh: `feat/...`, `fix/...`, `chore/...`, `docs/...`
2. Push nhánh → Vercel tạo **Preview deployment**, production không đổi
3. Mở PR → CI chạy
4. Thử Preview URL
5. CI xanh → merge → Vercel deploy production từ `main`

Bước 5 chỉ có CI, không có approval — xem lý do ngay dưới. Cổng chặn thật là
`Lint, typecheck and build`, và nó chạy trên **mọi** PR.

### Điều kiện merge

- ✅ `Lint, typecheck and build` pass (bắt buộc, cấu hình trong branch protection)
- ✅ Nhánh phải chứa `main` mới nhất

Yêu cầu approval đặt bằng **0**. Lý do, và đây là điều mất thời gian mới nhận ra:
**GitHub cấm GitHub Actions approve pull request.** Nếu đặt yêu cầu 1 approval thì một
người làm một mình sẽ không merge được PR của chính mình, vì:

- Người thật không tự approve PR của mình được (GitHub chặn).
- Bot không approve hộ được (GitHub chặn luôn).

Đã thử và thất bại: một workflow `auto-approve` chạy `gh pr review --approve`. Nó trả về
`GitHub Actions is not permitted to approve pull requests`. Tệ hơn, job vẫn báo
**success** vì bước đó chỉ `echo "::warning::"` — nên approval không bao giờ xuất hiện mà
nhìn cột CI lại tưởng đã xong. `validate-ci.mjs` giờ chặn việc thêm lại một bước như vậy.

Khi nào có người thứ hai cùng làm thì đặt lại yêu cầu 1 approval; lúc đó review là thật và
có ích.

Đừng dựa vào bypass của admin: bypass biến mọi luật ở trên thành lời khuyên, không phải
ràng buộc.

### Checklist trước khi mở PR

- [ ] `npm run lint` sạch
- [ ] `npm run typecheck` sạch
- [ ] `npm run build` thành công
- [ ] Các bộ test liên quan đã chạy
- [ ] Không có secret nào bị commit
- [ ] Nếu có migration: đã chạy `npm run db:migrate` và migration **idempotent**

---

## 6. Những bẫy đã thực sự gặp

Phần này quan trọng nhất. Mỗi mục là một lần mất thời gian thật, hoặc một lần làm hỏng
dữ liệu thật.

### 6.1. Không bao giờ dọn dẹp test theo mẫu địa chỉ email

**Đã xảy ra:** cleanup xoá `auth.users` theo mẫu `%@kidchore.local`. Nhưng `create_child`
cấp identity cho **mọi** bé với đúng mẫu đó. Mỗi lần chạy test là một lần xoá identity
của bé thật, khiến bé không đăng nhập được.

**Quy tắc:** dọn dẹp dựa trên **ảnh chụp** danh sách lúc bắt đầu, chỉ xoá cái mới xuất
hiện. Dùng `scripts/lib/test-cleanup.mjs`. Script dọn dẹp phải mặc định **chỉ báo cáo**,
phải truyền `--apply` mới thực sự xoá.

Nếu một bé mất liên kết đăng nhập: `node scripts/repair-child-identity.mjs --apply`.

### 6.2. `NEXT_PUBLIC_SUPABASE_URL` chỉ được là URL gốc

**Đã xảy ra:** dán kèm `/rest/v1/` từ ô "REST URL" của Supabase. Vì `auth-js` ghép thêm
`/auth/v1/authorize`, browser bị trỏ tới `/rest/v1/auth/v1/authorize` — đường dẫn của
PostgREST. PostgREST trả `No API key found in request`, một thông báo **chỉ vào API key
chứ không vào URL**, khiến việc chẩn đoán đi sai hướng rất lâu.

**Quy tắc:** `lib/env.ts` bóc path và cảnh báo. Biến môi trường phải là
`https://<ref>.supabase.co`, không có gì theo sau.

### 6.3. Kiểm tra cấu hình không thay thế cho kiểm tra hành vi

**Đã xảy ra:** script audit báo "main đã được bảo vệ" trên một repo mà push thẳng vào
`main` vẫn thành công. Nó đọc danh sách ruleset và đối tượng classic protection, cả hai
đều trông đúng, và **không xét** `enforce_admins`. Luật có đó nhưng không ai bị ràng buộc.

**Quy tắc:** một luật mà đối tượng nào đó được phép bỏ qua thì không ngăn được gì. Khi
kiểm tra bảo vệ nhánh, phải hỏi cả ba: có luật gì, ai được bỏ qua, và push thật có bị từ
chối không.

### 6.4. Proxy của Next 16 không vừa set cookie vừa render trang

**Đã xảy ra:** thử gia hạn phiên trong `proxy.ts`. `NextResponse.next()` **nuốt** header
và cookie của chính nó; trả `Response` trực tiếp thì Set-Cookie tới nơi nhưng **body rỗng**,
trang trắng. Cả hai đường đều hỏng, đã kiểm chứng bằng thực nghiệm.

**Quy tắc:** gia hạn phiên nằm ở route handler `app/api/auth/keepalive`. Proxy chỉ bảo vệ
route.

### 6.5. GitHub Actions không được approve pull request

**Đã xảy ra:** viết workflow `auto-approve.yml` để bot duyệt hộ, vì người thật không tự
duyệt PR của mình được. Chạy thật thì GitHub trả:

```
failed to create review: GraphQL: GitHub Actions is not permitted to approve pull requests.
```

Job vẫn báo **success** vì tôi để `echo "::warning::"` thay vì `exit 1`, nên triệu chứng
là "không có approval nào xuất hiện" chứ không phải "có lỗi". Một bước thất bại mà job xanh
là cấu hình tồi: nó nói dối.

**Quy tắc:** đặt yêu cầu approval = 0 khi làm một mình. Không viết workflow approve PR.
`validate-ci.mjs` chặn việc thêm lại. Và khi một bước có thể thất bại, hãy để nó **fail**
job thay vì chỉ cảnh báo.

### 6.5b. Route `workflow_run` đọc workflow từ nhánh mặc định

**Đã xảy ra:** thêm một workflow dùng `workflow_run` vào một PR rồi kỳ vọng nó chạy cho
chính PR đó. Không được: route `workflow_run` chỉ đọc workflow từ nhánh mặc định.

**Quy tắc:** PR đầu tiên mang một workflow `workflow_run` vào luôn cần xử lý tay.

### 6.6. Không kiểm tra toàn hệ thống trong test

**Đã xảy ra:** test assert "toàn hệ thống chỉ có 1 family", đúng khi database trống nhưng
sai ngay khi có gia đình thật.

**Quy tắc:** phạm vi kiểm tra phải giới hạn vào dữ liệu của chính lần chạy đó.

### 6.7. Đọc giá trị thật trong bundle deploy trước khi suy luận

Khi production hành xử khác local, việc đầu tiên là **trích giá trị thật** từ bundle đang
phục vụ (`scripts/extract-supabase-urls.mjs`, `scripts/compare-deployment-credentials.mjs`)
chứ không phải suy luận từ triệu chứng. Việc này đã mất rất nhiều lượt vì làm ngược.

### 6.8. `pnpm`/`npm` cache và sandbox

Nếu `npm install` báo `EPERM` với đường dẫn trong `AppData\Local\npm-cache`, đó là sandbox
chặn ghi ra ngoài workspace, không phải lỗi mạng. Cần cấp quyền rộng hơn cho đúng lệnh đó.

`next build` và `next dev` cần spawn tiến trình con với stdio dạng pipe; sandbox chặn và
báo `spawn EPERM`. Đây là giới hạn môi trường, không phải lỗi code.

### 6.9. Một rule được viết trong tài liệu không có nghĩa là nó đang chạy

**Đã xảy ra:** mục 3 của chính file này liệt kê "bắt buộc bởi lint" gồm cấm `any`, cấm `!`,
cấm promise trôi nổi, `===`, cấm throw literal. `eslint.config.mjs` khi đó vẫn là file mặc
định của Create Next App: **không rule nào trong số đó được bật**. `npm run lint` vẫn xanh,
nên không có gì gợi ý rằng tài liệu đang mô tả một hàng rào không tồn tại.

Đúng lúc bật lên thì lộ ra ba lỗi thật đang nằm trong code: hai chỗ truyền hàm `async` vào
`onClick`/`onChange` (React bỏ qua promise, lỗi thành unhandled rejection), và một `!` non-null
trong `lib/session.ts`.

**Quy tắc:** khi tài liệu nói "lint chặn X", phải kiểm bằng
`npx eslint --print-config <file>` chứ không đọc tài liệu. Và một bộ test chỉ chạy khi có
người nhớ ra thì không phải là bộ test — nó phải nằm trong CI.

### 6.10. Hai agent cùng làm trong một thư mục là không an toàn

**Đã xảy ra:** hai phiên làm việc song song trong cùng thư mục này, mỗi phiên một nhánh.
Một phiên chạy `git stash push -u` để chuyển nhánh — lệnh đó quét sạch **toàn bộ** việc
chưa commit của phiên kia, gồm 8 file và một migration untracked. May là khôi phục được
nguyên byte từ chính stash đó.

**Vì sao nhánh không giúp gì:** một repo chỉ có **một** thư mục làm việc và **một** index.
Nhánh chỉ là con trỏ tới commit. `git checkout` đổi nội dung file ngay tại chỗ, nên hai
phiên ở hai nhánh vẫn giẫm lên nhau: `git status` không phân biệt được file của ai,
`git add -A` nuốt hết, và `stash`/`restore` của phiên này xoá việc của phiên kia.

**Quy tắc:**

- **Mặc định một agent một lúc** cho mọi việc có ghi file hoặc ghi database. Rẻ nhất và an
  toàn nhất.
- Song song chỉ cho việc **chỉ đọc** — nghiên cứu, đọc code, phân tích. Subagent cũng dùng
  chung thư mục làm việc, nên luật này áp dụng y nguyên cho chúng.
- Nếu thật sự cần hai luồng ghi thì dùng `git worktree`, mỗi worktree một thư mục riêng:

```bash
git worktree add .worktrees/web-push -b feat/web-push-notifications
```

  Mỗi worktree cần `npm ci` riêng, copy `.env.local` riêng, `.next/` riêng —
  `node_modules` và biến môi trường **không** được chia sẻ. `.worktrees/` đã có trong
  `.gitignore`. Worktree phải nằm **trong** thư mục dự án, vì sandbox chỉ cho ghi ở đó.

- **Điều worktree không cứu được: database.** Hai worktree vẫn trỏ vào cùng một project
  Supabase — project thật của gia đình. Hai phiên chạy test cùng lúc sẽ giẫm lên fixture
  của nhau, và `cleanup-fixtures.mjs --apply` của phiên này xoá row của phiên kia. Đây
  đúng là cơ chế đã từng xoá mất liên kết đăng nhập của một bé thật (mục 6.1). Muốn chạy
  song song thật thì phải có **project Supabase thứ hai, dùng để vứt đi**, làm nơi chạy test.

### 6.11. Checksum migration phụ thuộc cả file lẫn lịch sử

`npm run db:migrate` băm nội dung file và báo `CHANGED since applied!` khi khác. Cảnh báo
đó nói **file đã đổi**, không nói database đã lệch — hai chuyện khác nhau, và đoán sai sẽ
tốn nhiều thời gian.

Kiểm tra thẳng cái cần kiểm:

```bash
node scripts/check-schema-drift.mjs
```

Script so **thân từng function** trong database với nội dung file migration. Chỉ so thân
hàm, vì Postgres lưu thân plpgsql nguyên văn nên so được chính xác, còn phần header mà
`pg_get_functiondef` dựng lại thì không (nó viết `integer` ở chỗ file viết `int`).

Lần gần nhất script báo **41/41 hàm khớp** trong khi ledger vẫn kêu `CHANGED` — nghĩa là
file bị sửa comment sau khi chạy, không phải database lệch.

### 6.12. PR có xung đột thì CI không chạy, và không có gì báo

**Đã xảy ra:** mở PR sau khi `main` đã nhận hai PR khác. Trang PR hiện "This branch has
conflicts that must be resolved", nhưng **không có check nào chạy** — không phải đỏ, mà là
không xuất hiện. GitHub chỉ tạo ref `refs/pull/N/merge` khi hợp nhất được, và workflow
`on: pull_request` chạy trên chính ref đó. Không hợp nhất được → không có ref → không có
workflow.

Triệu chứng này rất dễ đọc sai thành "CI chưa chạy xong". Nếu ngồi chờ thì chờ mãi.

**Quy tắc:** mở PR xong thì xem `mergeable_state` trước khi chờ CI. `dirty` nghĩa là có
xung đột, sửa trước:

```bash
node scripts/gh-pr.mjs status --number <N>
```

Vì branch protection bật "nhánh phải chứa `main` mới nhất", xung đột kiểu này sẽ còn gặp
lại mỗi khi `main` nhận một PR khác. Cách sửa: `git fetch origin main && git rebase origin/main`,
rồi `git push --force-with-lease=<nhánh>:<sha cũ>`.

### 6.13. Test chỉ chạy ở trạng thái chưa đăng nhập thì không kiểm được gì về người dùng thật

**Đã xảy ra:** tính năng "Đổi bé" hỏng hoàn toàn trên production. Bấm vào avatar của bé
kia thì **không có gì xảy ra** — URL đổi thành `/login?switchTo=ken159` rồi bị đá thẳng về
`/kid/dashboard`, nên nó trông như một liên kết chết.

Nguyên nhân: `proxy.ts` có luật "người đã đăng nhập thì không cần thấy màn đăng nhập", và
`pathname` **không** chứa query string, nên `?switchTo=...` chưa bao giờ được xét. Cả nút
"Đổi bé" lẫn avatar của anh chị em đều đi qua `/login`, nên cả hai đều chết.

Điều đáng ghi lại là **bộ test đã xanh suốt**: `test-deployed-profile-switch.mjs` kiểm
`/login?switchTo=...` — nhưng luôn bằng một lượt fetch **ẩn danh**. Mà người duy nhất dùng
luồng này là người **đã đăng nhập**. Nó kiểm tra đúng URL, đúng nội dung, sai trạng thái.

**Quy tắc:**

- **Kiểm tra màn hình ở đúng trạng thái mà người dùng thật đang ở.** Với app này, phần lớn
  màn hình chỉ có nghĩa khi *đã* đăng nhập. Một lượt fetch ẩn danh chỉ chứng minh được route
  công khai hoạt động.
- **"Màn hình mở ra" và "tính năng chạy" là hai khẳng định khác nhau.** Form thì phải
  **submit**. Next.js nhúng sẵn các field `$ACTION_*` trong form cho progressive enhancement,
  nên dựng lại đúng cú submit của browser là làm được, không cần trình duyệt — xem mục 6 của
  `test-deployed-profile-switch.mjs`, nơi gửi PIN của bé kia và kiểm tra cookie phiên đổi
  đúng sang bé đó.
- **Triệu chứng "bấm không có gì xảy ra" thường là một redirect về chính trang đang đứng.**
  Kiểm bằng `redirect: "manual"` để thấy mã 307 và `Location`, đừng chỉ `fetch` rồi đọc HTML.

### 6.14. `body.includes(...)` có thể khớp chữ trong payload RSC, không phải trên màn hình

**Đã xảy ra:** thêm kiểm tra "việc chưa làm nằm dưới tiêu đề nhóm của nó" bằng cách so vị
trí hai chuỗi trong HTML. Nó đỏ, trong khi tiêu đề nhóm **có** trên trang và đứng trước thẻ
việc. Vị trí in ra cho thấy tên việc ở 22971 còn tiêu đề nhóm ở 24728.

Nguyên nhân: Next stream dữ liệu đã dựng trang vào các thẻ `<script>` **nằm trong body**.
Tên việc xuất hiện trong cục dữ liệu đó trước khi nó xuất hiện trong HTML thật. Nên
`indexOf` đang so hai vị trí trong blob dữ liệu, không phải trong tài liệu.

Điều này cũng có nghĩa mọi `body.includes("...")` đều có thể xanh vì chữ nằm trong dữ liệu
chứ chưa chắc người dùng nhìn thấy.

**Quy tắc:** `get()` trong `test-e2e.mjs` trả thêm `rendered` — HTML đã bỏ `<script>`. Dùng
`rendered` cho mọi khẳng định về cái người dùng nhìn thấy, và cho mọi so sánh vị trí. Dùng
`body` khi cần kiểm tra chính dữ liệu được gửi xuống.

Một hệ quả nữa: nếu tiêu đề nhóm và nhãn trạng thái của thẻ trùng chữ (cả hai đều là
"Chưa làm"), thì đừng nhắm vào chữ. `kid-task-list.tsx` gắn `data-group="todo"` cho tiêu đề
để kiểm tra không phải đoán nó vừa tìm thấy cái nào.

---

## 7. Bảo mật khi thêm tính năng

Trước khi merge, tự hỏi:

- **Ai gọi được?** Function có kiểm tra vai trò chưa? `anon` có chạm tới được không?
- **Có tin tham số client không?** Nếu có, đó là lỗi.
- **Có rò rỉ dữ liệu không?** Trả về đúng trường cần thiết. `kid_siblings()` chỉ trả tên và
  username, cố ý **không** trả số điểm hay hash PIN.
- **Có chặn chéo gia đình không?** Mọi truy vấn phải lọc theo `family_id` của người gọi.
- **Thao tác ghi có idempotent không?** Bấm hai lần không được cộng điểm hai lần. Dùng
  điều kiện trạng thái trong `WHERE`, ví dụ `and status = 'SUBMITTED'`.
- **Có ghi log không?** Thay đổi điểm phải để lại `point_transactions`.

---

## 8. Ngôn ngữ và giao tiếp

- **Trả lời người dùng bằng tiếng Việt.**
- **Commit message bằng tiếng Việt**, theo dạng `loại: mô tả ngắn`, phần thân nói **vì sao**
  và ghi lại bẫy nếu có.
- **Khi không chắc, nói là không chắc.** Phân biệt rõ giữa "đã kiểm chứng" và "suy luận".
  Trong dự án này, nhiều kết luận sai đã được trình bày như sự thật và làm mất thời gian.
