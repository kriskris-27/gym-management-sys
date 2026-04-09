# Pre-client manual test checklist

Run on **staging** (or local) with production-like config. Record **Pass / Fail / N/A** and notes.

**Release gate (automated — run first):**

- [ ] `pnpm run lint` (or `npm run lint`)
- [ ] `pnpm run build` (runs Prisma generate + Next build in this repo)
- [ ] `pnpm run test` (Vitest — **76** tests: `gym-datetime`, `validations`, `utils`, payment guards & validation)
- [ ] `pnpm run build && pnpm exec playwright install chromium && pnpm run test:e2e` (E2E smoke; first time installs browsers)

---

## Feature matrix

### Auth

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| A1 | Open `/login`, valid username + password | Redirect to admin / dashboard | |
| A2 | Wrong password | Error message, stay on login | |
| A3 | Many failed attempts from same client | Eventually rate limited (429) | |
| A4 | Logout | Cookie cleared; admin URLs require login again | |

### Dashboard

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| D1 | Logged in: `/admin/dashboard` | Summary loads (`/api/dashboard/summary` OK) | |
| D2 | Logged out: open `/admin/dashboard` | Redirect to `/login` | |

### Members

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| M1 | `/admin/members` list, search, status filter | List updates; pagination sane | |
| M2 | `/admin/members/new` — standard plan (not OTHERS) | Member created; profile opens | |
| M3 | Create member with **duplicate phone** | Clear error (e.g. 409) | |
| M4 | Open `/admin/members/[id]` — edit save | Updates persist | |
| M5 | Invalid or deleted member id | Not found / appropriate UI | |
| M6 | Renew / add plan flows (per UI) | Works when business rules allow | |

### Payments

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| P1 | Record payment on member profile | Success; summary updates | |
| P2 | Amount over allowed balance | Blocked with message / error code | |
| P3 | `/admin/payments` filters | List respects filters | |

### Attendance (admin)

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| T1 | `/admin/attendance` | Today’s data loads | |
| T2 | Without session: hit `GET /api/attendance/today` | **401** (see cross-cutting) | |

### Kiosk / check-in

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| K1 | `/checkin` — member with **active** plan | Check-in success path | |
| K2 | Wrong phone | Not found / safe message | |
| K3 | Expired or inactive member | No entry; inactive message | |
| K4 | Same flow on a **real phone** (mobile browser) | Usable layout | |

### Settings

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| S1 | `/admin/settings` load pricing | Values match API | |
| S2 | Save pricing / admission | Persists after refresh | |
| S3 | Change password (if used) | Rules enforced; re-auth if required | |

### Reports

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| R1 | `/admin/reports` current month | Aggregates load | |
| R2 | Invalid `year` / `month` query params | No crash; sensible fallback | |

### Cron (only if scheduled in production)

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| C1 | `GET /api/cron/close-sessions` with `Authorization: Bearer <CRON_SECRET>` | 200 / JSON body per implementation | |
| C2 | Same without secret (when `CRON_SECRET` is set) | **401** | |
| C3 | `POST /api/cron/notify` with `Authorization: Bearer <CRON_SECRET>` | 200 / JSON stats | |

---

## Cross-cutting (production-style)

### Authorization (API without cookie)

With **no** auth cookie (incognito or `curl` without `-b`):

- [ ] `GET /api/dashboard/summary` → **401**
- [ ] `GET /api/members` → **401**
- [ ] `GET /api/payments` → **401**
- [ ] `POST /api/attendance/scan` → **200** allowed (public kiosk) — verify intentionally public

Example:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/dashboard/summary
```

Expect `401`.

### IST / membership boundaries

- [ ] One member with **end date yesterday** (IST): after opening profile or payment, status matches **expired / inactive** rules.
- [ ] One member with **future start**: kiosk shows “starts on …” style behavior if applicable.

### Data isolation

- [ ] Staging `DATABASE_URL` is **not** production (unless explicitly allowed).
- [ ] Client knows **backup / restore** (e.g. Neon snapshots).

### PWA / offline (if used)

- [ ] Install / offline behavior acceptable or documented as unsupported.

---

## Automated suites (after setup)

- Unit: `npm run test`
- E2E (needs build + browsers): `npm run build && npm run test:e2e`

See [CLIENT_HANDOFF_TEST_REPORT_TEMPLATE.md](./CLIENT_HANDOFF_TEST_REPORT_TEMPLATE.md) for sign-off.
