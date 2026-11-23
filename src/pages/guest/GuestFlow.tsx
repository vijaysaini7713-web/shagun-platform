import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { ApiError, callFunction, supabase, uploadToSigned } from "../../lib/supabase";
import { compressPhoto } from "../../lib/image";
import { isValidIndianMobile, normalizeMobile, maskMobile } from "../../lib/phone";
import { QUICK_AMOUNTS } from "../../lib/money";
import { isValidUtr, upiLink } from "../../lib/upi";
import { RELATIONS, type ContributionType, type Payee, type PublicEvent, type Purpose, type Side, type SubmitResult } from "../../lib/types";
import { Spinner } from "../../components/ui";

/*
 * Guest page — one scrolling form.
 * Look: Jaipur pink-city plaster (gulabi), kumkum red for choices, marigold thread joining the four
 * sections, and a jharokha (arched window) framing the couple's names. The arch is the one bold element;
 * everything else stays quiet so elders can read and tap easily.
 */

type Screen = "form" | "otp" | "pay" | "done";
type Need = "side" | "relation" | "relation_other" | "name" | "mobile" | "consent" | "type" | "lifafa_photo" | "gift_photo" | "amount";

const FAKE_REASONS = new Set(["too_few_digits", "round_number", "repeating_pair", "repeating_half", "sequence", "long_run"]);
const NEED_TO_SECTION: Record<Need, string> = {
  side: "sec-side", relation: "sec-relation", relation_other: "sec-relation", name: "sec-details", mobile: "sec-details",
  consent: "sec-details", type: "sec-give", lifafa_photo: "sec-give", gift_photo: "sec-give", amount: "sec-give",
};

