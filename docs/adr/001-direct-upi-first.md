# ADR-001: Direct UPI first, payment gateway in Phase 2

**Status:** Accepted
**Date:** 2026-11-23
**Deciders:** Vijay Kumar Saini (product owner)

## Context
Guests want to give shagun online. The family wants every rupee tracked and failed payments explained. Options are a payment gateway (Razorpay / Cashfree), where status comes back automatically, or Direct UPI, where money goes straight to the family's UPI ID or bank account and the app cannot see the bank. The platform will serve many weddings, so whoever receives the money matters legally: an entity that collects funds and passes them on to others falls under RBI's Payment Aggregator rules. Phase 1 has to ship quickly with a small team.

## Decision
Phase 1 uses **Direct UPI + bank transfer**. The guest gets an `upi://pay` deep link with the amount filled in, a QR code and copy buttons. After paying, the guest submits the UTR (plus an optional screenshot) and the family admin verifies it against their bank. Money never passes through the platform. A gateway is added in Phase 2 behind the existing `payment_mode` flag (`direct | gateway | both`).

## Options Considered

### Option A: Direct UPI + UTR verification (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low: no gateway onboarding, no webhooks |
| Cost | Zero transaction fees |
| Scalability | Manual verification effort grows with guest count (about 1 minute per 10 UTRs) |
| Team familiarity | High |

**Pros:** no fees; money lands in the family's own account the same moment; no KYC per wedding; no regulatory exposure for the platform.
**Cons:** status is "claimed", not confirmed, until the family checks; some UPI apps limit pre-filled-amount links to personal VPAs (the QR and copy fallbacks cover this); a fake UTR is possible (mitigated by a unique-UTR constraint and bank matching).

### Option B: Payment gateway on a platform account
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium: orders, checkout, webhooks, refunds |
| Cost | Per-transaction gateway fee |
| Scalability | High: fully automatic status |
| Team familiarity | Medium |

**Pros:** instant success/failed status with reason codes; no manual work.
**Cons:** the platform holds other families' money, which raises Payment Aggregator licensing questions; fees on every shagun; settlement delay.

### Option C: Gateway with per-family linked accounts (Razorpay Route style)
| Dimension | Assessment |
|-----------|------------|
| Complexity | High: per-family KYC onboarding plus split settlements |
| Cost | Gateway fee plus onboarding effort per wedding |
| Scalability | High |
| Team familiarity | Low |

**Pros:** automatic status, and money is settled to each family.
**Cons:** every family must complete KYC before the wedding; the slowest to ship.

## Trade-off Analysis
For a wedding, the biggest risks are guests failing to pay and money going to the wrong place, not the family's verification effort after the event. Option A puts money in the right account at no cost and ships in days. The cost is manual verification, which the dashboard keeps small (an Issues tab, UTR shown next to the amount, one-click verify). Option C is the right long-term model for families who want automatic confirmation, and the data model already supports it (`payments.gateway_*`, the statuses `success` and `failed`, and failure fields).

## Consequences
- Easier: launch, compliance, and family trust ("the money comes straight to us").
- Harder: totals show "verified" and "pending verification" separately until the family checks; reconciliation is manual.
- Revisit: when families report verification effort or fake UTRs, or when a premium plan wants auto-confirmation. Then do Option C, not B.

## Action Items
1. [x] `payments` table with encrypted and hashed UTR, unique per wedding
2. [x] Guest UTR flow and admin verify/reject
3. [ ] Before every wedding: ₹1 tests from GPay, PhonePe and Paytm (deploy checklist)
4. [ ] Phase 2: bank statement CSV import with automatic UTR matching
5. [ ] Phase 2: gateway with per-family linked accounts, plus signature-verified webhooks
