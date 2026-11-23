import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Button, Card, ErrorNote, Field, Input, LanguageToggle } from "../../components/ui";

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

  useEffect(() => {
    if (auth.session) nav(loc.state?.from ?? "/app", { replace: true });
  }, [auth.session, nav, loc.state]);

  async function send() {
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) setErr(t("auth.invite_only"));
    else setSent(true);
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
        {!sent ? (
          <>
            <Field label={t("auth.email")}>
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button className="w-full" disabled={busy || !email.includes("@")} onClick={send}>{t("auth.send_code")}</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">{t("auth.code_sent", { email })}</p>
            <Field label={t("auth.code")}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button className="w-full" disabled={busy || code.length !== 6} onClick={verify}>{t("auth.verify")}</Button>
          </>
        )}
        <ErrorNote>{err}</ErrorNote>
        <p className="text-xs text-gray-500">{t("auth.invite_only")}</p>
      </Card>
    </div>
  );
}