export default function GuestFlow({ assisted = false }: { assisted?: boolean }) {
  const { code = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [event, setEvent] = useState<PublicEvent | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("form");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

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

  const [otpReason, setOtpReason] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [photoWarning, setPhotoWarning] = useState(false);
  const [utrDone, setUtrDone] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const mobile = normalizeMobile(mobileRaw);

  useEffect(() => {
    supabase.rpc("public_event", { p_code: code }).then(({ data }) => setEvent((data as PublicEvent) ?? null));
  }, [code]);

  useEffect(() => {
    if (screen !== "form") topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [screen]);

  const needs: Need[] = useMemo(() => {
    const n: Need[] = [];
    if (!side) n.push("side");
    if (!relation) n.push("relation");
    else if (relation === "other" && !relationOther.trim()) n.push("relation_other");
    if (name.trim().length < 2) n.push("name");
    if (!isValidIndianMobile(mobile)) n.push("mobile");
    if (!consent) n.push("consent");
    if (types.size === 0) n.push("type");
    if (types.has("online") && !(Number(onlineAmount) >= 1)) n.push("amount");
    if (types.has("lifafa") && !lifafaPhoto) n.push("lifafa_photo");
    if (types.has("gift") && !giftPhoto) n.push("gift_photo");
    return n;
  }, [side, relation, relationOther, name, mobile, consent, types, onlineAmount, lifafaPhoto, giftPhoto]);

  const errText = (e: unknown) =>
    e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: t("common.error_generic") }) : t("common.error_generic");

  const toggleType = (ty: ContributionType) =>
    setTypes((prev) => {
      const n = new Set(prev);
      if (n.has(ty)) n.delete(ty);
      else n.add(ty);
      return n;
    });

  function onSubmitClick() {
    setTried(true);
    if (needs.length > 0) {
      document.getElementById(NEED_TO_SECTION[needs[0]])?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    void submit();
  }

  async function submit(otpChallenge?: string) {
    setErr(null);
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
        event_code: code, name, mobile, side,
        relation: relation === "other" ? relationOther || "other" : relation,
        relation_other: relation === "other" ? relationOther : undefined,
        city, family_count: familyCount ? Number(familyCount) : undefined,
        language: i18n.language === "en" ? "en" : "hi",
        consent, items, otp_challenge_id: otpChallenge, assisted,
      });

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
        /* storage blocked */
      }
      setResult(res);
      setScreen(types.has("online") ? "pay" : "done");
    } catch (e) {
      if (e instanceof ApiError && e.body.otp_required) {
        const r = String(e.body.reason ?? "");
        setOtpReason(FAKE_REASONS.has(r) ? "fake" : r);
        setOtpSent(false);
        setChallengeId(null);
        setOtpCode("");
        setScreen("otp");
      } else setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    setErr(null);
    setBusy(true);
    try {
      const r = await callFunction<{ challenge_id: string; dev_code?: string }>("guest-otp", { action: "send", event_code: code, mobile });
      setChallengeId(r.challenge_id);
      setOtpSent(true);
      if (r.dev_code) setOtpCode(r.dev_code);
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
    setScreen("form");
    setTried(false);
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
    window.scrollTo({ top: 0 });
  }

  if (event === undefined) return <Spinner />;
  if (event === null)
    return <Page><Notice>{t("guest.not_found")}</Notice></Page>;

  const dateText = new Date(event.event_date).toLocaleDateString(i18n.language === "hi" ? "hi-IN" : "en-IN", { dateStyle: "long" });
  const welcome = (i18n.language === "hi" ? event.welcome_text_hi : event.welcome_text_en) || t("guest.welcome_sub");
  const show = (n: Need) => tried && needs.includes(n);

  return (
    <Page>
      <div ref={topRef} />
      <Jharokha
        names={t("guest.weds", { bride: event.bride_name, groom: event.groom_name })}
        sub={event.venue ? t("guest.date_venue", { date: dateText, venue: event.venue }) : dateText}
        welcome={screen === "form" ? welcome : undefined}
        verified={t("guest.verified")}
      />

      {assisted && (
        <p className="mx-auto mt-4 max-w-md rounded-lg bg-marigold-soft px-3 py-2 text-center text-sm font-semibold text-ink">
          {t("guest.assisted_banner")}
        </p>
      )}

      {!event.guest_form_open && !assisted ? (
        <Notice>{t("guest.closed")}</Notice>
      ) : screen === "form" ? (
        <div className="mx-auto mt-6 max-w-md px-4 pb-40">
          <Section id="sec-side" n={1} title={t("guest.sec_side")} done={!!side}>
            <div className="grid grid-cols-2 gap-2">
              {(["bride", "groom"] as Side[]).map((s) => (
                <Choice key={s} big selected={side === s} onClick={() => setSide(s)}>{t(`guest.side_${s}`)}</Choice>
              ))}
            </div>
            <Choice selected={side === "both"} onClick={() => setSide("both")} className="mt-2 w-full">{t("guest.side_both")}</Choice>
            {show("side") && <Hint>{t("guest.need.side")}</Hint>}
          </Section>

          <Section id="sec-relation" n={2} title={t("guest.sec_relation")} done={!!relation && (relation !== "other" || !!relationOther.trim())}>
            <div className="flex flex-wrap gap-2">
              {RELATIONS.map((r) => (
                <Choice key={r} selected={relation === r} onClick={() => setRelation(r)}>{t(`guest.relations.${r}`)}</Choice>
              ))}
            </div>
            {relation === "other" && (
              <TextInput className="mt-3" value={relationOther} maxLength={60} placeholder={t("guest.relation_other_ph")}
                onChange={(e) => setRelationOther(e.target.value)} />
            )}
            {(show("relation") || show("relation_other")) && <Hint>{t(show("relation") ? "guest.need.relation" : "guest.need.relation_other")}</Hint>}
          </Section>

          <Section id="sec-details" n={3} title={t("guest.sec_details")} done={name.trim().length >= 2 && isValidIndianMobile(mobile) && consent}>
            <Label text={`${t("guest.name")} *`}>
              <TextInput value={name} maxLength={80} autoComplete="name" placeholder={t("guest.name_ph")} onChange={(e) => setName(e.target.value)} invalid={show("name")} />
            </Label>
            <Label text={`${t("guest.mobile")} *`}>
              <div className={`flex items-center rounded-xl border-2 bg-white ${show("mobile") || (mobileRaw && !isValidIndianMobile(mobile)) ? "border-kumkum" : "border-gulabi-200 focus-within:border-kumkum"}`}>
                <span className="pl-4 pr-2 text-lg text-ink/60">+91</span>
                <input value={mobileRaw} inputMode="numeric" autoComplete="tel-national" maxLength={14} placeholder={t("guest.mobile_ph")}
                  onChange={(e) => setMobileRaw(e.target.value)}
                  className="min-h-[52px] w-full rounded-r-xl bg-transparent pr-4 text-lg tracking-wide text-ink outline-none" />
              </div>
            </Label>
            {(show("name") || show("mobile")) && <Hint>{t(show("name") ? "guest.need.name" : "guest.need.mobile")}</Hint>}
            <div className="grid grid-cols-[1fr_7rem] items-end gap-3">
              <Label text={t("guest.city")} optional={t("common.optional")}>
                <TextInput value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} />
              </Label>
              <Label text={t("guest.family_count")} optional={t("common.optional")}>
                <TextInput value={familyCount} inputMode="numeric" maxLength={2} onChange={(e) => setFamilyCount(e.target.value.replace(/\D/g, ""))} />
              </Label>
            </div>
            <label className={`mt-1 flex items-start gap-3 rounded-xl p-3 text-[15px] leading-snug text-ink ${show("consent") ? "bg-kumkum-soft" : "bg-white/70"}`}>
              <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-[#8C1C2B]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t("guest.consent")}</span>
            </label>
          </Section>

          <Section id="sec-give" n={4} title={t("guest.sec_give")} done={needs.every((x) => !["type", "amount", "lifafa_photo", "gift_photo"].includes(x))} last>
            <p className="mb-2 text-sm text-ink/70">{t("guest.purpose_q")}</p>
            <div className="mb-5 flex flex-wrap gap-2">
              {(["shagun", "kanyadaan", "aashirwad_gift"] as Purpose[]).map((p) => (
                <Choice key={p} selected={purpose === p} onClick={() => setPurpose(p)}>{t(`guest.purposes.${p}`)}</Choice>
              ))}
            </div>

            <p className="mb-2 text-sm text-ink/70">{t("guest.how_q")}</p>
            <div className="space-y-3">
              {(["online", "lifafa", "gift"] as ContributionType[]).map((ty) => {
                const disabled = ty === "online" && !event.has_upi && !event.has_bank;
                const on = types.has(ty);
                return (
                  <div key={ty} className={`rounded-2xl border-2 bg-white transition-colors ${on ? "border-kumkum" : "border-gulabi-200"} ${disabled ? "opacity-50" : ""}`}>
                    <button type="button" disabled={disabled} onClick={() => toggleType(ty)} aria-pressed={on}
                      className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumkum rounded-2xl">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold ${on ? "border-kumkum bg-kumkum text-white" : "border-gulabi-200"}`}>{on ? "✓" : ""}</span>
                      <span className="text-2xl" aria-hidden>{ty === "online" ? "📲" : ty === "lifafa" ? "✉️" : "🎁"}</span>
                      <span>
                        <span className="block text-lg font-semibold text-ink">{t(`guest.types.${ty}`)}</span>
                        <span className="block text-sm text-ink/60">{t(`guest.types_desc.${ty}`)}</span>
                      </span>
                    </button>

                    {on && ty === "online" && (
                      <div className="space-y-2 border-t border-gulabi-100 px-4 pb-4 pt-3">
                        <p className="text-sm font-semibold text-ink">{t("guest.online_amount")}</p>
                        <div className="grid grid-cols-3 gap-2">
                          {QUICK_AMOUNTS.map((a) => (
                            <Choice key={a} selected={onlineAmount === a} onClick={() => setOnlineAmount(a)} className="!px-0 tabular-nums">₹{a.toLocaleString("en-IN")}</Choice>
                          ))}
                        </div>
                        <TextInput inputMode="numeric" placeholder={t("guest.custom_amount")} value={onlineAmount} invalid={show("amount")}
                          onChange={(e) => setOnlineAmount(e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 7)) : "")} />
                      </div>
                    )}
                    {on && ty === "lifafa" && (
                      <div className="space-y-3 border-t border-gulabi-100 px-4 pb-4 pt-3">
                        <PhotoPicker label={t("guest.photo_of_lifafa")} file={lifafaPhoto} onChange={setLifafaPhoto} missing={show("lifafa_photo")} />
                        <Label text={t("guest.amount_optional")}>
                          <TextInput inputMode="numeric" value={lifafaAmount} placeholder="₹" onChange={(e) => setLifafaAmount(e.target.value.replace(/\D/g, "").slice(0, 7))} />
                        </Label>
                        <p className="-mt-2 text-xs text-ink/60">{t("guest.amount_optional_hint")}</p>
                      </div>
                    )}
                    {on && ty === "gift" && (
                      <div className="space-y-3 border-t border-gulabi-100 px-4 pb-4 pt-3">
                        <PhotoPicker label={t("guest.photo_of_gift")} file={giftPhoto} onChange={setGiftPhoto} missing={show("gift_photo")} />
                        <TextInput value={giftDesc} maxLength={120} placeholder={t("guest.gift_desc_ph")} onChange={(e) => setGiftDesc(e.target.value)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {show("type") && <Hint>{t("guest.need.type")}</Hint>}

            <textarea value={message} maxLength={500} rows={2} onChange={(e) => setMessage(e.target.value)} placeholder={t("guest.message_ph")}
              className="mt-4 w-full rounded-xl border-2 border-gulabi-200 bg-white p-3 text-base text-ink outline-none focus:border-kumkum" />
          </Section>

          {/* sticky submit: tells the guest exactly what is still missing */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gulabi-200 bg-gulabi-50/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className="mx-auto max-w-md">
              {err ? <p role="alert" className="mb-2 text-center text-sm font-semibold text-kumkum">{err}</p> : (
                <p className="mb-2 text-center text-sm text-ink/70">{needs.length ? t(`guest.need.${needs[0]}`) : t("guest.ready")}</p>
              )}
              <PrimaryButton disabled={busy} onClick={onSubmitClick}>{busy ? t("common.loading") : t("guest.submit_entry")}</PrimaryButton>
            </div>
          </div>
        </div>
      ) : screen === "otp" ? (
        <Panel>
          <h2 className="font-display text-2xl text-kumkum">{t("guest.otp_title")}</h2>
          <p className="text-ink/80">{t(`guest.otp_reason.${otpReason ?? "always"}`)}</p>
          {!otpSent ? (
            <PrimaryButton disabled={busy} onClick={sendOtp}>{t("guest.otp_send")}</PrimaryButton>
          ) : (
            <>
              <p className="text-sm text-ink/70">{t("guest.otp_sent", { mobile: maskMobile(mobile) })}</p>
              <TextInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode}
                className="text-center text-2xl tracking-[0.5em]" onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))} placeholder="••••••" />
              <PrimaryButton disabled={busy || otpCode.length !== 6} onClick={verifyOtp}>{t("guest.otp_verify")}</PrimaryButton>
              <GhostButton disabled={busy} onClick={sendOtp}>{t("guest.otp_send")}</GhostButton>
            </>
          )}
          {err && <p role="alert" className="text-sm font-semibold text-kumkum">{err}</p>}
          <GhostButton onClick={() => setScreen("form")}>{t("common.back")}</GhostButton>
        </Panel>
      ) : screen === "pay" && result?.payee ? (
        <PayStep payee={result.payee} amount={Number(onlineAmount)} contribution={result.contributions.find((c) => c.type === "online")!}
          secret={result.secret} onDone={() => { setUtrDone(true); setScreen("done"); }} />
      ) : result ? (
        <Panel center>
          <p className="font-display text-3xl text-kumkum">{t("guest.thank_you")}</p>
          <p className="text-ink/80">{t("guest.thank_you_sub")}</p>
          {utrDone && <p className="rounded-xl bg-marigold-soft p-3 text-sm text-ink">{t("guest.pending_verify")}</p>}
          {result.contributions.filter((c) => c.type !== "online").map((c) => (
            <div key={c.id} className="rounded-2xl border-2 border-dashed border-kumkum bg-white p-5">
              <p className="text-sm text-ink/70">{t("guest.token_title")} — {t(`guest.types.${c.type}`)}</p>
              <p className="mt-1 text-5xl font-bold tracking-wider text-kumkum tabular-nums">{c.token_no}</p>
              <div className="mt-3 flex justify-center"><QRCodeSVG value={c.token_no} size={104} fgColor="#2A1215" /></div>
              <p className="mt-3 text-[15px] text-ink">{t("guest.token_counter_note")}</p>
            </div>
          ))}
          {photoWarning && <p className="text-sm font-semibold text-kumkum">{t("errors.photo_failed")}</p>}
          <p className="text-xs text-ink/60">{t("guest.save_screenshot")}</p>
          {assisted && <PrimaryButton onClick={resetForNext}>{t("counter.assisted_entry")}</PrimaryButton>}
        </Panel>
      ) : null}
    </Page>
  );
}

/* ---------- layout pieces ---------- */

function Page({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const next = i18n.language === "hi" ? "en" : "hi";
  return (
    <div className="min-h-screen bg-gulabi-100 text-ink">
      <div className="mx-auto flex max-w-md justify-end px-4 pt-3">
        <button onClick={() => i18n.changeLanguage(next)}
          className="rounded-full border-2 border-kumkum/30 bg-white/80 px-4 py-1.5 text-sm font-semibold text-kumkum focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumkum">
          {i18n.language === "hi" ? "English" : "हिंदी"}
        </button>
      </div>
      {children}
    </div>
  );
}

/** The arched jharokha window framing the couple — the page's single bold element. */
function Jharokha({ names, sub, welcome, verified }: { names: string; sub: string; welcome?: string; verified: string }) {
  return (
    <header className="mx-auto mt-2 max-w-md px-6">
      <div className="relative rounded-t-[10rem] rounded-b-2xl border-[3px] border-marigold bg-gulabi-50 p-2 shadow-[0_10px_30px_-18px_rgba(140,28,43,0.6)]">
        <div className="rounded-t-[9.5rem] rounded-b-xl border border-kumkum/25 px-6 pb-6 pt-14 text-center">
          <span aria-hidden className="absolute left-1/2 top-3 h-3 w-3 -translate-x-1/2 rotate-45 bg-marigold" />
          <h1 className="font-display text-[2.1rem] leading-tight text-kumkum">{names}</h1>
          <p className="mt-2 text-[15px] text-ink/70">{sub}</p>
          {welcome && <p className="mx-auto mt-4 max-w-[30ch] text-base leading-relaxed text-ink">{welcome}</p>}
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-mehndi-soft px-3 py-1 text-xs font-semibold text-mehndi">
            <span aria-hidden>✓</span> {verified}
          </p>
        </div>
      </div>
    </header>
  );
}

/** One numbered step; the marigold thread links the four steps like a toran. */
function Section({ id, n, title, done, last, children }: { id: string; n: number; title: string; done: boolean; last?: boolean; children: ReactNode }) {
  return (
    <section id={id} className="relative scroll-mt-6 pl-12">
      {!last && <span aria-hidden className="absolute bottom-0 left-[17px] top-10 w-[2px] bg-marigold/60" />}
      <span aria-hidden className={`absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full text-base font-bold ${done ? "bg-mehndi text-white" : "border-2 border-marigold bg-gulabi-50 text-kumkum"}`}>
        {done ? "✓" : n}
      </span>
      <h2 className="pt-1 text-xl font-bold text-ink">{title}</h2>
      <div className="space-y-3 pb-9 pt-3">{children}</div>
    </section>
  );
}

function Panel({ children, center }: { children: ReactNode; center?: boolean }) {
  return <div className={`mx-auto mt-6 max-w-md space-y-4 px-6 pb-12 ${center ? "text-center" : ""}`}>{children}</div>;
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="mx-auto mt-10 max-w-md px-6 text-center text-lg text-ink">{children}</p>;
}

function Choice({ selected, big, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; big?: boolean }) {
  return (
    <button type="button" aria-pressed={selected}
      className={`rounded-xl border-2 px-4 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumkum ${big ? "min-h-[64px] text-lg" : "min-h-[46px] text-base"} ${selected ? "border-kumkum bg-kumkum text-white" : "border-gulabi-200 bg-white text-ink"} ${className}`}
      {...rest} />
  );
}

function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}
      className="min-h-[56px] w-full rounded-2xl bg-kumkum text-lg font-bold text-white shadow-[0_6px_0_0_#6E1220] transition active:translate-y-[3px] active:shadow-[0_3px_0_0_#6E1220] disabled:bg-gray-400 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marigold" />
  );
}

