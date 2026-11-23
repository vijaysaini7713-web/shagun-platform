# ADR-004: Smart OTP instead of OTP for every guest

**Status:** Accepted
**Date:** 2026-11-23
**Deciders:** Vijay Kumar Saini

## Context
Name and mobile are compulsory, so the family can reciprocate later through the vyavhar register. Fake numbers make that register useless. But OTP for every guest adds an SMS cost per guest, a wait at a crowded venue with poor network, and friction for elderly guests. The owner's instruction was to ask for OTP only when the number already exists in the database or looks fake.

## Decision
Use **Smart OTP**, configurable per wedding as `otp_mode = off | smart | always` (default `smart`). In `smart` mode, `guest-submit` returns `409 otp_required` only when:
1. the mobile's HMAC already exists among this wedding's guests (a duplicate), **or**
2. the number looks fake: two or fewer distinct digits, a round number, a repeating pair or half, an ascending/descending sequence, or a run of 7 or more identical digits; **or**
3. the same device (IP hash) has submitted 4 or more different numbers in 10 minutes.

Counter staff assisted entries skip OTP. OTP codes are hashed, expire in 5 minutes, allow 5 attempts, are limited to 3 sends per number per 10 minutes, and can be used once.

## Options Considered

### Option A: Smart OTP (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium: heuristics plus a challenge table |
| Cost | SMS only for flagged entries (expected well under 10% of guests) |
| Scalability | Good |
| Team familiarity | Medium |

**Pros:** most guests finish in about a minute with no SMS; catches the common fake patterns.
**Cons:** a real but wrong number (someone else's valid number) is not caught.

### Option B: OTP for every guest
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | One SMS per guest |
| Scalability | Depends on the SMS provider and venue network |
| Team familiarity | High |

**Pros:** every number is verified. **Cons:** queues at the venue, SMS delays, drop-offs among older guests.

### Option C: No OTP
**Pros:** fastest. **Cons:** fake numbers and spam entries. Still available as `off` for small family events.

## Trade-off Analysis
At a wedding, speed and goodwill matter more than perfect data. Smart OTP stops the deliberate or lazy fakes (9999999999, 1234567890) and repeat entries, which are the cases that pollute the register. A family that wants certainty can switch to `always`.

## Consequences
- Easier: smooth guest flow, low SMS bill.
- Harder: the heuristics need tuning from real data; `src/lib/phone.ts` and `supabase/functions/_shared/phone.ts` must stay in sync.
- Revisit: after the first 3 weddings. Check how many flagged numbers were real and how many unflagged numbers bounced on the thank-you SMS.

## Action Items
1. [x] Heuristics plus unit tests (`src/lib/__tests__/phone.test.ts`)
2. [x] `guest-otp` function, and the challenge check in `guest-submit`
3. [ ] Choose an SMS provider (MSG91 needs a DLT-registered template in India) before go-live
4. [ ] Add a test that keeps both copies of `phone.ts` identical
