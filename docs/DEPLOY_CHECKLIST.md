# Deploy Checklist: Shagun Platform

> Format from the **deploy-checklist** skill in [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/engineering/skills/deploy-checklist), customised for "this includes a database migration" and for a real wedding going live.

**Date:** ____ | **Deployer:** ____ | **Wedding / release:** ____

### Pre-Deploy
- [ ] `npm test` and `npm run build` pass
- [ ] Code reviewed and approved
- [ ] Vault secret `shagun_enc_key` exists in the target project (**never** change it after data exists)
- [ ] Migration run on a staging project first; `select public_event('<code>')` works
- [ ] Supabase Security Advisor: no RLS warnings
- [ ] Edge function secrets set: `SMS_PROVIDER`, provider keys, `IP_HASH_SALT`, `ALLOWED_ORIGINS`, `PUBLIC_BASE_URL`; `OTP_DEV_ECHO` **not** set in production
- [ ] Auth: public sign-up disabled, email OTP template shows `{{ .Token }}`, site URL = production domain
- [ ] pg_cron purge job scheduled
- [ ] Rollback plan written (below)

### Deploy
- [ ] `supabase db push` (migration) → `supabase functions deploy guest-submit guest-otp guest-utr invite-member`
- [ ] Frontend deployed (Vercel/Netlify) with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_BASE_URL`
- [ ] Smoke test on a phone: scan QR → full guest flow → token shown
- [ ] ₹1 real UPI test from **GPay, PhonePe and Paytm**; receiver name matches payee name
- [ ] Bank transfer details copy correctly
- [ ] Counter staff login → search token → mark received
- [ ] Family admin login with 2FA → verify the ₹1 UTR → totals update

### Before the wedding day
- [ ] Venue mobile network / Wi-Fi checked at the gift counter
- [ ] QR printed (entry gate + gift counter), token stickers/pen at counter
- [ ] Event status = `live`, guest form open, OTP mode chosen

### Post-Deploy
- [ ] Dashboard numbers match test entries
- [ ] Activity log shows the test actions
- [ ] Family told how to verify UTRs and count envelopes

### Rollback Triggers
- Guest submit error rate above 5% for 10 minutes → switch event to "form closed", use assisted entry at counter
- UPI link fails on any major app → tell guests to use QR / copy UPI ID (already on screen)
- Any data visible to the wrong role → close form, revoke roles, investigate audit log
