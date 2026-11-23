import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { callFunction, supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Button, Card, ErrorNote, Field, Input, StatusBadge } from "../../components/ui";
import { TopBar } from "../admin/Home";
import { guestUrl } from "../admin/Settings";

interface Row {
  id: string; code: string; bride_name: string; groom_name: string; event_date: string; status: string;
  guests: number; entries: number; pending_utr: number; members: number;
}

export default function SuperAdmin() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ code: "", bride: "", groom: "", date: "", venue: "", deleteAfter: "", adminEmail: "" });
  const [inviteFor, setInviteFor] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("platform_overview");
    setRows((data ?? []) as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!auth.isPlatformAdmin) return <Navigate to="/app" replace />;

  async function create() {
    setErr(null);
    const { data: id, error } = await supabase.rpc("create_event", {
      p_code: f.code.trim().toLowerCase(), p_bride: f.bride.trim(), p_groom: f.groom.trim(),
      p_date: f.date, p_venue: f.venue.trim() || null, p_delete_after: f.deleteAfter || null,
    });
    if (error) return setErr(error.message);
    if (f.adminEmail) {
      try {
        await callFunction("invite-member", { event_id: id, email: f.adminEmail, role: "family_admin" });
      } catch {
        setErr(t("errors.not_allowed"));
      }
    }
    setF({ code: "", bride: "", groom: "", date: "", venue: "", deleteAfter: "", adminEmail: "" });
    void load();
  }

  async function inviteAdmin(eventId: string) {
    const email = inviteFor[eventId];
    if (!email) return;
    try {
      await callFunction("invite-member", { event_id: eventId, email, role: "family_admin" });
      setInviteFor((s) => ({ ...s, [eventId]: "" }));
      void load();
    } catch {
      setErr(t("errors.not_allowed"));
    }
  }

  const codeOk = /^[a-z0-9-]{4,40}$/.test(f.code);

  return (
    <div className="min-h-screen bg-maroon-50">
      <TopBar email={auth.session?.user.email ?? ""} title={t("super.title")} />
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">{t("super.new_wedding")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("super.code")}><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></Field>
            <Field label={t("super.bride")}><Input value={f.bride} onChange={(e) => setF({ ...f, bride: e.target.value })} /></Field>
            <Field label={t("super.groom")}><Input value={f.groom} onChange={(e) => setF({ ...f, groom: e.target.value })} /></Field>
            <Field label={t("super.date")}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label={t("super.venue")}><Input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></Field>
            <Field label={t("super.delete_after")}><Input type="date" value={f.deleteAfter} onChange={(e) => setF({ ...f, deleteAfter: e.target.value })} /></Field>
            <Field label={t("super.family_admin_email")}><Input type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
          </div>
          {f.code && <p className="font-mono text-sm text-gray-600">{guestUrl(f.code)}</p>}
          <ErrorNote>{err}</ErrorNote>
          <Button disabled={!codeOk || !f.bride || !f.groom || !f.date} onClick={create}>{t("super.new_wedding")}</Button>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-bold">{t("super.weddings")}</h2>
          <p className="mb-3 text-sm text-gray-600">{t("super.counts_only")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr><th className="px-2 py-2">Wedding</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Guests</th><th className="px-2 py-2">Entries</th><th className="px-2 py-2">UTR pending</th><th className="px-2 py-2">{t("super.invite_admin")}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-2 py-2"><span className="font-semibold">{r.bride_name} ♥ {r.groom_name}</span><span className="block font-mono text-xs text-gray-500">/w/{r.code}</span></td>
                    <td className="px-2 py-2">{r.event_date}</td>
                    <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-2 py-2">{r.guests}</td>
                    <td className="px-2 py-2">{r.entries}</td>
                    <td className="px-2 py-2">{r.pending_utr}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <input type="email" className="min-h-[36px] w-44 rounded border px-2" placeholder="email" value={inviteFor[r.id] ?? ""}
                          onChange={(e) => setInviteFor((s) => ({ ...s, [r.id]: e.target.value }))} />
                        <Button className="!min-h-[36px] !px-3 text-sm" onClick={() => inviteAdmin(r.id)}>+</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
