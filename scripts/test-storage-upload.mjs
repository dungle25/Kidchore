/**
 * Verifies the proof-image storage path end to end against the real project.
 *
 * Uploads through the service-role client the way the Server Action does, confirms the
 * object is publicly readable, checks that the bucket's own limits reject an oversized
 * file, then removes what it created.
 *
 * Usage: node scripts/test-storage-upload.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = "proof-images";
const PREFIX = "__storage_test__";

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

/**
 * A minimal valid PNG (1x1 transparent pixel). Building it in code avoids committing a
 * binary fixture just for a test.
 */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const uploadedPaths = [];

try {
  // ---- 1. Upload a valid image ----
  console.log("1. Upload");
  const validPath = `${PREFIX}/pixel.png`;
  const up = await admin.storage.from(BUCKET).upload(validPath, PNG_1x1, {
    contentType: "image/png",
    upsert: true,
  });
  check("a PNG uploads successfully", !up.error, up.error?.message ?? "");
  if (!up.error) uploadedPaths.push(validPath);

  // ---- 2. The object is publicly readable ----
  console.log("\n2. Public read");
  const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(validPath);
  check("getPublicUrl returns a URL", Boolean(urlData?.publicUrl), urlData?.publicUrl ?? "");
  if (urlData?.publicUrl) {
    const res = await fetch(urlData.publicUrl);
    check(
      "the public URL serves the image without auth",
      res.status === 200 && (res.headers.get("content-type") ?? "").includes("image"),
      `status=${res.status} type=${res.headers.get("content-type")}`
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    check("the served bytes match what was uploaded", bytes.equals(PNG_1x1), `${bytes.length} bytes`);
  }

  // ---- 3. The bucket rejects a disallowed type ----
  console.log("\n3. Bucket-level validation");
  const textPath = `${PREFIX}/notanimage.txt`;
  const badType = await admin.storage
    .from(BUCKET)
    .upload(textPath, Buffer.from("hello"), { contentType: "text/plain", upsert: true });
  check(
    "a text file is rejected by allowed_mime_types",
    Boolean(badType.error),
    badType.error ? `rejected: ${badType.error.message.slice(0, 90)}` : "ACCEPTED (problem)"
  );
  if (!badType.error) uploadedPaths.push(textPath);

  // ---- 4. The bucket rejects an oversized file ----
  const big = Buffer.alloc(3 * 1024 * 1024, 1); // 3 MiB, limit is 2 MiB
  const oversize = await admin.storage
    .from(BUCKET)
    .upload(`${PREFIX}/big.jpg`, big, { contentType: "image/jpeg", upsert: true });
  check(
    "a 3MB file is rejected by file_size_limit",
    Boolean(oversize.error),
    oversize.error ? `rejected: ${oversize.error.message.slice(0, 90)}` : "ACCEPTED (problem)"
  );
  if (!oversize.error) uploadedPaths.push(`${PREFIX}/big.jpg`);

  // ---- 5. No storage policy means the publishable key is locked out ----
  console.log("\n4. Storage access control");
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonUpload = await anon.storage
    .from(BUCKET)
    .upload(`${PREFIX}/anon.png`, PNG_1x1, { contentType: "image/png", upsert: true });
  check(
    "the publishable key cannot upload",
    Boolean(anonUpload.error),
    anonUpload.error ? `blocked: ${anonUpload.error.message.slice(0, 90)}` : "ALLOWED (problem)"
  );

  const anonList = await anon.storage.from(BUCKET).list(PREFIX);
  const anonSawObjects = (anonList.data?.length ?? 0) > 0;
  check(
    "the publishable key cannot list objects",
    Boolean(anonList.error) || !anonSawObjects,
    anonList.error ? `blocked: ${anonList.error.message.slice(0, 90)}` : `listed ${anonList.data?.length}`
  );

  // ---- 6. Cleanup ----
  console.log("\n5. Cleanup");
  const listed = await admin.storage.from(BUCKET).list(PREFIX);
  const toRemove = (listed.data ?? []).map((o) => `${PREFIX}/${o.name}`);
  if (toRemove.length) {
    const del = await admin.storage.from(BUCKET).remove(toRemove);
    check("test objects removed", !del.error, del.error?.message ?? "");
  } else {
    check("test objects removed", true);
  }
  const after = await admin.storage.from(BUCKET).list(PREFIX);
  check(
    "nothing left behind",
    (after.data?.length ?? 0) === 0,
    `${after.data?.length ?? 0} object(s) remain`
  );
} finally {
  // Best-effort cleanup even if an assertion threw.
  const listed = await admin.storage.from(BUCKET).list(PREFIX).catch(() => ({ data: [] }));
  const remaining = (listed.data ?? []).map((o) => `${PREFIX}/${o.name}`);
  if (remaining.length) await admin.storage.from(BUCKET).remove(remaining).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
