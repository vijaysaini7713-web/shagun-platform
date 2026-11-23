// SMS sender for OTP. Choose provider with SMS_PROVIDER = msg91 | twilio | console.
// "console" only logs a notice (never the code) — use it for local dev with OTP_DEV_ECHO=true.

export async function sendOtpSms(mobile10: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const provider = Deno.env.get("SMS_PROVIDER") ?? "console";
  try {
    if (provider === "msg91") {
      const res = await fetch("https://control.msg91.com/api/v5/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", authkey: Deno.env.get("MSG91_AUTH_KEY")! },
        body: JSON.stringify({
          template_id: Deno.env.get("MSG91_TEMPLATE_ID"),
          mobile: `91${mobile10}`,
          otp: code,
        }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `msg91_${res.status}` };
    }
    if (provider === "twilio") {
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
      const auth = btoa(`${sid}:${Deno.env.get("TWILIO_AUTH_TOKEN")}`);
      const body = new URLSearchParams({
        To: `+91${mobile10}`,
        From: Deno.env.get("TWILIO_FROM")!,
        Body: `Shagun OTP: ${code}. 5 minute mein expire hoga. Kisi ke saath share na karein.`,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      return res.ok ? { ok: true } : { ok: false, error: `twilio_${res.status}` };
    }
    console.log(`[sms:console] OTP generated for xxxxxx${mobile10.slice(6)}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sms_failed" };
  }
}
