import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase, signedPhotoUrl } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { formatINR } from "../../lib/money";
import type { ContributionType, Side, Status } from "../../lib/types";
import { Button, Card, Spinner, StatusBadge } from "../../components/ui";
import { TopBar } from "./Home";
import Settings from "./Settings";

type Tab = "overview" | "entries" | "payments" | "lifafa" | "gifts" | "issues" | "activity" | "settings";

interface Summary {
  guests: number;
  online_verified_paise: number;
  online_pending_count: number;
  online_pending_paise: number;
  online_rejected_count: number;
  online_unpaid_count: number;
  lifafa_count: number;
  lifafa_received: number;
  lifafa_declared_paise: number;
  lifafa_counted_paise: number;
  lifafa_mismatch: number;
  gift_count: number;
  gift_received: number;
  by_side: Partial<Record<Side, number>>;
  by_relation: { relation: string; guests: number; online_paise: number }[];
}

interface Entry {
  id: string;
  token_no: string;
  type: ContributionType;
  purpose: string;
  declared_amount_paise: number | null;
  counted_amount_paise: number | null;
  status: Status;
  description: string | null;
  message: string | null;
  created_at: string;
  guest: { id: string; name: string; mobile_masked: string; side: Side; relation: string; city: string | null; otp_verified: boolean; assisted_by: string | null };
}

interface PaymentRow {
  id: string;
  contribution_id: string;
  token_no: string;
  guest_name: string;
  method: string;
  amount_paise: number;
  utr: string;
  status: Status;
  reject_reason: string | null;
  created_at: string;
}

interface Media { contribution_id: string; kind: string; storage_path: string }

