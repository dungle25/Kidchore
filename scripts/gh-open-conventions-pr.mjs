/**
 * Opens the pull request for the conventions branch.
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-open-conventions-pr.mjs
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const head = "chore/conventions";
const base = "main";

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-pr",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

const body = `## Tóm tắt

Ba việc gộp trong một PR vì cùng chạm vào quy ước và CI.

### 1. Bộ quy ước dự án — \`CONVENTIONS.md\`

Tài liệu chuẩn, gồm bốn nguyên tắc bất di bất dịch, kiến trúc, code style, quy trình PR,
và **mục những bẫy đã thực sự gặp**. Mục cuối là phần đáng đọc nhất: mỗi mục là một lần
mất thời gian thật hoặc một lần làm hỏng dữ liệu thật, ghi lại để không lặp.

Ví dụ: dọn test theo mẫu email đã xoá identity của bé thật; \`/rest/v1\` dư trong URL
Supabase làm lỗi đăng nhập chỉ vào API key; script audit báo "đã bảo vệ" trên repo mà
push thẳng vẫn lọt.

### 2. CI đang bỏ sót 73 kiểm tra

Trước đây CI chỉ chạy \`test:db\` và \`test:e2e\`. Bốn bộ còn lại **chưa bao giờ chạy**:
onboarding (13), storage (10), reports (32), award (18). Một bộ test không được chạy thì
không bảo vệ được gì.

- \`scripts/test-all.mjs\` chạy mọi bộ database test trong một lệnh, có bảng tổng kết và
  ghi vào \`$GITHUB_STEP_SUMMARY\`
- \`scripts/test-e2e.mjs\` nhận \`--start-server\`: tự build, tự khởi động, tự dừng
- Job \`integration\` gọi \`npm run test:all\`

### 3. Phạt nhanh (−1 / −3 / −5) trên thẻ từng bé

Bổ sung cho thưởng nhanh đã có. Vài quyết định thiết kế đáng nêu:

- **Không bao giờ clamp.** \`points_balance\` có \`CHECK (>= 0)\`, nên trừ quá số dư bị
  database từ chối. Thẻ **khoá nút vượt quá số dư** kèm lý do hiện ngay dưới hàng, thay
  vì âm thầm biến "−5" thành "−2". Clamp sẽ đẩy quyết định số điểm về phía client và ghi
  một dòng log không khớp điều bố/mẹ yêu cầu — đúng lỗ hổng mà CONVENTIONS §1.3 đóng lại.
  Không bị kẹt: "−1" luôn bật khi số dư > 0, nên luôn trừ được về đúng 0.
- **Không bắt gõ lý do**, để giữ đúng chữ "nhanh". Đánh đổi có thật: lịch sử ghi *cái gì*
  chứ không ghi *vì sao*. Form đầy đủ ở mục Gia đình vẫn là chỗ cho khoản trừ cần giải
  thích để bé đọc được.
- **Undo một chạm** sau mỗi lần phạt, vì bấm nhầm trên tablet dùng chung là chuyện thật.
  Undo ghi một transaction bù, **không** sửa log, nên sai sót vẫn nhìn thấy được.
- **Số dư lấy từ câu trả lời của database**, không tự cộng ở local, nên hai bố/mẹ cùng
  tiêu điểm trên hai thiết bị không thể làm thẻ hiện số dư bé chưa từng có.

## Đã kiểm tra

- [x] \`npm run lint\` sạch
- [x] \`npm run typecheck\` sạch
- [x] \`npm run validate:ci\` — 55/55
- [x] \`npm run test:all --quick\` — 5/5 bộ, **100 kiểm tra** pass
- [x] \`test:quick-award\` mở rộng lên **41 kiểm tra**, gồm phạt vượt số dư, bé không tự
      trừ điểm được, và không phạt chéo gia đình

Bộ HTTP cần build nên không chạy được trong sandbox local (\`spawn EPERM\`); nó chạy trên
GitHub runner.

## Ghi chú cho người review

Commit bị gộp: phần phạt nhanh và phần quy ước nằm chung một commit vì được làm song song.
Nếu muốn lịch sử sạch hơn, tôi có thể tách thành hai commit.

Hai kiểm tra mới được thêm để lỗi cấu hình không im lặng lặp lại:
- \`validate-ci.mjs\` kiểm tra mọi \`npm run <script>\` trong workflow có tồn tại
- \`check-auto-approve-condition.mjs\` đánh giá điều kiện auto-approve trên CI run thật,
  vì điều kiện sai làm job bị skip **không kèm lỗi**
`;

async function api(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers, ...init });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const existing = await api(`/repos/${repo}/pulls?head=dungle25:${head}&state=open`);
if (Array.isArray(existing.data) && existing.data.length > 0) {
  for (const pr of existing.data) console.log(`PR already open: #${pr.number} ${pr.html_url}`);
  process.exit(0);
}

const created = await api(`/repos/${repo}/pulls`, {
  method: "POST",
  body: JSON.stringify({
    title: "docs: bộ quy ước dự án + đưa 73 kiểm tra bị bỏ sót vào CI + phạt nhanh",
    body,
    head,
    base,
  }),
});

if (created.status === 201) {
  console.log(`PR created: #${created.data.number}`);
  console.log(`  ${created.data.html_url}`);
} else {
  console.error(`Failed: HTTP ${created.status}`);
  console.error(JSON.stringify(created.data, null, 2));
  process.exit(1);
}
