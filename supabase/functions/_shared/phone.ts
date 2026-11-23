// Indian mobile validation + "looks fake" heuristics for Smart OTP.
// Deno copy of src/lib/phone.ts — keep both in sync.

export function normalizeMobile(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isValidIndianMobile(m: string): boolean {
  return /^[6-9]\d{9}$/.test(m);
}

/** Returns a reason code when the number looks fake, else null. */
export function suspiciousMobileReason(m: string): string | null {
  if (!isValidIndianMobile(m)) return "invalid";
  const distinct = new Set(m.split("")).size;
  if (distinct <= 2) return "too_few_digits";
  if (/^(\d)0{9}$/.test(m)) return "round_number";
  if (/^(\d\d)\1{4}$/.test(m)) return "repeating_pair";
  if (/^(\d{5})\1$/.test(m)) return "repeating_half";
  const asc = "01234567890123456789";
  const desc = "98765432109876543210";
  if (asc.includes(m) || desc.includes(m)) return "sequence";
  if (/(\d)\1{6,}/.test(m)) return "long_run";
  return null;
}

export function maskMobile(m: string): string {
  return m.length === 10 ? `${m.slice(0, 2)}xxxxx${m.slice(7)}` : m;
}
