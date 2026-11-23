# Architecture — Shagun Platform

> Written with the **system-design** skill from [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/engineering/skills/system-design): requirements → high-level design → deep dive → scale & reliability → trade-offs.

## 1. Requirements

**Functional**
- Multi-wedding platform: one platform admin creates many weddings (events); each wedding has its own QR, UPI/bank details, family admins and counter staff.
- Guest (no login, mobile): scan QR → Hindi/English → side (bride/groom/both) → relation → name + mobile (both compulsory) → purpose (shagun / kanyadaan / blessing gift) → one or more of: online (Direct UPI / bank), lifafa (photo + optional amount), physical gift (photo).
- Smart OTP: OTP only when the number already exists in this wedding, looks fake, or many numbers come from one device. Admin can set Off / Smart / Always.
- Gift counter staff: search token / last 3 digits / name, see guest's photo, mark received, add counter photo, do assisted entries for guests without smartphones.
- Family dashboard (PC first, responsive): totals, side and relation split, entries table, UTR verification, lifafa counting with mismatch flag, gift gallery, issues, activity log, CSV export, QR download, team invites.

**Non-functional**
- Load: a big wedding ≈ 500–2,000 guests, peak maybe 100 submissions in 10 minutes. Supabase free/pro tier is enough.
- Security first: encrypted PII, RLS, 2FA for admins, audit log, no money held by the platform.
- Works on cheap Android phones and slow venue networks (small bundle, photo compression before upload).

**Constraints**
- Phase 1 = Direct UPI only (no gateway). Team is small; stack must match existing Lovable + Supabase experience.

## 2. High-level design

```
 Guest phone ──QR──► React SPA (/w/:code) ──► Edge Functions (guest-submit, guest-otp, guest-utr)
                                                   │ service role
 Counter / Family ──► React SPA (/app/...) ──► PostgREST + RPC (RLS, security-definer functions)
                                                   │
                                     Postgres (Supabase) ── Vault key ── pgcrypto (AES-256)
                                                   │
                                     Storage bucket shagun-media (private, signed URLs)
```

- **Frontend:** Vite + React + TypeScript + Tailwind, react-i18next (Hindi/English), PWA manifest.
- **Guest writes** never touch tables directly: they go through Edge Functions that validate, rate limit and call `svc_*` database functions (service role only).
- **Staff/admin** use the Supabase JS client with their JWT; RLS + column grants decide what they can read; all writes are RPCs.

## 3. Deep dive

### Data model (see `supabase/migrations/20261123000001_init.sql`)
| Table | Purpose |
| --- | --- |
| `events` | One row per wedding (multi-tenant key `event_id` everywhere) |
| `event_payment_settings` | Payee name, UPI ID and account number **encrypted**, masked copies for display |
| `user_roles` | (user, event, role) — family_admin / viewer / counter_staff |
| `guests` | Name, side, relation; mobile **encrypted** + HMAC hash (dedupe/search) + masked |
| `contributions` | One row per online / lifafa / gift, token number, status, amounts in paise |
| `payments` | UTR claims (UTR encrypted + hashed, unique per wedding), verify/reject |
| `media` | Photo paths in the private bucket |
| `otp_challenges`, `rate_events` | Service-role only |
| `audit_logs` | Append-only |

### API surface
| Caller | Endpoint | Notes |
| --- | --- | --- |
| anon | `rpc/public_event(code)` | Safe event fields only |
| anon | `functions/guest-submit` | Validation, Smart OTP, rate limit, signed upload URLs, payee only for online |
| anon | `functions/guest-otp` | send / verify, hashed codes, 5 min expiry, 5 attempts |
| anon | `functions/guest-utr` | One-time secret proves ownership of the entry |
| authenticated | `rpc/counter_lookup`, `counter_mark_received`, `attach_counter_photo` | No amounts for counter staff |
| authenticated | `rpc/event_summary`, `admin_list_payments`, `admin_verify_payment`, `admin_set_counted_amount`, `reveal_guest_mobile`, `set_payment_settings`, `update_event_settings`, `remove_member`, `log_action` | Role + 2FA checks inside |
| authenticated | `rpc/create_event`, `platform_overview` | Platform admin; counts only |
| authenticated | `functions/invite-member` | Email invite + role |

### Error handling
- Edge functions return stable error codes (`invalid_mobile`, `otp_required`, `utr_already_used` …) that map 1:1 to translated messages.
- Photo upload failure never loses the entry: the token is still shown and staff can add a counter photo.

## 4. Scale and reliability
- Hot paths are single-row inserts; token numbers come from an atomic `UPDATE … RETURNING` on the event row.
- Dashboard polls every 20 s while visible (cheap at wedding scale; swap to Supabase Realtime later).
- Daily `purge_expired_events()` (pg_cron) enforces data retention.
- Supabase point-in-time recovery for backups.

## 5. Trade-offs
| Decision | Why | Revisit when |
| --- | --- | --- |
| Direct UPI first, gateway later | Zero fees, money goes straight to family; but needs manual UTR verification | Families ask for auto-confirmation → add Razorpay/Cashfree (Phase 2) with linked accounts so the platform never holds funds |
| Email OTP for staff login | Free, no SMS provider needed | Families prefer phone login → enable Supabase phone auth with MSG91/Twilio |
| DB-side encryption with Vault key | Keys never reach the browser or edge code; simple | Need key rotation → add `key_version` column and re-encrypt job |
| Polling instead of Realtime | Simpler, fewer moving parts | > 50 concurrent dashboard users per wedding |
| CSV export (Excel opens it) | No heavy library | Families want formatted Excel/PDF reports |
