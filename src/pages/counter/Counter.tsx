import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { signedPhotoUrl, supabase, MEDIA_BUCKET } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { compressPhoto } from "../../lib/image";
import type { ContributionType, Purpose, Side, Status } from "../../lib/types";
import { Button, Card, ErrorNote, StatusBadge } from "../../components/ui";
import { TopBar } from "../admin/Home";

interface Row {
  contribution_id: string;
  token_no: string;
  guest_name: string;
  mobile_masked: string;
  side: Side;
  relation: string;
  type: ContributionType;
  purpose: Purpose;
  status: Status;
  description: string | null;
  created_at: string;
}

/** Gift counter: find a guest's token, check their photo, mark received. No amounts are shown here. */
export default function Counter() {
  const { eventId = "" } = useParams();
  const { t } = useTranslation();
  const auth = useAuth();
  const membership = auth.memberships.find((m) => m.event.id === eventId);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    const { data, error } = await supabase.rpc("counter_lookup", { p_event: eventId, p_query: query });
    if (error) setErr(t("errors.not_allowed"));
    else setRows((data ?? []) as Row[]);
  }, [eventId, t]);

  useEffect(() => {
    const h = setTimeout(() => void search(q), 300);
    return () => clearTimeout(h);
  }, [q, search]);

  if (!membership || membership.role === "viewer") return <Navigate to="/app" replace />;

  async function markReceived(id: string) {
    setErr(null);
    const { error } = await supabase.rpc("counter_mark_received", { p_contribution: id });
    if (error) setErr(error.message);
    else {
      setToast(t("counter.received_ok"));
      setTimeout(() => setToast(null), 1500);
      void search(q);
    }
  }

  async function addCounterPhoto(id: string, file: File) {
    const path = `${eventId}/${id}/counter_photo-${crypto.randomUUID()}.jpg`;
    const blob = await compressPhoto(file);
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) return setErr(t("errors.photo_failed"));
    await supabase.rpc("attach_counter_photo", { p_contribution: id, p_path: path, p_kind: "counter_photo" });
    setToast(t("common.saved"));
    setTimeout(() => setToast(null), 1500);
  }

  return (
    <div className="min-h-screen bg-maroon-50">
      <TopBar email={auth.session?.user.email ?? ""} title={t("counter.title")} />
      {toast && <p className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-lg bg-green-700 px-4 py-2 font-semibold text-white">{toast}</p>}
      <main className="mx-auto max-w-2xl space-y-3 p-4">
        <Link to={`/w/${membership.event.code}/assisted`} className="block rounded-xl border-2 border-dashed border-maroon-700 bg-white p-3 text-center font-semibold text-maroon-800">
          + {t("counter.assisted_entry")}
        </Link>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("counter.search_ph")}
          className="min-h-[52px] w-full rounded-xl border-2 border-maroon-700 px-4 text-lg" />
        <ErrorNote>{err}</ErrorNote>
        {rows.length === 0 && q && <p className="text-center text-gray-500">{t("counter.no_results")}</p>}
        {rows.map((r) => (
          <Card key={r.contribution_id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-2xl font-bold text-maroon-800">{r.token_no}</span>
              <StatusBadge status={r.status} />
            </div>
            <p className="text-lg font-semibold">{r.guest_name}</p>
            <p className="text-sm text-gray-600">
              {t(`guest.side_${r.side}`)} · {t(`guest.relations.${r.relation}`, { defaultValue: r.relation })} · {r.mobile_masked}
            </p>
            <p className="text-sm">{t(`guest.types.${r.type}`)} · {t(`guest.purposes.${r.purpose}`)}{r.description ? ` · ${r.description}` : ""}</p>
            <GuestPhotos contributionId={r.contribution_id} />
            <div className="flex flex-wrap gap-2">
              {r.status === "awaiting_counter" && (
                <Button className="flex-1" onClick={() => markReceived(r.contribution_id)}>✓ {t("counter.mark_received")}</Button>
              )}
              <label className="flex min-h-[48px] cursor-pointer items-center rounded-xl border border-maroon-700 px-4 font-semibold text-maroon-800">
                📷 {t("counter.counter_photo")}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void addCounterPhoto(r.contribution_id, f); }} />
              </label>
            </div>
            {r.status === "awaiting_counter" && <p className="text-xs text-gray-500">{t("counter.tag_note")}</p>}
          </Card>
        ))}
      </main>
    </div>
  );
}

function GuestPhotos({ contributionId }: { contributionId: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("media").select("storage_path").eq("contribution_id", contributionId).eq("kind", "guest_photo");
      const signed = await Promise.all((data ?? []).map((m) => signedPhotoUrl(m.storage_path)));
      setUrls(signed.filter((u): u is string => Boolean(u)));
    })();
  }, [contributionId]);
  if (urls.length === 0) return null;
  return <div className="flex gap-2">{urls.map((u) => <img key={u} src={u} alt="" className="h-32 w-32 rounded-lg object-cover" />)}</div>;
}
