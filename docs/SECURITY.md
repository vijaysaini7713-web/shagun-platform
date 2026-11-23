# Security & data safety

| Threat | Protection |
| --- | --- |
| Database leak | Mobile numbers, UPI ID, bank account and UTR stored with `pgp_sym_encrypt` (AES-256); key lives only in Supabase Vault (`shagun_enc_key`), used inside security-definer DB functions |
| Someone reads another family's data | Every table has RLS keyed on `event_id` + role; platform admins see counts only |
| Frontend tampering | Clients have **no** insert/update/delete on tables; all writes are RPCs/edge functions that re-check role |
| Encrypted columns exposed via API | Column-level grants: `*_enc`, `*_hash`, `guest_secret_hash` are not selectable |
| Admin account takeover | Email OTP login (invite only, sign-up off) + TOTP 2FA; sensitive RPCs require `aal2` |
| Fake numbers / spam entries | Smart OTP, IP-hash rate limits, server-side validation |
| Fake UTR / reused UTR | UTR unique per wedding; family verifies against bank before it counts |
| Fake QR stuck at venue | Guest page shows "Verified" + payee name; guests are told to check receiver name in UPI app |
| Photo leaks | Private bucket, 10-minute signed URLs, EXIF/GPS removed by re-encoding in browser, 5 MB + image types only |
| Spreadsheet formula injection in CSV | Cells starting with `= + - @` are prefixed |
| Insider misuse | Append-only `audit_logs`: reveal number, list full UTR, export, settings, status changes |
| Keeping data forever | `delete_after` per wedding + daily purge (DPDP Act storage limitation) |

**Never** put the service-role key or any SMS/gateway key in `VITE_*` variables.
