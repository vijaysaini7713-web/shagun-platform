// Guest submits UTR / transaction ID after paying by UPI or bank transfer.
// Proof of ownership = the one-time secret returned by guest-submit (only its hash is stored).
import { adminClient, ipHash, json, preflight, readJson, sha256Hex } from "../_shared/util.ts";

type Body = {
  contribution_id: string;
  secret: string;
  amount_rupees: number;
  utr: string;
  method: "direct_upi" | "bank_transfer";
  with_screenshot?: boolean;
};

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const b = await readJson<Body>(req);
  if (!b) return json(req, { error: "bad_request" }, 400);

  const amount = Number(b.amount_rupees);
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return json(req, { error: "invalid_amount" }, 400);
  const method = b.method === "bank_transfer" ? "bank_transfer" : "direct_upi";
  const utr = String(b.utr ?? "").trim().toUpperCase();
  const utrOk = method === "direct_upi" ? /^\d{12}$/.test(utr) : /^[A-Z0-9]{8,22}$/.test(utr);
  if (!utrOk) return json(req, { error: "invalid_utr" }, 400);
  if (typeof b.secret !== "string" || b.secret.length < 20) return json(req, { error: "not_allowed" }, 403);

  const db = adminClient();
  const { data: rate } = await db.rpc("svc_rate_hit", {
    p_bucket: "utr", p_event: null, p_ip_hash: await ipHash(req), p_mobile_hash: null, p_window_minutes: 10,
  });
  if ((rate as { total: number })?.total > 15) return json(req, { error: "too_many_requests" }, 429);

  const { data, error } = await db.rpc("svc_claim_utr", {
    p_contribution: String(b.contribution_id ?? ""),
    p_secret_hash: await sha256Hex(b.secret),
    p_amount_paise: amount * 100,
    p_utr: utr,
    p_method: method,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("utr_already_used")) return json(req, { error: "utr_already_used" }, 409);
    if (msg.includes("already_claimed")) return json(req, { error: "already_claimed" }, 409);
    if (msg.includes("not_allowed")) return json(req, { error: "not_allowed" }, 403);
    return json(req, { error: "server_error" }, 500);
  }

  const { event_id } = data as { event_id: string; payment_id: string };
  let upload = null;
  if (b.with_screenshot) {
    const path = `${event_id}/${b.contribution_id}/payment_screenshot-${crypto.randomUUID()}.jpg`;
    const { data: up } = await db.storage.from("shagun-media").createSignedUploadUrl(path);
    if (up) {
      await db.rpc("svc_attach_media", {
        p_event: event_id, p_contribution: b.contribution_id, p_kind: "payment_screenshot", p_path: path, p_user: null,
      });
      upload = { path, token: up.token };
    }
  }
  return json(req, { status: "claimed", upload });
});
