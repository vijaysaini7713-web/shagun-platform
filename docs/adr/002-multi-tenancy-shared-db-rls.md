# ADR-002: Multi-wedding tenancy — one database, `event_id` + RLS

**Status:** Accepted
**Date:** 2026-11-23
**Deciders:** Vijay Kumar Saini

## Context
The product is a platform: many weddings, each with its own family admins, counter staff, guests and money. One family must never see another family's data. Even the platform owner should see only counts unless a family adds them to its wedding. The team is small and runs on Supabase.

## Decision
Use a **single Supabase project and schema**. Every data table carries `event_id`, and access is decided by Row Level Security through `has_event_role(event_id, roles[])`, which reads `user_roles`. Platform admins are a separate table (`platform_admins`) and are **not** given implicit access to family data. All writes go through RPCs that re-check the role.

## Options Considered

### Option A: Shared tables + `event_id` + RLS (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low to medium: one migration path; the policies must be correct |
| Cost | One project |
| Scalability | Thousands of weddings on one Postgres |
| Team familiarity | High (Lovable/Supabase pattern) |

**Pros:** one deploy; cross-wedding reporting for the platform (counts only); new weddings are just rows.
**Cons:** one RLS mistake can leak data across weddings, so policies need tests.

### Option B: Schema per wedding
| Dimension | Assessment |
|-----------|------------|
| Complexity | High: dynamic schemas, migrations repeated N times, PostgREST exposure per schema |
| Cost | One project |
| Scalability | Migration pain grows with N |
| Team familiarity | Low |

**Pros:** stronger isolation by structure. **Cons:** operationally heavy; Supabase tooling assumes few schemas.

### Option C: Supabase project per wedding
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium to high: provisioning automation |
| Cost | Grows with every wedding |
| Scalability | Poor for many small weddings |
| Team familiarity | Medium |

**Pros:** total isolation. **Cons:** cost and ops; no platform overview.

## Trade-off Analysis
The isolation risk in Option A is real but testable, and Postgres enforces it at the row level even if the frontend is compromised. Options B and C buy isolation with operational cost that a small team cannot carry across hundreds of weddings.

## Consequences
- Easier: creating a wedding (`create_event`), platform overview, one codebase.
- Harder: every new table needs `event_id`, RLS enabled, policies, and column grants; reviews must check this.
- Revisit: if a large client wants contractual data separation, offer them Option C as a premium deployment.

## Action Items
1. [x] RLS on all tables; client writes revoked; RPCs check roles
2. [x] Integration SQL tests: counter staff cannot read `guests`; anon reads nothing
3. [ ] pgTAP RLS tests in CI for every table and role
4. [ ] PR checklist item: "new table has `event_id` + RLS + policies"
