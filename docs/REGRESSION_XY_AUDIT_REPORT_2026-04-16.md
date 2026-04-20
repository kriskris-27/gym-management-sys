# Regression X→Y Audit Report

## Execution Summary

| Field | Value |
|---|---|
| Date | 2026-04-16 |
| Environment | Local app at `http://127.0.0.1:3000` |
| Harness | `npm run test:simulated:lifecycle` |
| Fixture preview | `npm run fixtures:simulated` |
| Lifecycle result | `51/51 PASS` |

## Important Notes

- The fixture **dry run** completed successfully.
- The fixture **apply** command failed once with a Prisma database connectivity error:
  - `Can't reach database server at ep-icy-mountain-a1lr63oo.ap-southeast-1.aws.neon.tech:5432`
- Despite that, the lifecycle regression harness itself ran successfully against the current app/database state and returned `51/51 PASS`.
- This means the application behavior matched all currently scripted expectations, but the fixture-apply reliability issue should still be treated as an audit note.

## X→Y Regression Matrix

### Auth + Session

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `AUTH-01` | Valid login with `sim_admin / sim12345` | `200`, auth cookie set, login succeeds | `status=200`, cookie present | PASS |
| `AUTH-02` | Invalid password | `401 Invalid credentials` | `status=401` | PASS |
| `AUTH-03` | Repeated invalid logins from same IP | Rate limit reached with `429` | Rate limit reached within 12 attempts | PASS |
| `AUTH-04` | Protected API without cookie | `401 Unauthorized` | `status=401` | PASS |
| `AUTH-05` | Authenticated dashboard request followed by logout | Protected API works, logout clears session | `dashboard=200`, `logout=200` | PASS |

### Member + Subscription

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `MEM-01` | Create standard-plan member | `201`, member created successfully | `status=201` | PASS |
| `MEM-02` | Create `OTHERS` member with custom fields | `201`, member created successfully | `status=201` | PASS |
| `MEM-03` | Create member with duplicate phone | `409` duplicate blocked | `status=409` | PASS |
| `MEM-04` | Create member with invalid discount | `400` blocked | `status=400` | PASS |
| `MEM-05` | Create member with paid amount above due | `400` blocked | `status=400` | PASS |
| `MEM-06` | Create member with invalid date range | `400` blocked | `status=400` | PASS |
| `MEM-07` | Renew expired member with no dues | `200`, renewal succeeds | `status=200` | PASS |
| `MEM-08` | Renew expired member with outstanding dues | `403`, renewal blocked | `status=403` | PASS |
| `MEM-09` | Soft-delete member | `200`, delete succeeds | `delete=200` | PASS |
| `MEM-10` | Restore deleted member | `200`, restore succeeds | `restore=200` | PASS |

### Payments

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `PAY-01` | Record payment against due member | `201`, payment saved | `status=201` | PASS |
| `PAY-02` | Recompute summary after payment | Remaining amount stays internally consistent | `remaining after payment=1525` | PASS |
| `PAY-03` | Try overpay on due member | `4xx`, overpay blocked | `status=400` | PASS |
| `PAY-04` | Try payment for fully-paid member | `409` or equivalent block | `status=409` | PASS |
| `PAY-05` | Payment list with member/mode/date filters | `200`, filtered list works | `status=200` | PASS |
| `PAY-06` | Fetch payment summary | `200`, summary works | `status=200` | PASS |

### Attendance

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `ATT-01` | Scan active member | No server error; check-in path succeeds | `status=200` | PASS |
| `ATT-02` | Re-scan same member | No server error; duplicate/checkout path handled | `status=200` | PASS |
| `ATT-03` | Checkout/min-duration path | Should not crash | No crash | PASS |
| `ATT-04` | Same-day duplicate path | Should not crash | No crash | PASS |
| `ATT-05` | Run close-sessions cron with auth | `200` | `status=200` | PASS |
| `ATT-06` | Previous-day open session exists | At least one session closed | `closedSessions=1` | PASS |
| `ATT-07` | Max-duration close path | Endpoint completes successfully | Executed | PASS |
| `ATT-08` | Today/history/member-history/reports APIs | All return `200` consistently | `today=200, history=200, member=200, reports=200` | PASS |

