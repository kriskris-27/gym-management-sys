# Simulated Lifecycle Regression Report

## Execution Metadata

| Field | Value |
|---|---|
| Date | 2026-04-15 |
| Scope | Complete lifecycle testing (simulated scenarios) |
| Environment | Local verification + staging execution template |
| Fixture script | `npm run fixtures:simulated` / `npm run fixtures:simulated:apply` |

## Automated Gate Results

| Check | Result | Notes |
|---|---|---|
| `npm run fixtures:simulated` | Pass | Dry-run executed successfully; script output verified fixture matrix |
| `npm run lint` | Pass | No ESLint errors |
| `npm run build` | Pass | Next.js production build completed successfully |

## Lifecycle Suite Status

| Suite | Status | Notes |
|---|---|---|
| Auth/session | Ready | Execute `AUTH-*` against staging using seeded fixture users |
| Member/subscription | Ready | Execute `MEM-*` with fixture matrix and capture evidence |
| Payments | Ready | Execute `PAY-*`, especially overpay and oldest-due targeting |
| Attendance | Ready | Execute `ATT-*`, including auto-close and history consistency |
| Notifications | Ready | Execute `NOTIF-*`, including lock/dedupe and IST windows |
| Dashboard/reconciliation | Ready | Execute `REC-*` and reconcile with source APIs |

## Defect Log

| ID | Severity | Area | Summary | Status |
|---|---|---|---|---|
| SIM-001 | High | Automated gates | `npm run test` fails because no Vitest test files exist (`include: **/*.test.ts`) | Open |
| SIM-002 | High | Automated gates | `npm run test:e2e` fails because no Playwright tests exist (`No tests found`) | Open |
| SIM-003 | Medium | Fixture coverage | Orphan/null-subscription payment in simulated fixtures | Closed (see `scripts/setup-simulated-lifecycle-fixtures.ts`) |
| SIM-004 | Medium | Fixture coverage | Auto-closed attendance in simulated fixtures | Closed (see fixture script) |
| SIM-005 | Medium | Fixture coverage | Notification `SKIPPED` + multi-run breadth | Closed (see fixture script) |

## Go-Live Recommendation

Current recommendation: **Proceed to staged execution** using this checklist pack.  
Final go-live decision remains **Blocked** until all suite executions are complete and no Critical/High defects remain.

## Custom scenario-by-scenario intake

- Procedure and mapping table: [CUSTOM_SCENARIO_TEST_INTAKE.md](./CUSTOM_SCENARIO_TEST_INTAKE.md)
- Current automated run: `npm run test:simulated:lifecycle` — expect **51/51 PASS** when `next dev` is up and `.env` matches the database.
- Included custom packs:
  - `CUS-01A-F`: create-member plan matrix
  - `CUS-02A-F`: renewal/payment expected-output oracle validation

## Renewal oracle results

- Oracle scope: renewal eligibility, old-due protection, live-plan block, overpay rejection, per-subscription ledger integrity, global ledger integrity, and delete/restore anchor behavior.
- Latest result: **PASS**
- Cases verified:
  - `CUS-02A` expired fully-paid member renews successfully; old subscription unchanged; new annual renewal fully settled
  - `CUS-02B` expired member with old due is blocked with `OUTSTANDING_BALANCE`
  - `CUS-02C` live-plan renewal is blocked with `ALREADY_HAS_LIVE_PLAN`
  - `CUS-02D` renewal overpay is blocked with `PAID_EXCEEDS_DUE`
  - `CUS-02E` partial renewal affects only the new subscription and current-cycle remaining
  - `CUS-02F` delete/restore creates a clean operational anchor; pre-delete money does not pollute post-restore renewal summary

## Links

- Checklist: `docs/SIMULATED_LIFECYCLE_TEST_CHECKLIST.md`
- Existing handoff template: `docs/CLIENT_HANDOFF_TEST_REPORT_TEMPLATE.md`
- Custom intake: `docs/CUSTOM_SCENARIO_TEST_INTAKE.md`
