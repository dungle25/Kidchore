/**
 * Validates the GitHub Actions workflow and PR template files.
 *
 * Parses the YAML to catch syntax errors before they reach GitHub, then checks the
 * structure that matters: that the workflow has jobs, that each job has the required
 * keys, and that expressions referenced in steps exist.
 *
 * Usage: node scripts/validate-ci.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const yaml = require("js-yaml");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

// ---- Workflow files ----
const workflowDir = path.join(root, ".github", "workflows");
const workflowFiles = existsSync(workflowDir)
  ? readFileSync
    ? (await import("node:fs")).readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))
    : []
  : [];

console.log("Workflow files:");
check("at least one workflow exists", workflowFiles.length > 0, `found ${workflowFiles.length}`);

for (const file of workflowFiles) {
  const full = path.join(workflowDir, file);
  const text = readFileSync(full, "utf8");

  let doc = null;
  try {
    // GitHub Actions treats the key `on` as a string, but YAML 1.1 parsers read it
    // as boolean true. Both are accepted by GitHub, so record which one we got.
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    check(`${file} parses as YAML`, false, error.message);
    continue;
  }

  console.log(`\n${file}`);
  check("parses as YAML", true);

  const triggers = doc.on ?? doc[true];
  check("declares triggers", Boolean(triggers), JSON.stringify(Object.keys(doc)));
  check("declares jobs", Boolean(doc.jobs), "");

  const jobs = doc.jobs ?? {};
  const jobNames = Object.keys(jobs);
  check("has at least one job", jobNames.length > 0, jobNames.join(", "));

  check("declares permissions", Boolean(doc.permissions), "least privilege should be explicit");
  check(
    "permissions are read-only by default",
    doc.permissions?.contents === "read",
    JSON.stringify(doc.permissions)
  );

  for (const [name, job] of Object.entries(jobs)) {
    check(`job "${name}" has runs-on`, Boolean(job["runs-on"]), "");
    check(`job "${name}" has steps`, Array.isArray(job.steps) && job.steps.length > 0, "");
    check(`job "${name}" sets a timeout`, Boolean(job["timeout-minutes"]), "");

    // Every step should be identifiable in the Actions UI.
    const unnamed = (job.steps ?? []).filter((s) => !s.name && !s.uses).length;
    check(`job "${name}" steps are all named`, unnamed === 0, `${unnamed} unnamed`);

    // A checkout must precede anything that reads the repository.
    const steps = job.steps ?? [];
    const checkoutIndex = steps.findIndex((s) => String(s.uses ?? "").includes("actions/checkout"));
    const nodeIndex = steps.findIndex((s) => String(s.uses ?? "").includes("actions/setup-node"));
    if (checkoutIndex >= 0 && nodeIndex >= 0) {
      check(`job "${name}" checks out before setting up Node`, checkoutIndex < nodeIndex, "");
    }
    // A job that installs must have a package manager available.
    const installs = steps.some((s) => /npm ci|npm install/.test(String(s.run ?? "")));
    if (installs) {
      check(`job "${name}" sets up Node before installing`, nodeIndex >= 0, "");
    }
  }

  // Any `if:` referencing an output must reference a step that produces it.
  const stepIds = new Set(
    Object.values(jobs)
      .flatMap((j) => j.steps ?? [])
      .map((s) => s.id)
      .filter(Boolean)
  );
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps ?? []) {
      const condition = String(step.if ?? "");
      for (const match of condition.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs/g)) {
        check(
          `job "${name}" references an existing step id "${match[1]}"`,
          stepIds.has(match[1]),
          `condition: ${condition}`
        );
      }
    }
  }
}

// ---- PR template ----
console.log("\nPull request template:");
const templatePath = path.join(root, ".github", "pull_request_template.md");
check("template exists", existsSync(templatePath));
if (existsSync(templatePath)) {
  // Normalise to NFC before matching: Vietnamese text in these files may be stored
  // with decomposed diacritics, which would otherwise never match a literal pattern.
  const template = readFileSync(templatePath, "utf8").normalize("NFC").replace(/^\uFEFF/, "");
  check("has a summary section", /^#{1,2}\s*Tóm tắt/im.test(template));
  check("has a security checklist", /Checklist bảo mật/i.test(template));
  check(
    "has checkboxes",
    (template.match(/- \[ \]/g) ?? []).length >= 10,
    `${(template.match(/- \[ \]/g) ?? []).length} boxes`
  );
  check("mentions the RLS rule", /RLS/.test(template));
  check("reminds about secrets", /secret/i.test(template));
  check("has a verification section", /Đã kiểm tra/i.test(template));
  check("has a migration section", /migration/i.test(template));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
