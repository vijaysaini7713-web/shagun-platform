# ADR-003: Encrypt PII inside Postgres with a Vault-held key

**Status:** Accepted
**Date:** 2026-11-23
**Deciders:** Vijay Kumar Saini

## Context
The requirement is that data stays safe even if someone gets into the system. The sensitive fields are guest mobile numbers, the family's UPI ID and bank account number, and payment UTRs. Supabase already encrypts disks at rest, but that does not protect against a leaked database dump, a misconfigured API, or someone browsing the table editor. We also need to search for duplicate mobiles (for Smart OTP) without decrypting every row.

## Decision
Encrypt these columns with `pgp_sym_encrypt` (AES-256) **inside security-definer Postgres functions**. The key is read from **Supabase Vault** (`shagun_enc_key`). Store an HMAC-SHA256 of each value (keyed with the same secret) for equality lookups, and a masked copy (`98xxxxx345`) for display. Encrypted and hash columns are excluded from client column grants. Full values come back only through audited RPCs (`reveal_guest_mobile`, `admin_list_payments`) that require 2FA (`aal2`).

## Options Considered

### Option A: DB-side pgcrypto + Vault key (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low: a few SQL helpers |
| Cost | Free |
| Scalability | Fine at wedding scale (decryption only on reveal or verify) |
| Team familiarity | Medium |

**Pros:** the key never reaches the browser or edge code; one place to audit; works with RLS.
**Cons:** the key and data live in the same project, so a full superuser compromise defeats it; no built-in key rotation.

### Option B: App-level encryption in edge functions with an external KMS
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium to high: a KMS account, network calls, key caching |
| Cost | KMS fees |
| Scalability | Good |
| Team familiarity | Low |

**Pros:** key separated from the database. **Cons:** more moving parts; the dashboard needs a server hop for every decrypt.

### Option C: Rely on disk encryption + RLS only
| Dimension | Assessment |
|-----------|------------|
| Complexity | Lowest |
| Cost | Free |
| Scalability | Good |
| Team familiarity | High |

**Pros:** simple. **Cons:** a dump or a policy mistake exposes plain mobile and bank numbers. Rejected.

## Trade-off Analysis
Option A removes the realistic leak paths (dumps, exports, table editor, API misconfiguration) at near-zero cost. Option B only adds protection against a full project compromise, and it would cost more to build than all of Phase 1's security work together.

## Consequences
- Easier: masked data everywhere by default; the audit log shows every reveal.
- Harder: data can only be searched by exact match (through the hash), not by partial number. Losing the Vault secret means losing the data, so it must be backed up offline.
- Revisit: when there are compliance audits or enterprise clients. Move to Option B, and add a `key_version` column with a re-encryption job for rotation.

## Action Items
1. [x] `private.encrypt/decrypt/hmac/mask` helpers; column grants exclude `*_enc` and `*_hash`
2. [x] 2FA-gated, audited reveal RPCs
3. [ ] Store an offline copy of `shagun_enc_key` (password manager) before the first real wedding
4. [ ] Add `key_version` before any rotation is needed
