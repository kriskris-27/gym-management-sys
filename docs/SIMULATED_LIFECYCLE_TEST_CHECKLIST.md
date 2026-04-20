# Simulated Lifecycle Test Checklist

This checklist implements the full lifecycle test order with deterministic fixtures and evidence capture.

## 1) Environment + Fixtures

- Target staging-like environment (never production DB).
- Confirm required env vars: `DATABASE_URL`, `CRON_SECRET`, auth secrets.
- Prepare fixtures:
  - Dry run preview: `npm run fixtures:simulated`
  - Apply fixtures: `npm run fixtures:simulated:apply`
- Fixture accounts:
  - `sim_admin` / `sim12345`
  - `sim_staff` / `sim12345`
  - `sim_kiosk` / `sim12345`

## 2) Suite Order (run strictly in this sequence)

1. Auth/session
2. Member/subscription lifecycle
3. Payments lifecycle
4. Attendance lifecycle
5. Notifications lifecycle
6. Dashboard + reports reconciliation

## 3) Test Cases

### A. Auth + Session

- `AUTH-01` Valid login succeeds and redirects.
- `AUTH-02` Invalid login rejected.
- `AUTH-03` Repeated invalid logins trigger rate limit.
- `AUTH-04` Protected APIs return `401` without auth cookie.
- `AUTH-05` Logout invalidates protected requests.

### B. Member + Subscription

- `MEM-01` Create standard-plan member succeeds.
- `MEM-02` Create OTHERS-plan member succeeds.
- `MEM-03` Duplicate phone blocked.
- `MEM-04` Invalid discount blocked.
- `MEM-05` Paid amount > net due blocked.
- `MEM-06` Invalid date range (`end <= start`) blocked.
- `MEM-07` Renewal with no dues succeeds.
- `MEM-08` Renewal with outstanding dues blocked.
- `MEM-09` Soft delete marks member deleted and plan cancelled.
- `MEM-10` Restore reactivates member with expected status handling.
- `MEM-11` Reopen-last-plan matrix: allowed and blocked cases validated.

### C. Payments

- `PAY-01` Payment auto-targets oldest outstanding due.
- `PAY-02` Exact due settlement reaches fully paid state.
- `PAY-03` Current plan overpay blocked.
- `PAY-04` Global overpay blocked.
- `PAY-05` Payment filters: member, phone, method, date range.
- `PAY-06` Member payment summary remains consistent after each action.

### D. Attendance

- `ATT-01` Eligible member scan creates check-in.
- `ATT-02` Too-fast re-scan path enforced.
- `ATT-03` Valid checkout after minimum duration.
- `ATT-04` Same-day already-done behavior verified.
- `ATT-05` Previous-day open session auto-close behavior verified.
- `ATT-06` Cron close-sessions closes previous-day sessions.
- `ATT-07` Cron close-sessions closes max-duration sessions.
- `ATT-08` Consistency across today API, history API, reports API, full history UI.

### E. Notifications

- `NOTIF-01` Cron auth: valid token allowed, invalid denied.
- `NOTIF-02` Expiry targeting for 5-day and 1-day windows is IST-correct.
- `NOTIF-03` Inactivity targeting works with dedupe safeguards.
- `NOTIF-04` Parallel cron run simulation confirms advisory lock behavior.
- `NOTIF-05` Logs filters (`query/status/type/from/to/runId`) and pagination.
- `NOTIF-06` Summary API ordering and totals are correct.

### F. Dashboard + Reports Reconciliation

- `REC-01` Dashboard values match source APIs.
- `REC-02` Monthly reports reconcile with payment and attendance records.
- `REC-03` IST boundary dates do not shift counts/totals.

## 4) Evidence Required Per Case

- Test ID and name
- Preconditions
- Steps
- Expected result
- Actual result
- API request and response snapshot
- DB verification query output
- UI screenshot/video
- Status: `Pass | Fail | Blocked`
- Defect ID/link when failed

## 5) Exit Criteria

- All critical lifecycle tests executed.
- No open Critical/High defects.
- Lint/build pass.
- Go-live recommendation documented with evidence.
