import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { ApiError, callFunction, supabase, uploadToSigned } from "../../lib/supabase";
import { compressPhoto } from "../../lib/image";
import { isValidIndianMobile, normalizeMobile, maskMobile } from "../../lib/phone";
import { QUICK_AMOUNTS } from "../../lib/money";
import { isValidUtr, upiLink } from "../../lib/upi";
import { RELATIONS, type ContributionType, type Payee, type PublicEvent, type Purpose, type Side, type SubmitResult } from "../../lib/types";
import { Button, Card, ErrorNote, Field, Input, LanguageToggle, Spinner } from "../../components/ui";

type Step = "welcome" | "side" | "relation" | "details" | "give" | "otp" | "pay" | "done";
const PROGRESS: Partial<Record<Step, number>> = { side: 1, relation: 2, details: 3, give: 4, otp: 4 };

const FAKE_REASONS = new Set(["too_few_digits", "round_number", "repeating_pair", "repeating_half", "sequence", "long_run"]);

export default function GuestFlow({ assisted = false }: { assisted?: boolean }) {
  const { code = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [event, setEvent] = useState<PublicEvent | null | undefined>(undefined);
  const [step, setStep] = useState<Step>("welcome");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form
  const [side, setSide] = useState<Side | null>(null);
  const [relation, setRelation] = useState<string | null>(null);
  const [relationOther, setRelationOther] = useState("");
  const [name, setName] = useState("");
  const [mobileRaw, setMobileRaw] = useState("");
  const [city, setCity] = useState("");
  const [familyCount, setFamilyCount] = useState("");
  const [consent, setConsent] = useState(false);
  const [purpose, setPurpose] = useState<Purpose>("shagun");
  const [types, setTypes] = useState<Set<ContributionType>>(new Set());
  const [onlineAmount, setOnlineAmount] = useState<number | "">("");
  const [lifafaAmount, setLifafaAmount] = useState("");
  const [lifafaPhoto, setLifafaPhoto] = useState<File | null>(null);
  const [giftPhoto, setGiftPhoto] = useState<File | null>(null);
  const [giftDesc, setGiftDesc] = useState("");
  const [message, setMessage] = useState("");

  // otp + result
  const [otpReason, setOtpReason] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [photoWarning, setPhotoWarning] = useState(false);
  const [utrDone, setUtrDone] = useState(false);

  const mobile = normalizeMobile(mobileRaw);

  useEffect(() => {
    supabase.rpc("public_event", { p_code: code }).then(({ data }) => setEvent((data as PublicEvent) ?? null));
  }, [code]);

  useEffect(() => {
    if (event?.theme_color) document.documentElement.style.setProperty("--theme", event.theme_color);
  }, [event]);

  const errText = (e: unknown) => {
    if (e instanceof ApiError) return t(`errors.${e.code}`, { defaultValue: t("common.error_generic") });
    return t("common.error_generic");
  };

  const toggleType = (ty: ContributionType) =>
    setTypes((prev) => {
      const n = new Set(prev);
      if (n.has(ty)) n.delete(ty);
      else n.add(ty);
      return n;
    });

  const detailsValid = name.trim().length >= 2 && isValidIndianMobile(mobile) && consent;

  async function submit(otpChallenge?: string) {
    setErr(null);
    if (types.size === 0) return setErr(t("errors.pick_type"));
    if (types.has("lifafa") && !lifafaPhoto) return setErr(t("errors.photo_required"));
    if (types.has("gift") && !giftPhoto) return setErr(t("errors.photo_required"));
    if (types.has("online") && !(Number(onlineAmount) >= 1)) return setErr(t("errors.invalid_amount"));

    const items = [...types].map((ty) => ({
      type: ty,
      purpose,
      declared_amount_rupees:
        ty === "online" ? Number(onlineAmount) : ty === "lifafa" && lifafaAmount ? Number(lifafaAmount) : undefined,
      description: ty === "gift" ? giftDesc : undefined,
      message,
      with_photo: ty !== "online",
    }));

    setBusy(true);
    try {
      const res = await callFunction<SubmitResult>("guest-submit", {
        event_code: code,
        name,
        mobile,
        side,
        relation: relation === "other" ? relationOther || "other" : relation,
        relation_other: relation === "other" ? relationOther : undefined,
        city,
        family_count: familyCount ? Number(familyCount) : undefined,
        language: i18n.language === "en" ? "en" : "hi",
        consent,
        items,
        otp_challenge_id: otpChallenge,
        assisted,
      });

      // Upload photos (compressed, EXIF stripped)
      let photoFail = false;
      for (const up of res.uploads) {
        const c = res.contributions.find((x) => x.id === up.contribution_id);
        const file = c?.type === "lifafa" ? lifafaPhoto : giftPhoto;
        if (!file) continue;
        try {
          await uploadToSigned(up.path, up.token, await compressPhoto(file));
        } catch {
          photoFail = true;
        }
      }
      setPhotoWarning(photoFail);
      try {
        sessionStorage.setItem(`shagun:${code}`, JSON.stringify({ secret: res.secret, contributions: res.contributions }));
      } catch {
        /* ignore */
      }
      setResult(res);
      setStep(types.has("online") ? "pay" : "done");
    } catch (e) {
      if (e instanceof ApiError && e.body.otp_required) {
        const r = String(e.body.reason ?? "");
        setOtpReason(FAKE_REASONS.has(r) ? "fake" : r);
        setOtpSent(false);
        setChallengeId(null);
        setOtpCode("");
        setStep("otp");
      } else setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    setErr(null);
    setBusy(true);
    try {
      const r = await callFunction<{ challenge_id: string; dev_code?: string }>("guest-otp", {
        action: "send", event_code: code, mobile,
      });
      setChallengeId(r.challenge_id);
      setOtpSent(true);
      if (r.dev_code) setOtpCode(r.dev_code); // only when OTP_DEV_ECHO=true on a dev project
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (!challengeId) return;
    setErr(null);
    setBusy(true);
    try {
      await callFunction("guest-otp", { action: "verify", challenge_id: challengeId, code: otpCode });
      setBusy(false);
      await submit(challengeId);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  function resetForNext() {
    setStep("side");
    setSide(null);
    setRelation(null);
    setRelationOther("");
    setName("");
    setMobileRaw("");
    setCity("");
    setFamilyCount("");
    setConsent(false);
    setTypes(new Set());
    setOnlineAmount("");
    setLifafaAmount("");
    setLifafaPhoto(null);
    setGiftPhoto(null);
    setGiftDesc("");
    setMessage("");
    setResult(null);
    setUtrDone(false);
  }

  if (event === undefined) return <Spinner />;
  if (event === null)
    return (
      <Shell>
        <Card><p className="text-center">{t("guest.not_found")}</p></Card>
      </Shell>
    );
  if (!event.guest_form_open && !assisted)
    return (
      <Shell event={event}>
        <Card><p className="text-center">{t("guest.closed")}</p></Card>
      </Shell>
    );

  const progress = PROGRESS[step];

  return (
    <Shell event={event}>
      {assisted && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-center text-sm font-semibold text-amber-900">
          {t("guest.assisted_banner")}
        </p>
      )}
      {progress && (
        <div>
          <p className="mb-1 text-xs text-gray-600">{t("guest.step", { n: progress, total: 4 })}</p>
          <div className="h-2 rounded-full bg-maroon-100">
            <div className="h-2 rounded-full bg-maroon-700 transition-all" style={{ width: `${progress * 25}%` }} />
          </div>
        </div>
      )}

      {step === "welcome" && (
        <Card className="space-y-4 text-center">
          {event.couple_photo_url && (
            <img src={event.couple_photo_url} alt="" className="mx-auto h-40 w-40 rounded-full object-cover" />
          )}
          <h1 className="font-display text-3xl text-maroon-800">
            {t("guest.weds", { bride: event.bride_name, groom: event.groom_name })}
          </h1>
          <p className="text-gray-600">
            {new Date(event.event_date).toLocaleDateString(i18n.language === "hi" ? "hi-IN" : "en-IN", { dateStyle: "long" })}
            {event.venue ? ` · ${event.venue}` : ""}
          </p>
          <p className="text-gray-700">
            {(i18n.language === "hi" ? event.welcome_text_hi : event.welcome_text_en) || t("guest.welcome_sub")}
          </p>
          <p className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
            ✓ {t("guest.verified")}
          </p>
          <Button className="w-full" onClick={() => setStep("side")}>{t("guest.start")}</Button>
        </Card>
      )}

      {step === "side" && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">{t("guest.side_q")}</h2>
          {(["bride", "groom", "both"] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => { setSide(s); setStep("relation"); }}
              className={`w-full rounded-xl border-2 p-4 text-left text-lg font-semibold ${side === s ? "border-maroon-700 bg-maroon-50" : "border-gray-200 bg-white"}`}
            >
              {t(`guest.side_${s}`)}
            </button>
          ))}
          <Button variant="ghost" onClick={() => setStep("welcome")}>{t("common.back")}</Button>
        </Card>
      )}

      {step === "relation" && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">{t("guest.relation_q")}</h2>
          <div className="flex flex-wrap gap-2">
            {RELATIONS.map((r) => (
              <button
                key={r}
                onClick={() => setRelation(r)}
                className={`rounded-full border-2 px-4 py-2 font-semibold ${relation === r ? "border-maroon-700 bg-maroon-700 text-white" : "border-gray-200 bg-white"}`}
              >
                {t(`guest.relations.${r}`)}
              </button>
            ))}
          </div>
          {relation === "other" && (
            <Input value={relationOther} maxLength={60} onChange={(e) => setRelationOther(e.target.value)} placeholder={t("guest.relation_other_ph")} />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("side")}>{t("common.back")}</Button>
            <Button className="flex-1" disabled={!relation || (relation === "other" && !relationOther.trim())} onClick={() => setStep("details")}>
              {t("common.next")}
            </Button>
          </div>
        </Card>
      )}

      {step === "details" && (
        <Card className="space-y-4">
          <h2 className="text-xl font-bold">{t("guest.details_title")}</h2>
          <Field label={`${t("guest.name")} *`}>
            <Input value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} placeholder={t("guest.name_ph")} />
          </Field>
          <Field label={`${t("guest.mobile")} *`}>
            <Input value={mobileRaw} inputMode="numeric" autoComplete="tel" maxLength={14} onChange={(e) => setMobileRaw(e.target.value)} placeholder={t("guest.mobile_ph")} />
          </Field>
          {mobileRaw && !isValidIndianMobile(mobile) && <ErrorNote>{t("errors.invalid_mobile")}</ErrorNote>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("guest.city")} (${t("common.optional")})`}>
              <Input value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label={`${t("guest.family_count")} (${t("common.optional")})`}>
              <Input value={familyCount} inputMode="numeric" maxLength={2} onChange={(e) => setFamilyCount(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t("guest.consent")}</span>
          </label>
          {!detailsValid && <p className="text-xs text-gray-500">{t("guest.both_required")}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("relation")}>{t("common.back")}</Button>
            <Button className="flex-1" disabled={!detailsValid} onClick={() => setStep("give")}>{t("common.next")}</Button>
          </div>
        </Card>
      )}

      {step === "give" && (
        <Card className="space-y-5">
          <div>
            <h2 className="mb-2 text-lg font-bold">{t("guest.purpose_q")}</h2>
            <div className="flex flex-wrap gap-2">
              {(["shagun", "kanyadaan", "aashirwad_gift"] as Purpose[]).map((p) => (
                <button key={p} onClick={() => setPurpose(p)}
                  className={`rounded-full border-2 px-4 py-2 font-semibold ${purpose === p ? "border-maroon-700 bg-maroon-700 text-white" : "border-gray-200"}`}>
                  {t(`guest.purposes.${p}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold">{t("guest.how_q")}</h2>
            {(["online", "lifafa", "gift"] as ContributionType[]).map((ty) => (
              <div key={ty} className={`rounded-xl border-2 p-3 ${types.has(ty) ? "border-maroon-700 bg-maroon-50" : "border-gray-200"}`}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={types.has(ty)} onChange={() => toggleType(ty)}
                    disabled={ty === "online" && !event.has_upi && !event.has_bank} />
                  <span>
                    <span className="block font-semibold">{t(`guest.types.${ty}`)}</span>
                    <span className="block text-sm text-gray-600">{t(`guest.types_desc.${ty}`)}</span>
                  </span>
                </label>

                {types.has(ty) && ty === "online" && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-semibold">{t("guest.online_amount")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {QUICK_AMOUNTS.map((a) => (
                        <button key={a} onClick={() => setOnlineAmount(a)}
                          className={`rounded-lg border-2 py-2 font-semibold ${onlineAmount === a ? "border-maroon-700 bg-maroon-700 text-white" : "border-gray-200 bg-white"}`}>
                          ₹{a.toLocaleString("en-IN")}
                        </button>
                      ))}
                    </div>
                    <Input inputMode="numeric" placeholder={t("guest.custom_amount")} value={onlineAmount}
                      onChange={(e) => setOnlineAmount(e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 7)) : "")} />
                  </div>
                )}

                {types.has(ty) && ty === "lifafa" && (
                  <div className="mt-3 space-y-2">
                    <PhotoPicker label={t("guest.photo_of_lifafa")} file={lifafaPhoto} onChange={setLifafaPhoto} />
                    <Field label={t("guest.amount_optional")} hint={t("guest.amount_optional_hint")}>
                      <Input inputMode="numeric" value={lifafaAmount} onChange={(e) => setLifafaAmount(e.target.value.replace(/\D/g, "").slice(0, 7))} />
                    </Field>
                  </div>
                )}

                {types.has(ty) && ty === "gift" && (
                  <div className="mt-3 space-y-2">
                    <PhotoPicker label={t("guest.photo_of_gift")} file={giftPhoto} onChange={setGiftPhoto} />
                    <Input value={giftDesc} maxLength={120} placeholder={t("guest.gift_desc_ph")} onChange={(e) => setGiftDesc(e.target.value)} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <textarea value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder={t("guest.message_ph")}
            className="w-full rounded-xl border border-gray-300 p-3" rows={2} />

          <ErrorNote>{err}</ErrorNote>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("details")}>{t("common.back")}</Button>
            <Button className="flex-1" disabled={busy} onClick={() => submit()}>{busy ? t("common.loading") : t("guest.submit_entry")}</Button>
          </div>
        </Card>
      )}

      {step === "otp" && (
        <Card className="space-y-4">
          <h2 className="text-xl font-bold">{t("guest.otp_title")}</h2>
          <p className="text-gray-700">{t(`guest.otp_reason.${otpReason ?? "always"}`)}</p>
          {!otpSent ? (
            <Button className="w-full" disabled={busy} onClick={sendOtp}>{t("guest.otp_send")}</Button>
          ) : (
            <>
              <p className="text-sm text-gray-600">{t("guest.otp_sent", { mobile: maskMobile(mobile) })}</p>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))} placeholder={t("guest.otp_code")} />
              <Button className="w-full" disabled={busy || otpCode.length !== 6} onClick={verifyOtp}>{t("guest.otp_verify")}</Button>
              <Button variant="ghost" disabled={busy} onClick={sendOtp}>{t("guest.otp_send")}</Button>
            </>
          )}
          <ErrorNote>{err}</ErrorNote>
          <Button variant="ghost" onClick={() => setStep("give")}>{t("common.back")}</Button>
        </Card>
      )}

      {step === "pay" && result?.payee && (
        <PayStep
          payee={result.payee}
          amount={Number(onlineAmount)}
          contribution={result.contributions.find((c) => c.type === "online")!}
          secret={result.secret}
          onDone={() => { setUtrDone(true); setStep("done"); }}
        />
      )}

      {step === "done" && result && (
        <Card className="space-y-4 text-center">
          <p className="text-4xl">🙏</p>
          <h2 className="font-display text-2xl text-maroon-800">{t("guest.thank_you")}</h2>
          <p className="text-gray-700">{t("guest.thank_you_sub")}</p>
          {utrDone && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("guest.pending_verify")}</p>}
          {result.contributions.filter((c) => c.type !== "online").map((c) => (
            <div key={c.id} className="rounded-xl border-2 border-dashed border-maroon-700 p-4">
              <p className="text-sm text-gray-600">{t("guest.token_title")} · {t(`guest.types.${c.type}`)}</p>
              <p className="font-mono text-4xl font-bold tracking-widest text-maroon-800">{c.token_no}</p>
              <div className="mt-2 flex justify-center"><QRCodeSVG value={c.token_no} size={96} /></div>
              <p className="mt-2 text-sm">{t("guest.token_counter_note")}</p>
            </div>
          ))}
          {photoWarning && <ErrorNote>{t("errors.photo_failed")}</ErrorNote>}
          <p className="text-xs text-gray-500">{t("guest.save_screenshot")}</p>
          {assisted && <Button className="w-full" onClick={resetForNext}>{t("counter.assisted_entry")}</Button>}
        </Card>
      )}
    </Shell>
  );
}

