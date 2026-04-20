# Custom scenario-by-scenario test intake

Use this when you describe **one scenario at a time** in chat. Each scenario becomes a **`CUS-*`** case in [`scripts/run-simulated-lifecycle-scenarios.ts`](../scripts/run-simulated-lifecycle-scenarios.ts) (or is mapped to an existing `AUTH-*` / `MEM-*` / `PAY-*` / `ATT-*` / `NOTIF-*` / `REC-*` case).

## How to send a scenario (minimum)

1. **Actor:** admin UI, kiosk, or cron.
2. **Preconditions:** member name/phone or fixture (`SIM_LC_*`), plan state, any dues.
3. **Steps:** exact API paths or UI clicks (API preferred for automation).
4. **Expected:** HTTP status, error `code` if any, and one DB or UI check.

Optional: Given / When / Then.

## Run commands

- Full lifecycle + custom hook: `npm run test:simulated:lifecycle` (requires `npm run dev` on same machine, same `.env` as scripts — scripts load `dotenv/config`).
- Reset fixtures before a clean run: `npm run fixtures:simulated:apply`

Optional base URL: `SIM_BASE_URL=http://127.0.0.1:3000`

## Where results appear

- **Console:** each line `[PASS]` / `[FAIL]` and the final `TOTAL: …`.
- **This doc:** add a row to the log table below when a `CUS-*` is added and run.

## Mapping to existing cases (quick reference)

| Your intent | Likely existing ID |
|-------------|-------------------|
| Login success | AUTH-01 |
| Bad password | AUTH-02 |
| Rate limit | AUTH-03 |
| No cookie on protected API | AUTH-04 |
| Logout | AUTH-05 |
| Create standard member | MEM-01 |
| Create OTHERS member | MEM-02 |
| Duplicate phone | MEM-03 |
| Discount too high | MEM-04 |
| Paid over net due | MEM-05 |
| Bad date range | MEM-06 |
| Renew after expiry (no dues) | MEM-07 |
| Renew blocked with old dues | MEM-08 |
| Soft delete + restore | MEM-09, MEM-10 |
| Record payment | PAY-01 |
| Overpay blocked | PAY-03 |
| Fully paid member extra pay | PAY-04 |
| Payment list filters | PAY-05 |
| Payment summary | PAY-06 |
| Kiosk scan | ATT-01 … ATT-04 |
| Cron close-sessions | ATT-05 … ATT-07 |
| Today / history / reports | ATT-08 |
| Notify cron + logs + summary | NOTIF-* |
| Dashboard + monthly report | REC-* |

## Custom scenario log (fill as you add `CUS-*`)

| ID | Scenario summary | Implemented (date) | Last run result |
|----|------------------|--------------------|-----------------|
| CUS-00 | Intake / runner hook ready | 2026-04-16 | PASS (placeholder) |
| CUS-01A-F | Create-member plan matrix across standard plans and OTHERS combinations | 2026-04-16 | PASS |
| CUS-02A-F | Renewal/payment oracle validation: success, old-due block, live-plan block, overpay block, partial renew ledger, delete/restore anchor | 2026-04-16 | PASS |

## Repeat for each new scenario

1. Paste the next scenario in chat.
2. Maintainer maps or adds `customScenarioSuite` steps, runs `npm run test:simulated:lifecycle`, pastes console summary.
3. Add a row to the table above.
