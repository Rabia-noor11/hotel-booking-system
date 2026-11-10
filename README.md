# Grand Hotel — Booking & Hotel Operations

A responsive hotel reservation and front-desk management application with three roles: guest, receptionist and admin.

**Live URL:** _Add after deployment_ · **Public repository:** _Add GitHub URL_ · **Demo video:** _Add recording URL_

## Features

- Guest signup/login, room search, date/type/price/capacity filters, room details, service add-ons, booking management and booking history.
- Receptionist walk-in bookings, check-in/check-out and room status updates.
- Admin room, service and staff management, room photo uploads, date-filtered analytics (occupancy, revenue and bookings by room type).
- Automatic price calculation (nightly rate + services + 10% tax), date validation and overlap protection.
- Downloadable PDF invoice after check-out.
- Loading skeletons, empty/error states, toast notifications, responsive layouts, upload previews and accessible focus/reduced-motion styling.

## Stack and architecture

Node.js + Express · SQLite (`better-sqlite3`) · JWT + bcrypt · Multer · PDFKit · Vanilla JavaScript + Chart.js.

```text
Browser (public/index.html + public/styles.css)
            │  fetch /api/*
            ▼
Express (server/app.js) ── JWT authentication + role authorization
            │
            ├── server/pricing.js (date rules, nights, tax and totals)
            ├── SQLite (users, rooms, services, bookings, booking_services)
            ├── Multer (validated room image uploads)
            └── PDFKit (completed-stay invoices)
```

## Local setup

```bash
npm install
cp .env.example .env
# Set a long, unique JWT_SECRET and a writable DB_FILE path.
npm start
```

Open `http://localhost:3000`.

Seeded demo accounts (change passwords before any public deployment):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@hotel.com` | `Admin@123` |
| Receptionist | `reception@hotel.com` | `Reception@123` |

Guests can sign up from the login page.

## Tests

```bash
npm test
```

The Node test suite covers date calculations, totals, overlap boundaries, validation, signup/login, authorization, cancellation, availability filtering, check-in/check-out and PDF invoice generation. It also contains an API-level end-to-end booking journey. It is not a browser automation test.

## Booking overlap rule

Stays use half-open ranges `[check_in, check_out)`. A conflict exists when `existing.check_in < requested.check_out AND requested.check_in < existing.check_out`. Thus partial overlaps are rejected while back-to-back stays are allowed. The overlap check and database write execute inside a SQLite transaction. Cancelled bookings are excluded and release the dates.

## Deployment

Designed for one Node web service. Configure `JWT_SECRET` and `DB_FILE`; use persistent storage for the SQLite database and `public/uploads`. For Render, set the build command to `npm install`, the start command to `npm start`, and mount a persistent disk for both data and uploads.

**Production checklist:** use a strong secret, change seeded credentials, enable HTTPS, configure backups and logging, verify upload storage persistence, run `npm test`, run Lighthouse on the deployed URL, and record actual scores/issues fixed.

## Scope notes

Stripe, email notifications, guest reviews, dynamic pricing, a Playwright browser E2E test, and production deployment are not included. No live URL, public GitHub repository, Lighthouse score or demo recording is claimed until those are created in the owner's accounts.

See [`CASE-STUDY.md`](CASE-STUDY.md) for the one-page case study.
