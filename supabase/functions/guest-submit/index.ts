// Guest (or counter staff in "assisted" mode) submits the form.
// Validates everything server-side, applies Smart OTP, rate limits, encrypts via DB functions,
// and returns tokens + signed photo upload URLs (+ payee details only when paying online).
import {
  adminClient, callerUser, cleanText, ipHash, json, preflight, randomSecret, readJson, sha256Hex,
} from "../_shared/util.ts";
import { normalizeMobile, suspiciousMobileReason } from "../_shared/phone.ts";

type Item = {
  type: "online" | "lifafa" | "gift";
  purpose?: "shagun" | "kanyadaan" | "aashirwad_gift";
  declared_amount_rupees?: number;
  description?: string;
  message?: string;
  with_photo?: boolean;
};
type Body = {
  event_code: string;
  name: string;
  mobile: string;
  side: "bride" | "groom" | "both";
  relation: string;
  relation_other?: string;
  city?: string;
  family_count?: number;
  language?: "hi" | "en";
  consent: boolean;
  items: Item[];
  otp_challenge_id?: string;
  assisted?: boolean;
};

const TYPES = new Set(["online", "lifafa", "gift"]);
const PURPOSES = new Set(["shagun", "kanyadaan", "aashirwad_gift"]);
const SIDES = new Set(["bride", "groom", "both"]);

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const b = await readJson<Body>(req);
  if (!b) return json(req, { error: "bad_request" }, 400);
  const db = adminClient();

  // ---- event
  const { data: ev } = await db.rpc("svc_event_by_code", { p_code: String(b.event_code ?? "") }).maybeSingle();
  const event = ev as { id: string; otp_mode: "off" | "smart" | "always"; is_open: boolean } | null;
  if (!event) return json(req, { error: "event_not_found" }, 404);

  // ---- assisted mode: only staff/admin of this event
  let assistedBy: string | null = null;
  if (b.assisted) {
    const user = await callerUser(req);
    if (!user) return json(req, { error: "login_required" }, 401);
    const { data: role } = await db.from("user_roles").select("role")
      .eq("user_id", user.id).eq("event_id", event.id).in("role", ["family_admin", "counter_staff"]).maybeSingle();
    if (!role) return json(req, { error: "not_allowed" }, 403);
    assistedBy = user.id;
  } else if (!event.is_open) {
    return json(req, { error: "event_closed" }, 403);
  }

  // ---- validate
  const name = cleanText(b.name, 80);
  const mobile = normalizeMobile(String(b.mobile ?? ""));
  const relation = cleanText(b.relation, 40);
  if (!name || name.length < 2) return json(req, { error: "invalid_name" }, 400);
  if (suspiciousMobileReason(mobile) === "invalid") return json(req, { error: "invalid_mobile" }, 400);
  if (!SIDES.has(b.side)) return json(req, { error: "invalid_side" }, 400);
  if (!relation) return json(req, { error: "invalid_relation" }, 400);
  if (b.consent !== true) return json(req, { error: "consent_required" }, 400);
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 3) return json(req, { error: "invalid_items" }, 400);

  const items = [];
  for (const it of b.items) {
    if (!TYPES.has(it.type)) return json(req, { error: "invalid_items" }, 400);
    const purpose = it.purpose && PURPOSES.has(it.purpose) ? it.purpose : "shagun";
    let paise: number | null = null;
    if (it.declared_amount_rupees !== undefined && it.declared_amount_rupees !== null) {
      const r = Number(it.declared_amount_rupees);
      if (!Number.isInteger(r) || r < 1 || r > 1_000_000) return json(req, { error: "invalid_amount" }, 400);
      paise = r * 100;
    }
    items.push({
      type: it.type, purpose, declared_amount_paise: paise,
      description: cleanText(it.description, 120), message: cleanText(it.message, 500),
      with_photo: it.with_photo === true && it.type !== "online",
    });
  }
  const familyCount = Number.isInteger(b.family_count) && b.family_count! >= 1 && b.family_count! <= 50 ? b.family_count : null;

  // ---- rate limit
  const { data: mobileHash } = await db.rpc("svc_mobile_hash", { p_mobile: mobile });
  const ip = await ipHash(req);
  const { data: rateRaw } = await db.rpc("svc_rate_hit", {
    p_bucket: "submit", p_event: event.id, p_ip_hash: ip, p_mobile_hash: mobileHash, p_window_minutes: 10,
  });
  const rate = rateRaw as { total: number; distinct_mobiles: number };
  if (!assistedBy && rate.total > 30) return json(req, { error: "too_many_requests" }, 429);

  // ---- Smart OTP
  let otpReason: string | null = null;
  if (!assistedBy) {
    if (event.otp_mode === "always") otpReason = "always";
    else if (event.otp_mode === "smart") {
      const fake = suspiciousMobileReason(mobile);
      const { data: seen } = await db.rpc("svc_mobile_seen", { p_event: event.id, p_mobile_hash: mobileHash });
      otpReason = fake ?? (seen ? "duplicate" : rate.distinct_mobiles >= 4 ? "many_numbers_same_device" : null);
    }
  }
  let otpVerified = false;
  if (otpReason) {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: ch } = b.otp_challenge_id
      ? await db.from("otp_challenges").select("id")
        .eq("id", b.otp_challenge_id).eq("event_id", event.id).eq("mobile_hash", mobileHash)
        .not("verified_at", "is", null).is("used_at", null).gte("created_at", since).maybeSingle()
      : { data: null };
    if (!ch) return json(req, { otp_required: true, reason: otpReason }, 409);
    await db.from("otp_challenges").update({ used_at: new Date().toISOString() }).eq("id", ch.id);
    otpVerified = true;
  }

  // ---- insert (encryption + token numbers happen inside the DB function)
  const secret = randomSecret();
  const { data: result, error } = await db.rpc("svc_submit_entry", {
    p_event: event.id, p_name: name, p_mobile: mobile, p_side: b.side, p_relation: relation,
    p_relation_other: cleanText(b.relation_other, 60), p_city: cleanText(b.city, 80), p_family_count: familyCount,
    p_language: b.language === "en" ? "en" : "hi", p_otp_verified: otpVerified, p_assisted_by: assistedBy,
    p_secret_hash: await sha256Hex(secret),
    p_items: items.map(({ with_photo: _w, ...rest }) => rest),
  });
  if (error || !result) return json(req, { error: "server_error" }, 500);

  const contributions = (result as { contributions: { id: string; token_no: string; type: string }[] }).contributions;

  // ---- signed upload URLs for gift / lifafa photos (valid ~2h, single object)
  const uploads: { contribution_id: string; path: string; token: string }[] = [];
  for (let i = 0; i < contributions.length; i++) {
    if (!items[i].with_photo) continue;
    const c = contributions[i];
    const path = `${event.id}/${c.id}/guest_photo-${crypto.randomUUID()}.jpg`;
    const { data: up } = await db.storage.from("shagun-media").createSignedUploadUrl(path);
    if (up) {
      await db.rpc("svc_attach_media", {
        p_event: event.id, p_contribution: c.id, p_kind: "guest_photo", p_path: path, p_user: assistedBy,
      });
      uploads.push({ contribution_id: c.id, path, token: up.token });
    }
  }

  // ---- payee details only for online shagun
  let payee = null;
  if (items.some((i) => i.type === "online")) {
    const { data } = await db.rpc("svc_event_payee", { p_event: event.id });
    payee = data;
  }

  return json(req, { contributions, secret, uploads, payee, otp_verified: otpVerified });
});
