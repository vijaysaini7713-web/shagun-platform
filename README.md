# Shagun Platform — Wedding Shagun, Kanyadaan & Gift Collection

Multi-wedding web app for Indian weddings. Guests scan a QR and record their **online shagun (Direct UPI / bank)**, **lifafa** or **physical gift** in Hindi or English. Gift counter staff match tokens. The family sees everything on a live PC dashboard.

> Phase 1 of the product plan: multi-wedding, Direct UPI + UTR verification, Smart OTP, counter screens, dashboard, encryption, audit log. Payment gateway (Razorpay/Cashfree) is Phase 2.

## Features
- **Guest (mobile, no login):** QR → हिंदी/English → bride/groom side → relation → name + mobile (compulsory) → shagun / kanyadaan / blessing gift → online, lifafa (photo + optional amount) and/or gift (photo) → token number.
- **Smart OTP:** OTP only if the number already gave an entry in this wedding, looks fake (9999999999, 9876543210 …) or many numbers come from one phone. Off / Smart / Always per wedding.
- **Direct UPI:** "Pay with UPI app" deep link, QR, copy UPI ID, bank details → guest enters UTR (+ optional screenshot) → family verifies.
- **Gift counter:** search by token / last 3 digits / name, see guest's photo, mark received, add counter photo, assisted entry for guests without smartphones. Staff never see amounts.
- **Family dashboard (PC):** totals, bride vs groom side, relation-wise, all entries with filters, UTR verify/reject, lifafa counting with mismatch flag, gift gallery, issues tab, activity log, CSV export, QR download, invite staff.
- **Platform admin:** create weddings, invite family admins, counts-only overview.
- **Security:** AES-256 column encryption with Vault key, RLS on every table, 2FA for admins, append-only audit log, private photos with signed URLs, auto-delete date. See [docs/SECURITY.md](docs/SECURITY.md).

## Tech stack
React 18 + Vite + TypeScript + Tailwind · react-i18next · Supabase (Postgres, Auth, Storage, Edge Functions, Vault) · qrcode.react

## Project structure
```
src/
  pages/guest/GuestFlow.tsx     guest mobile flow
  pages/counter/Counter.tsx     gift counter
  pages/admin/                  dashboard, settings, home
  pages/super/SuperAdmin.tsx    platform admin
  locales/hi.json, en.json      all UI text
  lib/                          supabase client, phone rules, UPI, image compression
supabase/
  migrations/                   schema + RLS + encryption + RPCs
  functions/                    guest-submit, guest-otp, guest-utr, invite-member
docs/                           architecture, deploy checklist, testing, security
```

## Setup (step by step)

1. **Create a Supabase project** (Mumbai region recommended).
2. **Create the encryption key once** (SQL editor):
   ```sql
   select vault.create_secret(encode(gen_random_bytes(32), 'base64'), 'shagun_enc_key');
   ```
   Never delete or change it — encrypted data can't be read without it.
3. **Run the migration:**
   ```bash
   npm i -g supabase
   supabase link --project-ref <your-ref>
   supabase db push
   ```
4. **Deploy functions + secrets:**
   ```bash
   supabase secrets set SMS_PROVIDER=msg91 MSG91_AUTH_KEY=... MSG91_TEMPLATE_ID=... \
     IP_HASH_SALT=$(openssl rand -hex 32) ALLOWED_ORIGINS=https://shagunbox.in PUBLIC_BASE_URL=https://shagunbox.in
   supabase functions deploy guest-submit guest-otp guest-utr invite-member
   ```
   (For local testing only: `SMS_PROVIDER=console OTP_DEV_ECHO=true`.)
5. **Auth settings:** turn off public sign-ups, enable Email OTP, put `{{ .Token }}` in the magic-link email template, enable MFA (TOTP), set Site URL to your domain.
6. **Make yourself platform admin** (after your first invite/login):
   ```sql
   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
   First user: create it from Supabase dashboard → Authentication → Add user.
7. **Schedule data purge:** `select cron.schedule('shagun-purge', '30 20 * * *', 'select public.purge_expired_events()');`
8. **Frontend:**
   ```bash
   cp .env.example .env   # add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_PUBLIC_BASE_URL
   npm install
   npm run dev            # http://localhost:5173
   npm test
   npm run build          # deploy dist/ to Vercel / Netlify
   ```
   SPA hosting needs a rewrite of all paths to `/index.html` (Vercel does this for Vite automatically with `vercel.json` included).

## Using it for a wedding
1. Platform admin → **Create wedding** (code like `priya-rahul`) + family admin email.
2. Family admin logs in → sets up 2FA → **Settings**: payee name, UPI ID / bank, OTP mode, invite counter staff → **Download QR**.
3. Run the checklist in [docs/DEPLOY_CHECKLIST.md](docs/DEPLOY_CHECKLIST.md) (₹1 tests on GPay, PhonePe, Paytm).
4. Wedding day: guests scan QR; counter staff use **Gift counter**; family watches **Dashboard**.
5. After: verify UTRs, count lifafe, export CSV.

## Docs
- [Architecture](docs/ARCHITECTURE.md) · [Deploy checklist](docs/DEPLOY_CHECKLIST.md) · [Testing](docs/TESTING.md) · [Security](docs/SECURITY.md)

Engineering docs follow the `system-design`, `deploy-checklist` and `testing-strategy` skills from [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins).
