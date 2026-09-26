import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/dal";

/**
 * Entry point. Sends each person to the area that matches their role, or to
 * sign-in when they have no session.
 */
export default async function Page() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  redirect(ctx.session.role === "PARENT" ? "/parent/dashboard" : "/kid/dashboard");
}
