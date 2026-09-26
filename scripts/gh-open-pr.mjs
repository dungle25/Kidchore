/**
 * Opens the pull request for the profile-switcher branch.
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-open-pr.mjs
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const head = "feat/profile-switcher";
const base = "main";

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-pr",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

const body = `## Tóm tắt

Hai việc: tính năng chuyển nhanh profile giữa các bé, và một bản sửa an toàn dữ liệu
quan trọng.

### 1. Chuyển nhanh profile giữa các bé

Trẻ dùng chung iPad nên cần đổi profile nhanh. **Chuyển profile vẫn phải nhập PIN** —
nếu cho chuyển không cần PIN thì bé này mở được profile bé kia và tiêu hết điểm của bạn
ấy, đúng thứ mà PIN sinh ra để ngăn.

- Trang đăng nhập nhận \`?switchTo=<username>\`, thu hẹp còn đúng bé đó, tự focus ô PIN,
  ẩn phần Google, có link "Chọn bé khác".
- Trong khu của bé có dải avatar "Đổi sang bé khác".
- Nav dưới hiện "Đang dùng: <tên>" và thêm nút "Đổi bé".
- Form PIN tách thành component dùng chung cho cả đăng nhập và chuyển profile.

### 2. Sửa lỗi cleanup test xoá tài khoản thật

Cleanup của các script test xoá auth identity theo mẫu địa chỉ:

\`\`\`sql
delete from auth.users where email like '%@kidchore.local'
\`\`\`

Nhưng \`create_child\` cấp identity cho **mọi** bé với đúng mẫu địa chỉ đó. Nên mỗi lần
chạy test là một lần xoá identity của bé thật — hậu quả thực tế là bé **Ken** của gia
đình mất liên kết đăng nhập và không vào được bằng PIN.

Sửa gốc: cleanup dựa trên **ảnh chụp** danh sách identity lúc bắt đầu, chỉ xoá những
identity xuất hiện trong lần chạy. Identity có trước luôn được giữ, bất kể địa chỉ trông
thế nào. Đã sửa tài khoản bé và kiểm chứng: chạy cả 3 bộ test xong, identity của cả hai
bé thật vẫn còn nguyên.

Thêm 3 script hỗ trợ:
- \`cleanup-fixtures.mjs\` — mặc định chỉ báo cáo, phải \`--apply\` mới xoá, in rõ tài khoản
  thật được bảo vệ
- \`repair-child-identity.mjs\` — sửa bé mất identity, mặc định chỉ báo cáo
- \`check-child-identity.mjs\` — báo cáo bé nào có PIN nhưng thiếu identity

### 3. Báo cáo, streak, huy hiệu (phần SRS còn thiếu — mới có SQL)

- \`child_daily_completion()\`, \`child_streaks()\`, \`parent_reports()\`, \`kid_achievements()\`
- Migration 0009 sửa bug thật trong \`child_streaks\`: bản đầu trả sai chuỗi hiện tại khi
  có một ngày chưa xong nằm giữa hai chuỗi. Test bắt được (\`current=1\` khi phải là 2).
- Huy hiệu được suy ra mỗi lần đọc, không lưu, nên không thể lệch với dữ liệu thật.
- **Chưa có giao diện** cho phần này; PR này chỉ có SQL và test.

## Đã kiểm tra

- [x] \`npm run lint\` sạch
- [x] \`npm run typecheck\` sạch
- [x] \`npm run build\` thành công
- [x] \`test:db\` — 27/27
- [x] \`test:onboarding\` — 13/13
- [x] \`test:storage\` — 10/10
- [x] \`test-reports-and-streaks\` — 32/32
- [x] Kiểm chứng thủ công: tài khoản của hai bé thật còn nguyên sau khi chạy test

## Checklist bảo mật

- [x] Không có secret nào bị commit
- [x] Không thêm quyền truy cập bảng trực tiếp; mọi ghi vẫn qua function \`SECURITY DEFINER\`
- [x] Danh tính lấy từ session, không từ tham số client
- [x] \`kid_siblings()\` chỉ trả anh chị em cùng gia đình và chỉ trường hiển thị — test kiểm
      tra nó không lộ hash PIN, không lộ số điểm, không lộ bé nhà khác
- [x] RLS còn hiệu lực
- [x] Chuyển profile vẫn bắt buộc PIN

## Ghi chú cho người review

Hai commit độc lập: \`320f5cb\` là tính năng chuyển profile, \`453c31d\` là bản sửa cleanup
test. Bản sửa cleanup nên được merge dù tính năng có bị hoãn, vì nó chặn việc test phá
dữ liệu thật.
`;

async function api(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers, ...init });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Already open?
const existing = await api(
  `/repos/${repo}/pulls?head=dungle25:${head}&state=open`
);
if (Array.isArray(existing.data) && existing.data.length > 0) {
  for (const pr of existing.data) {
    console.log(`PR already open: #${pr.number} ${pr.html_url}`);
  }
  process.exit(0);
}

const created = await api(`/repos/${repo}/pulls`, {
  method: "POST",
  body: JSON.stringify({
    title: "feat: chuyển nhanh profile giữa các bé + sửa cleanup test xoá tài khoản thật",
    body,
    head,
    base,
  }),
});

if (created.status === 201) {
  console.log(`PR created: #${created.data.number}`);
  console.log(`  ${created.data.html_url}`);
  console.log(`  ${created.data.head.ref} -> ${created.data.base.ref}`);
} else {
  console.error(`Failed: HTTP ${created.status}`);
  console.error(JSON.stringify(created.data, null, 2));
  console.error("");
  console.error("If this is a 403, the token lacks the 'Pull requests: Read and write'");
  console.error("permission. Open the PR manually instead:");
  console.error(`  https://github.com/${repo}/pull/new/${head}`);
  process.exit(1);
}
