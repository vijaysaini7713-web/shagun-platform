// Smart OTP for guests: send + verify. Codes are stored only as hashes, expire in 5 minutes,
// allow 5 attempts, and are rate limited per IP and per mobile.
import { adminClient, ipHash, json, preflight, randomOtp, readJson, sha256Hex } from "../_shared/util.ts";
import { isValidIndianMobile, normalizeMobile } from "../_shared/phone.ts";
import { sendOtpSms } from "../_shared/sms.ts";

type Body =
  | { action: "send"; event_code: string; mobile: string }
  | { action: "verify"; challenge_id: string; code: string };

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson<Body>(req);
  if (!body) return json(req, { error: "bad_request" }, 400);
  const db = adminClient();

  if (body.action === "send") {
    const mobile = normalizeMobile(String(body.mobile ?? ""));
    if (!isValidIndianMobile(mobile)) return json(req, { error: "invalid_mobile" }, 400);

    const { data: ev } = await db.rpc("svc_event_by_code", { p_code: String(body.event_code ?? "") }).maybeSingle();
    const event = ev as { id: string; is_open: boolean } | null;
    if (!event?.is_open) return json(req, { error: "event_closed" }, 404);

    const { data: mobileHash } = await db.rpc("svc_mobile_hash", { p_mobile: mobile });
    const ip = await ipHash(req);
    const { data: rate } = await db.rpc("svc_rate_hit", {
      p_bucket: "otp", p_event: event.id, p_ip_hash: ip, p_mobile_hash: mobileHash, p_window_minutes: 10,
    });
    if ((rate as { total: number })?.total > 6) return json(req, { error: "too_many_requests" }, 429);

    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("otp_challenges").select("id", { count: "exact", head: true })
      .eq("event_id", event.id).eq("mobile_hash", mobileHash).gte("created_at", since);
    if ((count ?? 0) >= 3) return json(req, { error: "too_many_requests" }, 429);

    const id = crypto.randomUUID();
    const code = randomOtp();
    const { error } = await db.from("otp_challenges").insert({
      id, event_id: event.id, mobile_hash: mobileHash,
      code_hash: await sha256Hex(`${id}:${code}`),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (error) return json(req, { error: "server_error" }, 500);

    const sent = await sendOtpSms(mobile, code);
    if (!sent.ok) return json(req, { error: "sms_failed", detail: sent.error }, 502);

    const devEcho = Deno.env.get("OTP_DEV_ECHO") === "true";
    return json(req, { challenge_id: id, ...(devEcho ? { dev_code: code } : {}) });
  }

  if (body.action === "verify") {
    const code = String(body.code ?? "");
    if (!/^\d{6}$/.test(code)) return json(req, { error: "invalid_code" }, 400);
    const { data: ch } = await db.from("otp_challenges")
      .select("id, attempts, expires_at, verified_at").eq("id", String(body.challenge_id ?? "")).maybeSingle();
    if (!ch) return json(req, { error: "not_found" }, 404);
    if (ch.verified_at) return json(req, { verified: true });
    if (new Date(ch.expires_at).getTime() < Date.now()) return json(req, { error: "expired" }, 410);
    if (ch.attempts >= 5) return json(req, { error: "too_many_attempts" }, 429);

    const ok = (await sha256Hex(`${ch.id}:${code}`)) ===
      (await db.from("otp_challenges").select("code_hash").eq("id", ch.id).single()).data?.code_hash;
    await db.from("otp_challenges").update({
      attempts: ch.attempts + 1, ...(ok ? { verified_at: new Date().toISOString() } : {}),
    }).eq("id", ch.id);
    return ok ? json(req, { verified: true }) : json(req, { error: "wrong_code", left: 4 - ch.attempts }, 401);
  }

  return json(req, { error: "bad_request" }, 400);
});
