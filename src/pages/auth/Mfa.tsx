import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Button, Card, ErrorNote, Input } from "../../components/ui";

/** TOTP two-step verification: enroll on first login, then challenge on every new session. */
export default function Mfa() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        return;
      }
      // remove half-finished enrolments, then start a fresh one
      for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Shagun" });
      if (error || !en) return setErr(t("common.error_generic"));
      setFactorId(en.id);
      setQr(en.totp.qr_code);
    })();
  }, [t]);

  async function verify() {
    if (!factorId) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) return setErr(t("errors.wrong_code"));
    await auth.refresh();
    nav(loc.state?.from ?? "/app", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-maroon-50 p-4">
      <Card className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-bold">{t("auth.mfa_title")}</h1>
        <p className="text-sm text-gray-600">{t("auth.mfa_required")}</p>
        {qr ? (
          <>
            <p className="text-sm">{t("auth.mfa_enroll")}</p>
            <img src={qr} alt="TOTP QR" className="mx-auto h-48 w-48" />
          </>
        ) : (
          <p className="text-sm">{t("auth.mfa_verify")}</p>
        )}
        <Input inputMode="numeric" maxLength={6} value={code} autoComplete="one-time-code"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        <ErrorNote>{err}</ErrorNote>
        <Button className="w-full" disabled={busy || code.length !== 6} onClick={verify}>{t("auth.verify")}</Button>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>{t("common.logout")}</Button>
      </Card>
    </div>
  );
}