export default function Dashboard() {
  const { eventId = "" } = useParams();
  const { t } = useTranslation();
  const auth = useAuth();
  const membership = auth.memberships.find((m) => m.event.id === eventId);
  const isAdmin = membership?.role === "family_admin";
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [activity, setActivity] = useState<{ id: number; action: string; created_at: string; detail: unknown; record_id: string | null }[]>([]);

  const load = useCallback(async () => {
    const [s, e, p, m] = await Promise.all([
      supabase.rpc("event_summary", { p_event: eventId }),
      supabase.from("contributions")
        .select("id, token_no, type, purpose, declared_amount_paise, counted_amount_paise, status, description, message, created_at, guest:guests(id, name, mobile_masked, side, relation, city, otp_verified, assisted_by)")
        .eq("event_id", eventId).order("created_at", { ascending: false }).limit(5000),
      supabase.rpc("admin_list_payments", { p_event: eventId }),
      supabase.from("media").select("contribution_id, kind, storage_path").eq("event_id", eventId),
    ]);
    setSummary(s.data as Summary);
    setEntries((e.data ?? []) as unknown as Entry[]);
    setPayments((p.data ?? []) as PaymentRow[]);
    setMedia((m.data ?? []) as Media[]);
    if (isAdmin) {
      const { data } = await supabase.from("audit_logs").select("id, action, created_at, detail, record_id")
        .eq("event_id", eventId).order("created_at", { ascending: false }).limit(300);
      setActivity(data ?? []);
    }
  }, [eventId, isAdmin]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20000);
    return () => clearInterval(iv);
  }, [load]);

  const photosByContribution = useMemo(() => {
    const map = new Map<string, Media[]>();
    for (const x of media) map.set(x.contribution_id, [...(map.get(x.contribution_id) ?? []), x]);
    return map;
  }, [media]);

  if (!membership) return <Navigate to="/app" replace />;
  if (membership.role === "counter_staff") return <Navigate to={`/app/e/${eventId}/counter`} replace />;

  const ev = membership.event;
  const tabs: Tab[] = ["overview", "entries", "payments", "lifafa", "gifts", "issues", ...(isAdmin ? (["activity", "settings"] as Tab[]) : [])];
  const issuesCount = summary
    ? summary.online_pending_count + summary.online_rejected_count + summary.lifafa_mismatch + summary.online_unpaid_count
    : 0;

  return (
    <div className="min-h-screen bg-maroon-50">
      <TopBar email={auth.session?.user.email ?? ""} title={`${ev.bride_name} ♥ ${ev.groom_name}`} />
      <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto bg-white px-2 py-2 shadow-sm">
        {tabs.map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${tab === k ? "bg-maroon-700 text-white" : "text-gray-700 hover:bg-maroon-50"}`}>
            {t(`admin.tabs.${k}`)}{k === "issues" && issuesCount > 0 ? ` (${issuesCount})` : ""}
          </button>
        ))}
      </nav>
      <main className="mx-auto max-w-7xl space-y-4 p-4">
        {!summary ? <Spinner /> : (
          <>
            {tab === "overview" && <Overview s={summary} />}
            {tab === "entries" && <Entries entries={entries} photos={photosByContribution} isAdmin={isAdmin} eventId={eventId} payments={payments} eventCode={ev.code} />}
            {tab === "payments" && <Payments rows={payments} isAdmin={isAdmin} reload={load} aal2={auth.aal === "aal2"} />}
            {tab === "lifafa" && <Lifafa entries={entries.filter((x) => x.type === "lifafa")} photos={photosByContribution} isAdmin={isAdmin} reload={load} />}
            {tab === "gifts" && <Gifts entries={entries.filter((x) => x.type === "gift")} photos={photosByContribution} />}
            {tab === "issues" && <Issues entries={entries} payments={payments} />}
            {tab === "activity" && <Activity rows={activity} />}
            {tab === "settings" && <Settings eventId={eventId} />}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <Card className={alert ? "ring-2 ring-red-300" : ""}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`text-2xl font-bold ${alert ? "text-red-700" : "text-maroon-800"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </Card>
  );
}

function Overview({ s }: { s: Summary }) {
  const { t } = useTranslation();
  const issues = s.online_pending_count + s.online_rejected_count + s.lifafa_mismatch + s.online_unpaid_count;
  const sides: Side[] = ["bride", "groom", "both"];
  const totalSide = sides.reduce((a, k) => a + (s.by_side[k] ?? 0), 0) || 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label={t("admin.cards.online")} value={formatINR(s.online_verified_paise)} />
        <Stat label={t("admin.cards.pending")} value={formatINR(s.online_pending_paise)} sub={`${s.online_pending_count}`} />
        <Stat label={t("admin.cards.lifafa")} value={String(s.lifafa_count)}
          sub={`${t("admin.counted")}: ${formatINR(s.lifafa_counted_paise)} · ${t("admin.declared")}: ${formatINR(s.lifafa_declared_paise)}`} />
        <Stat label={t("admin.cards.gifts")} value={String(s.gift_count)} sub={t("admin.received_of", { a: s.gift_received, b: s.gift_count })} />
        <Stat label={t("admin.cards.guests")} value={String(s.guests)} />
        <Stat label={t("admin.cards.issues")} value={String(issues)} alert={issues > 0} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold">{t("admin.by_side")}</h3>
          {sides.map((k) => (
            <div key={k} className="mb-2">
              <div className="flex justify-between text-sm"><span>{t(`guest.side_${k}`)}</span><span>{s.by_side[k] ?? 0}</span></div>
              <div className="h-3 rounded bg-maroon-100"><div className="h-3 rounded bg-maroon-700" style={{ width: `${((s.by_side[k] ?? 0) / totalSide) * 100}%` }} /></div>
            </div>
          ))}
        </Card>
        <Card>
          <h3 className="mb-3 font-bold">{t("admin.by_relation")}</h3>
          <table className="w-full text-sm">
            <tbody>
              {s.by_relation.map((r) => (
                <tr key={r.relation} className="border-b last:border-0">
                  <td className="py-1">{t(`guest.relations.${r.relation}`, { defaultValue: r.relation })}</td>
                  <td className="py-1 text-right">{r.guests}</td>
                  <td className="py-1 text-right font-semibold">{formatINR(r.online_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function PhotoThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { signedPhotoUrl(path).then(setUrl); }, [path]);
  if (!url) return <span className="inline-block h-12 w-12 rounded bg-gray-100" />;
  return (
    <>
      <img src={url} alt="" onClick={() => setOpen(true)} className="h-12 w-12 cursor-zoom-in rounded object-cover" />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)}>
          <img src={url} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

function Entries({ entries, photos, isAdmin, eventId, payments, eventCode }: {
  entries: Entry[]; photos: Map<string, Media[]>; isAdmin: boolean; eventId: string; payments: PaymentRow[]; eventCode: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [side, setSide] = useState<string>("");
  const [type, setType] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const payByContribution = useMemo(() => new Map(payments.map((p) => [p.contribution_id, p])), [payments]);

  const rows = entries.filter((e) =>
    (!side || e.guest.side === side) && (!type || e.type === type) &&
    (!q || e.guest.name.toLowerCase().includes(q.toLowerCase()) || e.token_no.toLowerCase().includes(q.toLowerCase())));

  async function reveal(guestId: string) {
    const { data, error } = await supabase.rpc("reveal_guest_mobile", { p_guest: guestId });
    if (!error && data) setRevealed((r) => ({ ...r, [guestId]: data as string }));
    else alert(t("admin.need_mfa_for_full"));
  }

  async function exportCsv() {
    const header = ["token", "name", "mobile", "side", "relation", "city", "type", "purpose", "status", "declared_rs", "counted_rs", "paid_rs", "description", "message", "time"];
    const lines = rows.map((e) => {
      const p = payByContribution.get(e.id);
      return [e.token_no, e.guest.name, e.guest.mobile_masked, e.guest.side, e.guest.relation, e.guest.city, e.type, e.purpose, e.status,
        e.declared_amount_paise != null ? e.declared_amount_paise / 100 : "", e.counted_amount_paise != null ? e.counted_amount_paise / 100 : "",
        p ? p.amount_paise / 100 : "", e.description, e.message, new Date(e.created_at).toLocaleString("en-IN")].map(csvCell).join(",");
    });
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shagun-${eventCode}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    await supabase.rpc("log_action", { p_event: eventId, p_action: "export_csv", p_detail: { rows: rows.length } });
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} className="min-h-[40px] flex-1 rounded-lg border px-3" />
        <select value={side} onChange={(e) => setSide(e.target.value)} className="min-h-[40px] rounded-lg border px-2">
          <option value="">{t("admin.filter_side")}: {t("common.all")}</option>
          {(["bride", "groom", "both"] as Side[]).map((s) => <option key={s} value={s}>{t(`guest.side_${s}`)}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="min-h-[40px] rounded-lg border px-2">
          <option value="">{t("admin.filter_type")}: {t("common.all")}</option>
          {(["online", "lifafa", "gift"] as ContributionType[]).map((s) => <option key={s} value={s}>{t(`guest.types.${s}`)}</option>)}
        </select>
        <Button variant="secondary" onClick={exportCsv}>{t("admin.export")}</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              {["token", "name", "mobile", "relation", "type", "amount", "filter_status", "photo", "time"].map((h) => (
                <th key={h} className="px-2 py-2">{t(`admin.${h}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const pay = payByContribution.get(e.id);
              const amount = pay?.amount_paise ?? e.counted_amount_paise ?? e.declared_amount_paise;
              return (
                <tr key={e.id} className="border-b align-middle">
                  <td className="px-2 py-2 font-mono font-semibold">{e.token_no}</td>
                  <td className="px-2 py-2">
                    {e.guest.name}
                    <span className="block text-xs text-gray-500">{t(`guest.side_${e.guest.side}`)}{e.guest.assisted_by ? " · assisted" : ""}{e.guest.otp_verified ? " · OTP ✓" : ""}</span>
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {revealed[e.guest.id] ?? e.guest.mobile_masked}
                    {isAdmin && !revealed[e.guest.id] && (
                      <button onClick={() => reveal(e.guest.id)} className="ml-1 text-xs text-maroon-700 underline">{t("admin.reveal")}</button>
                    )}
                  </td>
                  <td className="px-2 py-2">{t(`guest.relations.${e.guest.relation}`, { defaultValue: e.guest.relation })}</td>
                  <td className="px-2 py-2">{t(`guest.types.${e.type}`)}<span className="block text-xs text-gray-500">{t(`guest.purposes.${e.purpose}`)}</span></td>
                  <td className="px-2 py-2 font-semibold">{amount != null ? formatINR(amount) : "—"}</td>
                  <td className="px-2 py-2"><StatusBadge status={pay?.status ?? e.status} /></td>
                  <td className="px-2 py-2"><div className="flex gap-1">{(photos.get(e.id) ?? []).slice(0, 2).map((m) => <PhotoThumb key={m.storage_path} path={m.storage_path} />)}</div></td>
                  <td className="px-2 py-2 text-xs text-gray-500">{new Date(e.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-center text-gray-500">{t("admin.no_rows")}</p>}
      </div>
    </Card>
  );
}

function Payments({ rows, isAdmin, reload, aal2 }: { rows: PaymentRow[]; isAdmin: boolean; reload: () => void; aal2: boolean }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string>("claimed");
  async function act(id: string, approve: boolean) {
    const reason = approve ? null : prompt(t("admin.reject_reason")) ?? "";
    if (!approve && !reason) return;
    await supabase.rpc("admin_verify_payment", { p_payment: id, p_approve: approve, p_reason: reason });
    reload();
  }
  const shown = rows.filter((r) => !filter || r.status === filter);
  return (
    <Card className="space-y-3">
      {!aal2 && <p className="text-sm text-amber-800">{t("admin.need_mfa_for_full")}</p>}
      <div className="flex gap-2">
        {["claimed", "verified", "rejected", ""].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1 text-sm font-semibold ${filter === f ? "bg-maroon-700 text-white" : "bg-gray-100"}`}>
            {f ? t(`status.${f}`) : t("common.all")}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr><th className="px-2 py-2">{t("admin.token")}</th><th className="px-2 py-2">{t("admin.name")}</th><th className="px-2 py-2">{t("admin.amount")}</th><th className="px-2 py-2">{t("admin.utr")}</th><th className="px-2 py-2">{t("admin.filter_status")}</th><th className="px-2 py-2">{t("admin.time")}</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="px-2 py-2 font-mono">{p.token_no}</td>
                <td className="px-2 py-2">{p.guest_name}<span className="block text-xs text-gray-500">{p.method === "direct_upi" ? "UPI" : "Bank"}</span></td>
                <td className="px-2 py-2 font-semibold">{formatINR(p.amount_paise)}</td>
                <td className="px-2 py-2 font-mono">{p.utr}</td>
                <td className="px-2 py-2"><StatusBadge status={p.status} />{p.reject_reason && <span className="block text-xs text-red-700">{p.reject_reason}</span>}</td>
                <td className="px-2 py-2 text-xs text-gray-500">{new Date(p.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="px-2 py-2">
                  {isAdmin && p.status === "claimed" && (
                    <div className="flex gap-1">
                      <Button className="!min-h-[36px] !px-3 text-sm" onClick={() => act(p.id, true)}>{t("admin.verify")}</Button>
                      <Button variant="danger" className="!min-h-[36px] !px-3 text-sm" onClick={() => act(p.id, false)}>{t("admin.reject")}</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-4 text-center text-gray-500">{t("admin.no_rows")}</p>}
      </div>
    </Card>
  );
}

function Lifafa({ entries, photos, isAdmin, reload }: { entries: Entry[]; photos: Map<string, Media[]>; isAdmin: boolean; reload: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  async function save(id: string) {
    const r = Number(draft[id]);
    if (!Number.isInteger(r) || r < 0) return;
    await supabase.rpc("admin_set_counted_amount", { p_contribution: id, p_paise: r * 100 });
    reload();
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((e) => {
        const mismatch = e.declared_amount_paise != null && e.counted_amount_paise != null && e.declared_amount_paise !== e.counted_amount_paise;
        return (
          <Card key={e.id} className={`space-y-2 ${mismatch ? "ring-2 ring-red-300" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-lg font-bold">{e.token_no}</span>
              <StatusBadge status={e.status} />
            </div>
            <p className="font-semibold">{e.guest.name} <span className="text-sm font-normal text-gray-500">· {t(`guest.relations.${e.guest.relation}`, { defaultValue: e.guest.relation })}</span></p>
            <div className="flex gap-1">{(photos.get(e.id) ?? []).map((m) => <PhotoThumb key={m.storage_path} path={m.storage_path} />)}</div>
            <p className="text-sm">{t("admin.declared")}: {e.declared_amount_paise != null ? formatINR(e.declared_amount_paise) : "—"} · {t("admin.counted")}: {e.counted_amount_paise != null ? formatINR(e.counted_amount_paise) : "—"}</p>
            {mismatch && <p className="text-sm font-semibold text-red-700">{t("admin.mismatch")}</p>}
            {isAdmin && (
              <div className="flex gap-2">
                <input inputMode="numeric" placeholder="₹" value={draft[e.id] ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, [e.id]: ev.target.value.replace(/\D/g, "") }))}
                  className="min-h-[40px] w-28 rounded-lg border px-2" />
                <Button className="!min-h-[40px] text-sm" onClick={() => save(e.id)}>{t("admin.set_counted")}</Button>
              </div>
            )}
          </Card>
        );
      })}
      {entries.length === 0 && <p className="text-gray-500">{t("admin.no_rows")}</p>}
    </div>
  );
}

function Gifts({ entries, photos }: { entries: Entry[]; photos: Map<string, Media[]> }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {entries.map((e) => (
        <Card key={e.id} className="space-y-1 !p-3">
          <div className="flex gap-1">{(photos.get(e.id) ?? []).map((m) => <PhotoThumb key={m.storage_path} path={m.storage_path} />)}</div>
          <p className="font-mono font-bold">{e.token_no}</p>
          <p className="text-sm font-semibold">{e.guest.name}</p>
          {e.description && <p className="text-xs text-gray-600">{e.description}</p>}
          <StatusBadge status={e.status} />
        </Card>
      ))}
      {entries.length === 0 && <p className="text-gray-500">{t("admin.no_rows")}</p>}
    </div>
  );
}

function Issues({ entries, payments }: { entries: Entry[]; payments: PaymentRow[] }) {
  const { t } = useTranslation();
  const unpaid = entries.filter((e) => e.type === "online" && e.status === "pending");
  const claimed = payments.filter((p) => p.status === "claimed");
  const rejected = payments.filter((p) => p.status === "rejected" || p.status === "failed");
  const mismatch = entries.filter((e) => e.type === "lifafa" && e.declared_amount_paise != null && e.counted_amount_paise != null && e.declared_amount_paise !== e.counted_amount_paise);
  const block = (title: string, items: { key: string; text: string }[]) => (
    <Card>
      <h3 className="mb-2 font-bold">{title} ({items.length})</h3>
      {items.length === 0 ? <p className="text-sm text-gray-500">{t("admin.no_rows")}</p> : (
        <ul className="space-y-1 text-sm">{items.map((i) => <li key={i.key}>{i.text}</li>)}</ul>
      )}
    </Card>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {block(t("admin.issues_claimed"), claimed.map((p) => ({ key: p.id, text: `${p.token_no} · ${p.guest_name} · ${formatINR(p.amount_paise)} · UTR ${p.utr}` })))}
      {block(t("admin.issues_rejected"), rejected.map((p) => ({ key: p.id, text: `${p.token_no} · ${p.guest_name} · ${p.reject_reason ?? ""}` })))}
      {block(t("admin.issues_unpaid"), unpaid.map((e) => ({ key: e.id, text: `${e.token_no} · ${e.guest.name} · ${e.guest.mobile_masked}` })))}
      {block(t("admin.issues_mismatch"), mismatch.map((e) => ({ key: e.id, text: `${e.token_no} · ${e.guest.name} · ${formatINR(e.declared_amount_paise)} → ${formatINR(e.counted_amount_paise)}` })))}
    </div>
  );
}

function Activity({ rows }: { rows: { id: number; action: string; created_at: string; detail: unknown; record_id: string | null }[] }) {
  return (
    <Card>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-1 pr-3 text-xs text-gray-500">{new Date(r.created_at).toLocaleString("en-IN")}</td>
              <td className="py-1 pr-3 font-semibold">{r.action}</td>
              <td className="py-1 font-mono text-xs text-gray-600">{r.detail ? JSON.stringify(r.detail) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