function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className="min-h-[48px] w-full rounded-xl font-semibold text-kumkum disabled:opacity-50" />;
}

function Label({ text, optional, children }: { text: string; optional?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">
        {text} {optional && <span className="font-normal text-ink/50">({optional})</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({ invalid, className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input {...props}
      className={`min-h-[52px] w-full rounded-xl border-2 bg-white px-4 text-lg text-ink outline-none placeholder:text-ink/35 ${invalid ? "border-kumkum" : "border-gulabi-200 focus:border-kumkum"} ${className}`} />
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-sm font-semibold text-kumkum">{children}</p>;
}

function PhotoPicker({ label, file, onChange, missing }: { label: string; file: File | null; onChange: (f: File | null) => void; missing?: boolean }) {
  const { t } = useTranslation();
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-ink">{label} *</p>
      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-2 ${missing ? "border-kumkum bg-kumkum-soft" : "border-marigold bg-marigold-soft/40"}`}>
        {preview ? (
          <img src={preview} alt="" className="h-20 w-20 rounded-lg object-cover" />
        ) : (
          <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-lg bg-white text-3xl">📷</span>
        )}
        <span className="text-base font-semibold text-kumkum">{file ? t("guest.retake") : t("guest.take_photo")}</span>
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}

function PayStep({ payee, amount, contribution, secret, onDone }: {
  payee: Payee; amount: number; contribution: { id: string; token_no: string }; secret: string; onDone: () => void;
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
          /* optional */
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
    <Panel>
      <h2 className="font-display text-2xl text-kumkum">{t("guest.pay_title")} — ₹{amount.toLocaleString("en-IN")}</h2>
      <p className="rounded-xl border-l-4 border-marigold bg-white p-3 text-[15px] font-semibold text-ink">
        {t("guest.pay_check_name", { name: payee.payee_name })}
      </p>

      {link && payee.upi_id && (
        <div className="space-y-3">
          <a href={link} className="flex min-h-[56px] items-center justify-center rounded-2xl bg-kumkum text-lg font-bold text-white shadow-[0_6px_0_0_#6E1220]">
            {t("guest.pay_with_app")}
          </a>
          <div className="text-center">
            <p className="mb-2 text-sm text-ink/70">{t("guest.scan_qr")}</p>
            <div className="inline-block rounded-2xl border-2 border-marigold bg-white p-3"><QRCodeSVG value={link} size={180} fgColor="#2A1215" /></div>
          </div>
          <CopyRow label={t("guest.upi_id")} value={payee.upi_id} copied={copied === "upi"} onCopy={() => copy("upi", payee.upi_id!)} />
        </div>
      )}

      {payee.bank_account && (
        <details className="rounded-xl border-2 border-gulabi-200 bg-white p-3" open={!link}>
          <summary className="cursor-pointer font-semibold text-ink">{t("guest.bank_details")}</summary>
          <div className="mt-2 space-y-2">
            <CopyRow label={t("guest.account_no")} value={payee.bank_account} copied={copied === "acc"} onCopy={() => copy("acc", payee.bank_account!)} />
            {payee.ifsc && <CopyRow label={t("guest.ifsc")} value={payee.ifsc} copied={copied === "ifsc"} onCopy={() => copy("ifsc", payee.ifsc!)} />}
            {payee.bank_name && <p className="text-sm text-ink/70">{t("guest.bank")}: {payee.bank_name}</p>}
          </div>
        </details>
      )}

      <h3 className="pt-2 text-lg font-bold text-ink">{t("guest.after_pay")}</h3>
      <div className="grid grid-cols-2 gap-2">
        {payee.upi_id && <Choice selected={method === "direct_upi"} onClick={() => setMethod("direct_upi")}>{t("guest.method_upi")}</Choice>}
        {payee.bank_account && <Choice selected={method === "bank_transfer"} onClick={() => setMethod("bank_transfer")}>{t("guest.method_bank")}</Choice>}
      </div>
      <Label text={t("guest.paid_amount")}>
        <TextInput inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, "").slice(0, 7))} />
      </Label>
      <Label text={t("guest.utr_label")}>
        <TextInput value={utr} maxLength={22} inputMode={method === "direct_upi" ? "numeric" : "text"} onChange={(e) => setUtr(e.target.value.trim())} />
      </Label>
      <p className="-mt-2 text-xs text-ink/60">{method === "direct_upi" ? t("guest.utr_help_upi") : t("guest.utr_help_bank")}</p>
      <Label text={t("guest.screenshot_optional")}>
        <input type="file" accept="image/*" className="block w-full text-sm" onChange={(e) => setShot(e.target.files?.[0] ?? null)} />
      </Label>
      {err && <p role="alert" className="text-sm font-semibold text-kumkum">{err}</p>}
      <PrimaryButton disabled={busy} onClick={confirm}>{busy ? t("common.loading") : t("guest.submit_utr")}</PrimaryButton>
    </Panel>
  );
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-gulabi-200">
      <div className="min-w-0">
        <p className="text-xs text-ink/60">{label}</p>
        <p className="truncate text-base font-semibold tracking-wide text-ink">{value}</p>
      </div>
      <button type="button" onClick={onCopy} className="shrink-0 rounded-lg border-2 border-kumkum/30 px-3 py-1 text-sm font-semibold text-kumkum">
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