### Notifications

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `NOTIF-01A` | Notify cron without auth | `401` | `unauth=401` | PASS |
| `NOTIF-01B` | Notify cron with valid auth | `200` | `auth=200` | PASS |
| `NOTIF-02` | Expiry notification job run | Job executes successfully | Executed | PASS |
| `NOTIF-03` | Inactivity/dedupe job run | Job executes successfully | Executed | PASS |
| `NOTIF-04` | Two parallel cron runs | Advisory lock blocks one run with `409` | `parallel statuses=200,409` | PASS |
| `NOTIF-05` | Notification logs filters and search | `200` for logs endpoints | `logs=200, logsQ=200` | PASS |
| `NOTIF-06` | Notification summary | `200` and recent runs present | `status=200, runs=3` | PASS |

### Dashboard + Reconciliation

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `REC-01` | Dashboard + attendance + members APIs | All reconcile at endpoint level | `dash=200, attendance=200, members=200` | PASS |
| `REC-02` | Monthly report + payments APIs | Both return `200` and reconcile at endpoint level | `report=200, payments=200` | PASS |
| `REC-03` | IST boundary-sensitive aggregate APIs | No date-boundary crash or endpoint mismatch | Endpoints responded correctly | PASS |

### Custom Scenario Oracles

| Case | Input X | Expected Y | Actual | Result |
|---|---|---|---|---|
| `CUS-01A` | Create full-paid MONTHLY member | Base `1200`, paid `1200`, correct end date | Matched | PASS |
| `CUS-01B` | Create partial-paid QUARTERLY member | Base `3000`, paid `500`, correct end date | Matched | PASS |
| `CUS-01C` | Create unpaid HALF_YEARLY member | Base `5400`, paid `0`, correct end date | Matched | PASS |
| `CUS-01D` | Create ANNUAL with admission fee | Base `9900`, paid `9900`, correct end date | Matched | PASS |
| `CUS-01E` | Create MONTHLY with discount | Base `1200`, paid `1000`, correct end date | Matched | PASS |
| `CUS-01F` | Create `OTHERS` custom plan | Base `2050`, paid `500`, custom end date | Matched | PASS |
| `CUS-02A` | Renew fully-paid expired member | New annual sub created, old sub unchanged, remaining `0` | Matched | PASS |
| `CUS-02B` | Renew member with old due | `403 OUTSTANDING_BALANCE` | Matched | PASS |
| `CUS-02C` | Renew member with live plan | `400 ALREADY_HAS_LIVE_PLAN` | Matched | PASS |
| `CUS-02D` | Renew with overpay | `400 PAID_EXCEEDS_DUE` | Matched | PASS |
| `CUS-02E` | Partial renewal | New sub remaining only, old sub remains settled | Matched | PASS |
| `CUS-02F` | Delete/restore then renew | Fresh operational anchor, expected remaining `900` | Matched | PASS |

## Overall Verdict

- **Scripted regression status:** PASS
- **Pass count:** `51/51`
- **Mismatch count:** `0`
- **Immediate code-fix recommendation:** None based on the current scripted regression harness output.

## Gaps In Current Regression Coverage

These are the important places where the harness is still weaker than a true production-grade regression suite, even though the current run passed.

### 1. Some cases verify only status / non-crash, not full business truth

- `ATT-03` and `ATT-04` only assert that the path “does not crash”.
- `NOTIF-02` and `NOTIF-03` only assert that the job executed, not that every targeted member set is exactly correct.
- `REC-*` cases are endpoint-level consistency checks, not deep field-by-field reconciliation against a DB oracle.

### 2. Stale checklist item still mentions removed reopen-plan behavior

- `docs/SIMULATED_LIFECYCLE_TEST_CHECKLIST.md` still includes `MEM-11 Reopen-last-plan matrix`.
- That lifecycle path was removed from the app, so this checklist is out of date relative to the implemented product behavior.

### 3. No formal Vitest / Playwright suites exist

- `npm run test` and `npm run test:e2e` are configured in `package.json`, but the repository still lacks real executable Vitest and Playwright test files.
- Current regression confidence depends heavily on the custom script rather than CI-grade automated test suites.

### 4. Fixture apply reliability issue

- The fixture apply script failed once due to a Prisma/DB connectivity error.
- Even though the lifecycle run succeeded afterward, the fixture setup path itself is not yet fully reliable as a repeatable regression gate.

### 5. Limited UI-level verification

- The harness mainly validates API and DB outcomes.
- It does not verify screenshots, visual state, browser behavior, or interactive admin flows the way a production-grade Playwright suite would.

## Recommended Next Step

If you want the next level of production-grade regression safety, the best next move is:

1. Keep this simulated lifecycle harness as a fast business-rule smoke/regression suite.
2. Add a small formal automated suite for:
   - auth/session
   - member renew/delete/restore
   - payment overpay / due logic
   - notification cron auth + dedupe
3. Remove or update stale manual checklist items so the regression expectations match the actual product.
