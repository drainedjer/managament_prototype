# CasaBatangueño

Apartment and dormitory rental management platform for **Alangilan, Batangas City** (near Batangas State University Alangilan Campus), built with Express 4, plain HTML/CSS/vanilla JS, **Neon Postgres**, **Vercel Blob**, **Resend**, and **Vercel Cron** on **Vercel Hobby (free tier)**.

---

## Stack & Free-Tier Architecture

- **Hosting**: Vercel Hobby serverless functions (`api/index.js` -> `server/app.js`, rewrites in `vercel.json`)
- **Database**: Neon Postgres (`pg` driver reading `DATABASE_URL` pooled connection string)
- **Image Storage**: Vercel Blob (`@vercel/blob` using `BLOB_READ_WRITE_TOKEN`)
- **Transactional Email**: Resend (`RESEND_API_KEY`, optional — safely skipped when unset)
- **Scheduled Jobs**: Vercel Cron daily at `00:00 UTC` (`/api/cron/daily`, protected by `CRON_SECRET`)
- **Security**: `helmet` CSP, `express-rate-limit`, `cors` allowlist, `zod` validation, `bcrypt` (cost 12), 5-attempt / 15-minute account lockout, `httpOnly` `SameSite` session cookies + double-submit `X-CSRF-Token` protection, staff PII masking with audited reveal, RA 10173 consent & data export/deletion, and private owner-only applicant ID documents.

---

## Environment Variables

Copy `.env.example` to `.env` for local development (never commit `.env`):

```env
DATABASE_URL=
JWT_SECRET=
BLOB_READ_WRITE_TOKEN=
RESEND_API_KEY=
EMAIL_FROM=CasaBatangueño <onboarding@resend.dev>
CRON_SECRET=
ALLOWED_ORIGINS=
NODE_ENV=development
```

- `JWT_SECRET` is **required** in `NODE_ENV=production` or on Vercel (`VERCEL` env set). The server refuses to start if missing.
- `DATABASE_URL` is **required** in `NODE_ENV=production` or on Vercel. For non-production local preview/tests without `DATABASE_URL`, an ephemeral in-memory store (`server/db-mem.js`) is used automatically.

---

## Database Setup (Neon Postgres)

### Staging vs. Production Branches
Use Neon's free branching feature:
1. Create a **`production`** Neon branch and attach its pooled `DATABASE_URL` to Vercel Production environment variables.
2. Create a **`staging`** / **`preview`** Neon branch for Vercel Preview deployments so test changes never touch live data.

### Initialize Schema & Seed Once
Run these one-time CLI commands against your target `DATABASE_URL`:

```bash
npm install
npm run db:init
npm run db:seed
```

Seed data is **never** automatically executed on application cold start in Postgres mode. Contact the project administrator out-of-band for initial management credentials and change passwords immediately after first login.

---

## Local Development & Testing

```bash
# Run syntax & lint checks
npm run build
npm run lint

# Run automated API & security tests (Node built-in test runner + supertest)
npm test

# Start local dev server on http://localhost:3000
npm run dev

# Or test full Vercel serverless environment locally
npx vercel dev
```

---

## Deploying to Vercel (Free Tier)

1. Push repository to GitHub and import into Vercel.
2. Connect **Neon Postgres** and **Vercel Blob** from the Vercel Storage / Marketplace tab.
3. Set `JWT_SECRET`, `CRON_SECRET`, `ALLOWED_ORIGINS` (your Vercel domain), and optionally `RESEND_API_KEY` + `EMAIL_FROM` in Vercel Project Settings -> Environment Variables.
4. Run `npm run db:init` and `npm run db:seed` against your Neon database URL once.
5. Deploy. Verify `GET /api/health` returns `{"ok":true,"db":"postgres"}`.

---

## Key Pages

- `/` — Home (hero search, highlights, featured rentals, resident reviews & testimonials)
- `/rentals.html` — Search, filter, compare 2–3 properties, favorites, and numbered MarkerCluster map
- `/how-it-works.html` — 6-step timeline, **Track My Application**, requirements, and FAQ
- `/contact.html` — Contact office form (honeypot + RA 10173 consent), OSM map, and **Book a Viewing**
- `/about.html` — Management background & full FAQ
- `/account.html` — Customer Portal (register, login, forgot/reset password, favorites, applications, lease/receipts, maintenance, announcements, download/delete data)
- `/owner.html` — Owner & Staff Management Portal
- `/privacy.html` & `/terms.html` — RA 10173 Privacy Policy and Terms of Service

---

## API Overview

### Public & Auth
- `GET /api/health` — Database connectivity health check
- `GET /api/auth/csrf` — Issues double-submit CSRF cookie/token
- `POST /api/auth/register` — Customer registration (RA 10173 consent required)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `PATCH /api/auth/profile`, `POST /api/auth/change-password`, `GET /api/auth/my-data`, `POST /api/auth/delete-account`
- `GET /api/public/settings`, `GET /api/public/properties`, `GET /api/public/properties/:id`
- `GET /api/public/properties/:id/reviews`, `GET /api/public/reviews/latest`, `GET /api/public/testimonials`, `GET /api/public/announcements`
- `POST /api/public/applications`, `POST /api/public/applications/track`, `POST /api/public/reviews`, `POST /api/public/testimonials`, `POST /api/public/contact`, `POST /api/public/viewings`, `POST /api/public/waitlist`

### Customer Portal (`/api/customer/*`)
- `GET|POST|DELETE /api/customer/favorites/:propertyId`
- `GET /api/customer/applications`, `GET /api/customer/lease`
- `GET|POST /api/customer/maintenance`, `GET /api/customer/announcements`

### Management Portal (Owner / Staff / Admin)
- `GET|POST /api/properties`, `PUT|PATCH|DELETE /api/properties/:id`
- `GET|POST /api/buildings`, `PUT|DELETE /api/buildings/:id`
- `GET|POST /api/rooms`, `PUT|DELETE /api/rooms/:id`
- `GET|POST /api/tenants`, `PUT|DELETE /api/tenants/:id`, `POST /api/tenants/:id/reveal`, `POST /api/tenants/:id/move-out`, `POST /api/tenants/:id/checklist`, `GET /api/leases`
- `GET /api/applications`, `PATCH /api/applications/:id/status`, `POST /api/applications/:id/convert`, `POST /api/applications/:id/reveal`, `GET|DELETE /api/applications/:id/document`, `DELETE /api/applications/:id`
- `GET|POST /api/payments`, `DELETE /api/payments/:id`, `POST /api/payments/:id/transactions`, `PUT /api/payment-transactions/:txId`, `POST /api/payment-transactions/:txId/void`
- `GET /api/expense-categories`, `GET|POST /api/expenses`, `PUT|DELETE /api/expenses/:id`
- `GET /api/reviews`, `PATCH /api/reviews/:id/status`, `POST /api/reviews/:id/reply`, `DELETE /api/reviews/:id`
- `GET /api/testimonials`, `PATCH|DELETE /api/testimonials/:id`
- `GET /api/messages`, `PATCH|DELETE /api/messages/:id`, `GET /api/viewings`, `PATCH /api/viewings/:id/status`, `GET /api/waitlist`
- `GET /api/maintenance`, `PATCH /api/maintenance/:id`, `GET|POST /api/announcements`, `DELETE /api/announcements/:id`
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `GET|PUT /api/settings`, `GET /api/audit-logs`, `GET|POST /api/users`
- `GET /api/dashboard/summary`, `GET /api/reports/financial`, `POST /api/uploads/image`
- `GET /api/cron/daily` (requires `Authorization: Bearer <CRON_SECRET>`)
