/**
 * Safety helper for test cleanup.
 *
 * Several test scripts need to remove auth identities that `create_child` provisions
 * during the run. Deleting by the generated `@kidchore.local` address pattern is unsafe:
 * real children get identities with exactly the same address shape, so a test run would
 * unlink a real child and lock them out of their own account. That mistake was made once
 * and it broke a real child's sign-in, so cleanup is now based on a snapshot instead.
 *
 * Usage:
 *   const guard = await makeIdentityGuard(db);
 *   ... run the test ...
 *   await guard.removeCreated();   // only identities that appeared during the run
 */
import pg from "pg";

/** Addresses generated for children by migration 0005. */
export const GENERATED_CHILD_EMAIL_SUFFIX = "@kidchore.local";

/**
 * Takes a snapshot of existing auth identities and can later remove only those that were
 * not present at snapshot time.
 */
export async function makeIdentityGuard(db) {
  const before = await db.query("select id from auth.users");
  const known = new Set(before.rows.map((r) => r.id));

  return {
    /** How many identities existed before the run. */
    initialCount: known.size,

    /**
     * Deletes auth identities created during the run, and reports how many were removed.
     * Identities that existed beforehand are never touched, whatever their address looks
     * like.
     */
    async removeCreated() {
      const now = await db.query("select id, email from auth.users");
      const created = now.rows.filter((row) => !known.has(row.id));

      for (const row of created) {
        await db
          .query("delete from auth.identities where user_id = $1", [row.id])
          .catch(() => {});
        await db.query("delete from auth.users where id = $1", [row.id]).catch(() => {});
      }
      return created.length;
    },

    /** True when the given id existed before this run started. */
    existedBefore(id) {
      return known.has(id);
    },
  };
}

/** Convenience: opens a connection configured from .env.local. */
export async function connect(env) {
  const db = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  return db;
}
