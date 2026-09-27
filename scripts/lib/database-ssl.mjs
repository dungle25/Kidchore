/**
 * Whether to ask Postgres for TLS.
 *
 * Hosted Supabase requires TLS, and every suite here was written to say
 * `ssl: { rejectUnauthorized: false }` because that is what the real project needs.
 *
 * The local stack that `supabase start` brings up - which is how CI runs the suites with
 * no repository secret configured, see `.github/workflows/ci.yml` - does **not** speak TLS
 * at all, and node-postgres refuses the connection outright when asked:
 *
 *     The server does not support SSL connections
 *
 * That was measured against the local stack rather than assumed. So the question "does
 * this database want TLS" is answered from the connection string, in one place, instead of
 * each script hardcoding the hosted answer.
 */
export function sslForDatabase(connectionString) {
  // An explicit instruction in the URL wins: `?sslmode=disable` is how a caller says
  // "this endpoint has no TLS" for a host that is not obviously local.
  if (/[?&]sslmode=disable(&|$)/.test(String(connectionString ?? ""))) return false;

  try {
    const { hostname } = new URL(String(connectionString));
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) return false;
  } catch {
    // An unparseable URL falls through to the hosted answer; `pg` will report the real
    // problem with the string, which is a better error than one raised here.
  }

  return { rejectUnauthorized: false };
}
