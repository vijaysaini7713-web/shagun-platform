// Invite a family admin / viewer / counter staff to a wedding by email.
// Platform admins can invite any role; family admins can invite viewer + counter_staff only.
import { adminClient, callerUser, json, preflight, readJson } from "../_shared/util.ts";

type Body = { event_id: string; email: string; role: "family_admin" | "viewer" | "counter_staff" };
const ROLES = new Set(["family_admin", "viewer", "counter_staff"]);

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await callerUser(req);
  if (!caller) return json(req, { error: "login_required" }, 401);

  const b = await readJson<Body>(req);
  const email = String(b?.email ?? "").trim().toLowerCase();
  if (!b || !ROLES.has(b.role) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json(req, { error: "bad_request" }, 400);
  }

  const db = adminClient();
  const { data: can } = await db.rpc("svc_can_invite", { p_caller: caller.id, p_event: b.event_id, p_role: b.role });
  if (!can) return json(req, { error: "not_allowed" }, 403);

  const redirectTo = `${Deno.env.get("PUBLIC_BASE_URL") ?? ""}/login`;
  let userId: string | null = null;
  const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (invited.data?.user) {
    userId = invited.data.user.id;
  } else {
    // Already registered: look the user up without sending another email
    const link = await db.auth.admin.generateLink({ type: "magiclink", email });
    userId = link.data?.user?.id ?? null;
  }
  if (!userId) return json(req, { error: "invite_failed" }, 500);

  const { error } = await db.from("user_roles").upsert(
    { user_id: userId, event_id: b.event_id, role: b.role, invited_by: caller.id, invited_email: email },
    { onConflict: "user_id,event_id" },
  );
  if (error) return json(req, { error: "server_error" }, 500);

  await db.from("audit_logs").insert({
    event_id: b.event_id, user_id: caller.id, action: "member_invite", table_name: "user_roles",
    detail: { role: b.role, email_domain: email.split("@")[1] },
  });
  return json(req, { ok: true });
});
