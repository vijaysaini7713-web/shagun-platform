export type Role = "family_admin" | "viewer" | "counter_staff";
export type Side = "bride" | "groom" | "both";
export type ContributionType = "online" | "lifafa" | "gift";
export type Purpose = "shagun" | "kanyadaan" | "aashirwad_gift";
export type Status =
  | "created" | "pending" | "success" | "failed"
  | "claimed" | "verified" | "rejected" | "refunded"
  | "awaiting_counter" | "received";

export interface PublicEvent {
  code: string;
  bride_name: string;
  groom_name: string;
  event_date: string;
  venue: string | null;
  status: string;
  welcome_text_hi: string | null;
  welcome_text_en: string | null;
  theme_color: string;
  couple_photo_url: string | null;
  payment_mode: "direct" | "gateway" | "both";
  guest_form_open: boolean;
  payee_name: string | null;
  has_upi: boolean;
  has_bank: boolean;
}

export interface EventRow {
  id: string;
  code: string;
  bride_name: string;
  groom_name: string;
  event_date: string;
  venue: string | null;
  status: string;
  otp_mode: "off" | "smart" | "always";
  guest_form_open: boolean;
  welcome_text_hi: string | null;
  welcome_text_en: string | null;
  theme_color: string;
  delete_after: string | null;
}

export interface Payee {
  payee_name: string;
  upi_id: string | null;
  bank_name: string | null;
  bank_account: string | null;
  ifsc: string | null;
}

export interface SubmitResult {
  contributions: { id: string; token_no: string; type: ContributionType }[];
  secret: string;
  uploads: { contribution_id: string; path: string; token: string }[];
  payee: Payee | null;
  otp_verified: boolean;
}

export const RELATIONS = [
  "mama_mami", "chacha_chachi", "tau_tai", "bua_fufa", "mausi_mausa", "nana_nani", "dada_dadi",
  "bhai_behen", "dost", "padosi", "office", "business", "other",
] as const;
