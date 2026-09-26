/**
 * Audits the branch protections on main and reports whether they actually protect it.
 *
 * This exists because a previous version of this check reported "main is protected" on a
 * repository where a direct push to main still succeeded. It read the ruleset list and the
 * classic protection object, both of which looked right, and never considered that the
 * ruleset could carry a bypass list naming the owner. The protections were documented but
 * not enforced, and the false reassurance cost real time.
 *
 * So the audit now asks three separate questions and reports each one:
 *   1. What rules exist?
 *   2. Who is allowed to bypass them?
 *   3. Does a direct push to main actually get refused?  (optional, with --probe)
 *
 * Usage:
 *   $env:GITHUB_TOKEN='...'; node scripts/audit-branch-protection.mjs
 *   $env:GITHUB_TOKEN='...'; node scripts/audit-branch-protection.mjs --probe
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const branch = "main";
const probe = process.argv.includes("--probe");

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-protection-audit",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body };
}

const findings = [];
function record(severity, message) {
  findings.push({ severity, message });
}

// ---------------------------------------------------------------- 1. rulesets
console.log("=== 1. rulesets ===");
const rulesets = await api(`/repos/${repo}/rulesets`);
let anyBypass = false;

if (Array.isArray(rulesets.body) && rulesets.body.length > 0) {
  for (const summary of rulesets.body) {
    const detail = await api(`/repos/${repo}/rulesets/${summary.id}`);
    console.log(
      `  #${summary.id} "${summary.name}"  enforcement=${summary.enforcement}`
    );
    if (detail.status !== 200) {
      console.log(`    could not read detail: HTTP ${detail.status}`);
      continue;
    }

    const refs = detail.body.conditions?.ref_name;
    if (refs) {
      console.log(
        `    refs: include=${JSON.stringify(refs.include)} exclude=${JSON.stringify(refs.exclude ?? [])}`
      );
    }

    const rules = detail.body.rules ?? [];
    for (const rule of rules) {
      const params = rule.parameters ?? {};
      if (rule.type === "pull_request") {
        console.log(
          `    rule: pull_request (approvals required: ${params.required_approving_review_count ?? 0})`
        );
      } else if (rule.type === "required_status_checks") {
        const contexts = (params.required_status_checks ?? []).map((c) => c.context);
        console.log(`    rule: required_status_checks -> ${JSON.stringify(contexts)}`);
      } else if (rule.type === "non_fast_forward") {
        console.log("    rule: non_fast_forward (blocks force pushes)");
      } else {
        console.log(`    rule: ${rule.type}`);
      }
    }

    // The part that was missed before: who may ignore all of the above.
    const bypass = detail.body.bypass_actors ?? [];
    if (bypass.length === 0) {
      console.log("    bypass actors: (none)");
    } else {
      anyBypass = true;
      console.log(`    bypass actors: ${bypass.length}`);
      for (const actor of bypass) {
        console.log(
          `      actor_type=${actor.actor_type} actor_id=${actor.actor_id} bypass_mode=${actor.bypass_mode}`
        );
      }
      console.log("");
      console.log("    PUBLIC repository, so actor_id is the numeric id of a user, team or app.");
      console.log("    A bypass listing a person or the repository admin role means the rules");
      console.log("    above are advisory for that actor: they can still push to main directly.");
      record(
        "warning",
        `ruleset "${summary.name}" has ${bypass.length} bypass actor(s), so its rules are not enforced for them`
      );
    }
  }
} else {
  console.log("  (none)");
}

// ------------------------------------------------- 2. classic branch protection
console.log("\n=== 2. classic branch protection ===");
const protection = await api(`/repos/${repo}/branches/${branch}/protection`);
if (protection.status === 200) {
  const p = protection.body;
  console.log(`  required status checks : ${JSON.stringify(p.required_status_checks?.contexts ?? [])}`);
  console.log(`  branch must be current : ${p.required_status_checks?.strict}`);
  console.log(
    `  required approvals     : ${p.required_pull_request_reviews?.required_approving_review_count ?? 0}`
  );
  console.log(`  force pushes allowed   : ${p.allow_force_pushes?.enabled}`);
  console.log(`  deletions allowed      : ${p.allow_deletions?.enabled}`);
  console.log(`  applies to admins too  : ${p.enforce_admins?.enabled}`);

  if (p.enforce_admins?.enabled === false) {
    console.log("");
    console.log("  This is the setting that decides whether the rules above actually stop a");
    console.log("  direct push. With it disabled, anyone with admin rights - which normally");
    console.log("  includes the repository owner - can push to this branch without a pull");
    console.log("  request and without the checks passing. The rules are then advisory.");
    console.log("");
    console.log("  Fix: Settings -> Branches -> the branch protection rule for main -> tick");
    console.log("       'Do not allow bypassing the above settings' and save.");
    record(
      "warning",
      "classic protection does not apply to administrators, so an admin can push to main directly and deploy without the checks"
    );
  } else if (p.enforce_admins?.enabled === true) {
    console.log("");
    console.log("  Administrators are held to these rules too, so a direct push is refused");
    console.log("  even for the repository owner.");
  }
} else if (protection.status === 404) {
  console.log("  not configured");
} else {
  console.log(`  could not read: HTTP ${protection.status}`);
}

// ------------------------------------------------------------- 3. the real test
console.log("\n=== 3. does a direct push to main actually get refused? ===");
if (!probe) {
  console.log("  skipped. Re-run with --probe to attempt it.");
  if (anyBypass) {
    console.log("");
    console.log("  Given the bypass actors above, a direct push is expected to SUCCEED.");
  }
} else {
  const head = await api(`/repos/${repo}/git/ref/heads/${branch}`);
  const tip = head.body?.object?.sha;
  console.log(`  current ${branch} tip: ${tip?.slice(0, 7)}`);
  console.log("");
  console.log("  A real attempt needs a git push, which this script cannot perform from");
  console.log("  here. Use this instead, and read the warning it prints:");
  console.log("");
  console.log("    git commit --allow-empty -m probe");
  console.log("    git push origin HEAD:main");
  console.log("");
  console.log("  If it prints 'Bypassed rule violations', the rules are not enforced for");
  console.log("  that actor. If it is rejected, the protection is real.");
}

// ------------------------------------------------------------------- summary
console.log("\n=== summary ===");
if (findings.length === 0) {
  console.log("  No weakness detected in the configuration that can be read from the API.");
  console.log("  This does NOT prove pushes are refused; run the probe above for that.");
} else {
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.message}`);
  }
  console.log("");
  console.log("  A rule that a bypass actor can ignore does not prevent anything. Remove the");
  console.log("  actor under Settings -> Rules -> the ruleset -> Bypass list.");
}

process.exit(0);
