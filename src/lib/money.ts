/** All amounts are stored as integer paise (₹501 = 50100). */
export function paiseToRupees(p: number | null | undefined): number {
  return Math.round((p ?? 0) / 100);
}

export function formatINR(paise: number | null | undefined): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    paiseToRupees(paise),
  );
}

export const QUICK_AMOUNTS = [101, 501, 1100, 2100, 5100, 11000];
