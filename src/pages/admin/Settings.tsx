import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeCanvas } from "qrcode.react";
import { callFunction, supabase } from "../../lib/supabase";
import type { EventRow, Role } from "../../lib/types";
import { Button, Card, ErrorNote, Field, Input } from "../../components/ui";

interface Member { id: string; role: Role; invited_email: string | null; user_id: string }
interface PaySettings { payee_name: string; upi_id_masked: string | null; bank_name: string | null; bank_acc_masked: string | null; ifsc: string | null }

export function guestUrl(code: string) {
  const base = (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) || window.location.origin;
  return `${base.replace(/\/$/, "")}/w/${code}`;
}

export default function Settings({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const [ev, setEv] = useState<EventRow | null>(null);
  const [pay, setPay] = useState<PaySettings | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // payment form (never pre-filled with real values; only masked shown)
  const [payee, setPayee] = useState("");
  const [upi, setUpi] = useState("");
  const [bankName, setBankName] = useState("");
  const [acc, setAcc] = useState("");
  const [ifsc, setIfsc] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("counter_staff");
  const qrRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [{ data: e }, { data: p }, { data: m }] = await Promise.all([
      supabase.from("events").select("*").eq("id", eventId).single(),
      supabase.from("event_payment_settings").select("payee_name, upi_id_masked, bank_name, bank_acc_masked, ifsc").eq("event_id", eventId).maybeSingle(),
      supabase.from("user_roles").select("id, role, invited_email, user_id").eq("event_id", eventId),
    ]);
    setEv(e as EventRow);
    setPay(p as PaySettings | null);
    setMembers((m ?? []) as Member[]);
    if (p) setPayee((p as PaySettings).payee_name);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const flash = (s: string) => { setMsg(s); setTimeout(() => setMsg(null), 2000); };

  async function saveEvent() {
    if (!ev) return;
    setErr(null);
    const { error } = await supabase.rpc("update_event_settings", {
      p_event: eventId, p_status: ev.status, p_otp_mode: ev.otp_mode, p_form_open: ev.guest_form_open,
      p_welcome_hi: ev.welcome_text_hi, p_welcome_en: ev.welcome_text_en, p_theme: ev.theme_color, p_venue: ev.venue,
    });
    if (error) setErr(error.message); else flash(t("common.saved"));
  }

  async function savePayment() {
    setErr(null);
    const { error } = await supabase.rpc("set_payment_settings", {
      p_event: eventId, p_payee: payee.trim(), p_upi: upi.trim() || null, p_bank_name: bankName.trim() || null,
      p_account: acc.replace(/\s/g, "") || null, p_ifsc: ifsc.trim().toUpperCase() || null,
    });
    if (error) setErr(error.message.includes("Two-step") ? t("auth.mfa_required") : error.message);
    else { setUpi(""); setAcc(""); flash(t("common.saved")); void load(); }
  }

  async function invite() {
    setErr(null);
    try {
      await callFunction("invite-member", { event_id: eventId, email: inviteEmail, role: inviteRole });
      setInviteEmail("");
      flash(t("common.saved"));
      void load();
    } catch {
      setErr(t("errors.not_allowed"));
    }
  }

  async function remove(id: string) {
    await supabase.rpc("remove_member", { p_role_id: id });
    void load();
  }

  function downloadQr() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas || !ev) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `shagun-qr-${ev.code}.png`;
    a.click();
    void supabase.rpc("log_action", { p_event: eventId, p_action: "print_qr", p_detail: null });
  }

  if (!ev) return null;
  const url = guestUrl(ev.code);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && <p className="fixed bottom-4 right-4 z-50 rounded-lg bg-green-700 px-4 py-2 text-white">{msg}</p>}
      <div className="lg:col-span-2"><ErrorNote>{err}</ErrorNote></div>

      <Card className="space-y-3">
        <h3 className="font-bold">{t("settings.qr")}</h3>
        <div ref={qrRef} className="flex justify-center"><QRCodeCanvas value={url} size={240} includeMargin /></div>
        <p className="break-all text-center font-mono text-sm">{url}</p>
        <p className="text-center text-sm text-gray-600">{t("settings.qr_note")}</p>
        <Button className="w-full" onClick={downloadQr}>{t("settings.qr_download")}</Button>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-bold">{t("settings.event")}</h3>
        <Field label={t("settings.status")}>
          <select className="min-h-[44px] w-full rounded-lg border px-2" value={ev.status} onChange={(e) => setEv({ ...ev, status: e.target.value })}>
            {["draft", "upcoming", "live", "completed", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("settings.otp_mode")}>
          <select className="min-h-[44px] w-full rounded-lg border px-2" value={ev.otp_mode} onChange={(e) => setEv({ ...ev, otp_mode: e.target.value as EventRow["otp_mode"] })}>
            <option value="off">{t("settings.otp_off")}</option>
            <option value="smart">{t("settings.otp_smart")}</option>
            <option value="always">{t("settings.otp_always")}</option>
          </select>
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={ev.guest_form_open} onChange={(e) => setEv({ ...ev, guest_form_open: e.target.checked })} />
          {t("settings.form_open")}
        </label>
        <Field label={t("settings.welcome_hi")}>
          <Input value={ev.welcome_text_hi ?? ""} maxLength={300} onChange={(e) => setEv({ ...ev, welcome_text_hi: e.target.value })} />
        </Field>
        <Field label={t("settings.welcome_en")}>
          <Input value={ev.welcome_text_en ?? ""} maxLength={300} onChange={(e) => setEv({ ...ev, welcome_text_en: e.target.value })} />
        </Field>
        <Button onClick={saveEvent}>{t("common.save")}</Button>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-bold">{t("settings.payment")}</h3>
        {pay && (
          <p className="rounded-lg bg-gray-50 p-2 text-sm">
            {t("settings.current")}: {pay.payee_name} · {pay.upi_id_masked ?? "—"} · {pay.bank_name ?? ""} {pay.bank_acc_masked ?? ""} {pay.ifsc ?? ""}
          </p>
        )}
        <Field label={t("settings.payee")}><Input value={payee} maxLength={100} onChange={(e) => setPayee(e.target.value)} /></Field>
        <Field label={t("settings.upi")}><Input value={upi} placeholder="name@okhdfcbank" onChange={(e) => setUpi(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("settings.bank_name")}><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
          <Field label={t("settings.ifsc")}><Input value={ifsc} maxLength={11} onChange={(e) => setIfsc(e.target.value)} /></Field>
        </div>
        <Field label={t("settings.account")}><Input value={acc} inputMode="numeric" maxLength={18} onChange={(e) => setAcc(e.target.value.replace(/\D/g, ""))} /></Field>
        <Button disabled={payee.trim().length < 2 || (!upi && !acc)} onClick={savePayment}>{t("common.save")}</Button>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-bold">{t("settings.team")}</h3>
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span>{m.invited_email ?? m.user_id.slice(0, 8)} · {t(`app.role.${m.role}`)}</span>
              {m.role !== "family_admin" && <button onClick={() => remove(m.id)} className="font-semibold text-red-700">{t("settings.remove")}</button>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input type="email" className="flex-1" placeholder={t("settings.invite_email")} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <select className="min-h-[48px] rounded-lg border px-2" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
            <option value="counter_staff">{t("app.role.counter_staff")}</option>
            <option value="viewer">{t("app.role.viewer")}</option>
          </select>
          <Button disabled={!inviteEmail.includes("@")} onClick={invite}>{t("settings.invite")}</Button>
        </div>
      </Card>
    </div>
  );
}
