# Test Strategy

> From the **testing-strategy** skill in [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/engineering/skills/testing-strategy). Focus: business-critical paths, error handling, security boundaries, data integrity.

| Area | Test type | Status |
| --- | --- | --- |
| Phone validation + Smart OTP heuristics (`src/lib/phone.ts`) | Unit (vitest) | ✅ `src/lib/__tests__/phone.test.ts` |
| UPI link + UTR format (`src/lib/upi.ts`) | Unit (vitest) | ✅ `src/lib/__tests__/upi.test.ts` |
| Migration applies cleanly | Integration (Postgres 16 + Supabase stubs) | ✅ run before commit |
| Guest submit → encrypted mobile, masked copy, token numbers | Integration SQL | ✅ |
| UTR claim, duplicate UTR blocked | Integration SQL | ✅ |
| Counter staff cannot read `guests` table / amounts | Security SQL | ✅ |
| `reveal_guest_mobile` needs aal2 | Security SQL | ✅ |
| anon cannot read any table; cannot call `svc_*` | Security SQL | ✅ |
| Edge functions (Deno) | Manual on staging + `supabase functions serve` | ⏳ |
| Full guest flow on real phones (Android Chrome, iOS Safari) | E2E manual | ⏳ before each wedding |
| Real UPI ₹1 payments on 3 apps | Manual | ⏳ before each wedding |

**Gaps to close next:** Playwright E2E for guest flow; pgTAP tests in CI for RLS; load test (100 submits / 10 min).