function Shell({ children, event }: { children: React.ReactNode; event?: PublicEvent }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-maroon-50 to-gold-100/40">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="font-display text-lg text-maroon-800">{event ? `${event.bride_name} ♥ ${event.groom_name}` : "Shagun"}</span>
        <LanguageToggle />
      </header>
      <main className="mx-auto max-w-md space-y-4 px-4 pb-10">{children}</main>
    </div>
  );
}

function PhotoPicker({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const { t } = useTranslation();
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label} *</p>
      {preview && <img src={preview} alt="" className="h-40 w-full rounded-lg object-cover" />}
      <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-maroon-700 bg-white font-semibold text-maroon-800">
        📷 {file ? t("guest.retake") : t("guest.take_photo")}
        {/* capture=environment opens the camera directly on phones */}
        <input type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}

function PayStep({
  payee, amount, contribution, secret, onDone,
}: {
  payee: Payee;
  amount: number;
  contribution: { id: string; token_no: string };
  secret: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<"direct_upi" | "bank_transfer">(payee.upi_id ? "direct_upi" : "bank_transfer");
  const [paid, setPaid] = useState(String(amount || ""));
  const [utr, setUtr] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const link = payee.upi_id
    ? upiLink({ vpa: payee.upi_id, payee: payee.payee_name, amountRupees: amount, note: `Shagun ${contribution.token_no}` })
    : null;

  const copy = async (k: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(k);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  async function confirm() {
    setErr(null);
    if (!isValidUtr(utr, method)) return setErr(t("errors.invalid_utr"));
    if (!(Number(paid) >= 1)) return setErr(t("errors.invalid_amount"));
    setBusy(true);
    try {
      const r = await callFunction<{ upload: { path: string; token: string } | null }>("guest-utr", {
        contribution_id: contribution.id, secret, amount_rupees: Number(paid), utr, method, with_screenshot: Boolean(shot),
      });
      if (r.upload && shot) {
        try {
          await uploadToSigned(r.upload.path, r.upload.token, await compressPhoto(shot));
        } catch {
          /* screenshot is optional */
        }
      }
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: t("common.error_generic") }) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-xl font-bold">{t("guest.pay_title")} · ₹{amount.toLocaleString("en-IN")}</h2>
      <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        ⚠ {t("guest.pay_check_name", { name: payee.payee_name })}
      </p>

      {link && payee.upi_id && (
        <div className="space-y-3">
          <a href={link} className="flex min-h-[52px] items-center justify-center rounded-xl bg-maroon-700 text-lg font-bold text-white">
            {t("guest.pay_with_app")}
          </a>
          <div className="text-center">
            <p className="mb-2 text-sm text-gray-600">{t("guest.scan_qr")}</p>
            <div className="inline-block rounded-xl bg-white p-3 ring-1 ring-black/10"><QRCodeSVG value={link} size={180} /></div>
          </div>
          <CopyRow label={t("guest.upi_id")} value={payee.upi_id} copied={copied === "upi"} onCopy={() => copy("upi", payee.upi_id!)} />
        </div>
      )}

      {payee.bank_account && (
        <details className="rounded-xl border border-gray-200 p-3" open={!link}>
          <summary className="cursor-pointer font-semibold">{t("guest.bank_details")}</summary>
          <div className="mt-2 space-y-2">
            <CopyRow label={t("guest.account_no")} value={payee.bank_account} copied={copied === "acc"} onCopy={() => copy("acc", payee.bank_account!)} />
            {payee.ifsc && <CopyRow label={t("guest.ifsc")} value={payee.ifsc} copied={copied === "ifsc"} onCopy={() => copy("ifsc", payee.ifsc!)} />}
            {payee.bank_name && <p className="text-sm text-gray-600">{t("guest.bank")}: {payee.bank_name}</p>}
          </div>
        </details>
      )}

      <hr />
      <h3 className="font-bold">{t("guest.after_pay")}</h3>
      <div className="flex gap-2">
        {payee.upi_id && (
          <button onClick={() => setMethod("direct_upi")} className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold ${method === "direct_upi" ? "border-maroon-700 bg-maroon-50" : "border-gray-200"}`}>
            {t("guest.method_upi")}
          </button>
        )}
        {payee.bank_account && (
          <button onClick={() => setMethod("bank_transfer")} className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold ${method === "bank_transfer" ? "border-maroon-700 bg-maroon-50" : "border-gray-200"}`}>
            {t("guest.method_bank")}
          </button>
        )}
      </div>
      <Field label={t("guest.paid_amount")}>
        <Input inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, "").slice(0, 7))} />
      </Field>
      <Field label={t("guest.utr_label")} hint={method === "direct_upi" ? t("guest.utr_help_upi") : t("guest.utr_help_bank")}>
        <Input value={utr} maxLength={22} inputMode={method === "direct_upi" ? "numeric" : "text"} onChange={(e) => setUtr(e.target.value.trim())} />
      </Field>
      <Field label={t("guest.screenshot_optional")}>
        <input type="file" accept="image/*" onChange={(e) => setShot(e.target.files?.[0] ?? null)} />
      </Field>
      <ErrorNote>{err}</ErrorNote>
      <Button className="w-full" disabled={busy} onClick={confirm}>{busy ? t("common.loading") : t("guest.submit_utr")}</Button>
    </Card>
  );
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="font-mono font-semibold">{value}</p>
      </div>
      <button onClick={onCopy} className="rounded-lg border px-3 py-1 text-sm font-semibold">{copied ? t("common.copied") : t("common.copy")}</button>
    </div>
  );
}
