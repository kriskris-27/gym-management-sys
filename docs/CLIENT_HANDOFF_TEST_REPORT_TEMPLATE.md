# Client handoff — test report template

Copy this file, fill in, and attach to handoff email or ticket.

| Field | Value |
|--------|--------|
| **Date** | YYYY-MM-DD |
| **Tester name** | |
| **Environment** | Staging / Production / Other: ___ |
| **Base URL** | |
| **Git commit SHA** | `git rev-parse HEAD` |
| **Build** | e.g. Vercel deployment ID or `npm run build` log OK |

## Automated gates

| Check | Result (Pass/Fail) | Notes |
|--------|----------------------|-------|
| `pnpm run lint` | | |
| `pnpm run build` | | |
| `pnpm run test` (Vitest) | | |
| `pnpm run test:e2e` (Playwright) | | |

## Manual checklist summary

Reference: [PRE_CLIENT_TEST_CHECKLIST.md](./PRE_CLIENT_TEST_CHECKLIST.md)

| Area | Pass | Fail | N/A | Notes |
|------|------|------|-----|-------|
| Auth | | | | |
| Dashboard | | | | |
| Members | | | | |
| Payments | | | | |
| Attendance admin | | | | |
| Kiosk | | | | |
| Settings | | | | |
| Reports | | | | |
| Cron | | | | |
| Cross-cutting (401s, IST, data) | | | | |

## Open defects

| ID | Severity | Description | Tracking link |
|----|----------|-------------|----------------|
| | | | |

## Known limitations

- (e.g. rate limit in-memory per server instance; lazy subscription expiry until member is “touched”; …)

## Sign-off

- [ ] Product / owner accepts known limitations  
- [ ] Client acknowledges test scope and open items  

**Signature / date:** _________________________
