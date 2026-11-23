import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Button, Card, ErrorNote, Field, Input, LanguageToggle } from "../../components/ui";

const COOLDOWN = 60;

export default function Login() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (auth.session) nav(loc.state?.from ?? "/app", { replace: true });
  }, [auth.session, nav, loc.state]);

  // A used/expired magic link comes back as #error=...&error_code=otp_expired
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("error_code") === "otp_expired" || hash.get("error")) setErr(t("auth.link_expired"));
  }, [t]);

  useEffect(() => {
    if (wait <= 0) return;
    const h = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(h);
  }, [wait]);

  async function send() {
    if (busy || wait > 0) return;
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) {
      const rate = error.status === 429 || /rate limit|security purposes/i.test(error.message);
      setErr(rate ? t("auth.rate_limited") : t("auth.invite_only"));
      if (rate) setWait(COOLDOWN);
      return;
    }
    setSent(true);
    setWait(COOLDOWN);
  }

  async function verify() {
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    setBusy(false);
    if (error) setErr(t("errors.wrong_code"));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-maroon-50 p-4">
      <Card className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{t("auth.title")}</h1>
          <LanguageToggle />
        </div>
        <Field label={t("auth.email")}>
          <Input type="email" autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {!sent ? (
          <Button className="w-full" disabled={busy || wait > 0 || !email.includes("@")} onClick={send}>
            {wait > 0 ? t("auth.wait_seconds", { s: wait }) : t("auth.send_code")}
          </Button>
        ) : (
          <>
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{t("auth.link_sent", { email })}</p>
            <p className="text-sm text-gray-600">{t("auth.or_code")}</p>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <Button className="w-full" disabled={busy || code.length !== 6} onClick={verify}>{t("auth.verify")}</Button>
            <Button variant="ghost" className="w-full" disabled={wait > 0} onClick={() => setSent(false)}>
              {wait > 0 ? t("auth.wait_seconds", { s: wait }) : t("auth.send_code")}
            </Button>
          </>
        )}
        <ErrorNote>{err}</ErrorNote>
        <p className="text-xs text-gray-500">{t("auth.invite_only")}</p>
      </Card>
    </div>
  );
}
