/** Builds a UPI deep link (NPCI "upi://pay" format). */
export function upiLink(opts: { vpa: string; payee: string; amountRupees?: number; note?: string }): string {
  const p = new URLSearchParams();
  p.set("pa", opts.vpa);
  p.set("pn", opts.payee);
  if (opts.amountRupees && opts.amountRupees > 0) p.set("am", opts.amountRupees.toFixed(2));
  p.set("cu", "INR");
  if (opts.note) p.set("tn", opts.note.slice(0, 50));
  return `upi://pay?${p.toString().replace(/\+/g, "%20")}`;
}

export function isValidUtr(utr: string, method: "direct_upi" | "bank_transfer"): boolean {
  const u = utr.trim().toUpperCase();
  return method === "direct_upi" ? /^\d{12}$/.test(u) : /^[A-Z0-9]{8,22}$/.test(u);
}
