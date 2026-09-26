/**
 * Appends a correction note to pull request #2, replacing the part of the description that
 * described the auto-approve workflow.
 *
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-update-pr2-body.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const pullNumber = 2;

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-pr-body",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

const current = await (
  await fetch(`https://api.github.com/repos/${repo}/pulls/${pullNumber}`, { headers })
).json();

const correction = `### Sửa lại: yêu cầu approval đặt bằng 0

PR này ban đầu kèm một workflow \`auto-approve\` để bot duyệt hộ. Chạy thật thì GitHub trả:

\`\`\`
failed to create review: GraphQL: GitHub Actions is not permitted to approve pull requests.
\`\`\`

**GitHub cấm GitHub Actions approve pull request.** Người thật cũng không tự approve PR
của mình được, nên cánh cửa đó đóng cả hai chiều. Workflow đã bị xoá, và
\`validate-ci.mjs\` giờ chặn việc thêm lại một bước như vậy.

Đổi lại: branch protection cần đặt **required approvals = 0**, chỉ giữ required status
checks. Cổng thật là CI, không phải review — và điều đó đúng ý định ban đầu.

Một chi tiết đáng nêu vì nó suýt làm tôi kết luận sai: job auto-approve báo **success**
dù bước approve thất bại, vì tôi để \`echo "::warning::"\` thay vì \`exit 1\`. Một bước
thất bại mà job xanh là cấu hình nói dối. Khi một bước có thể thất bại, hãy để nó fail job.

Toàn bộ nội dung còn lại của PR này vẫn đúng nguyên.
`;

// Replace everything from the first heading onwards with the corrected note, keeping the
// summary line above it.
const summaryLine = current.body.split("\n").slice(0, 3).join("\n");
const nextBody = `${summaryLine}\n${correction}`;

const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pullNumber}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ body: nextBody }),
});

console.log(`PATCH PR #${pullNumber} body -> HTTP ${res.status}`);

// Keep a copy locally so the text is reviewable without opening GitHub.
writeFileSync("pr2-body.md", nextBody, "utf8");
console.log("Wrote pr2-body.md for review.");

if (res.status !== 200) {
  console.error((await res.text()).slice(0, 400));
  process.exit(1);
}
