# Grand Hotel — One-Page Case Study

**Project:** Full-stack hotel booking and operations platform  
**Product goal:** Give guests a straightforward way to discover and reserve rooms while giving hotel staff one operational workspace for arrivals, departures, room readiness and business reporting.

## The problem

Small and mid-sized hotels often split reservations, front-desk work and room availability across spreadsheets, phone calls and disconnected tools. That creates avoidable double bookings, inconsistent room status, slow check-in and limited visibility into revenue and occupancy. Grand Hotel brings the core guest journey and front-desk workflow into one responsive web application with role-based access.

## Solution and technology choices

- **Frontend:** Semantic HTML, vanilla JavaScript and a dedicated `public/styles.css` stylesheet. This keeps the interface lightweight and easy to host while supporting mobile and desktop layouts.
- **Backend:** Node.js and Express expose a REST API and serve the frontend from the same deployment.
- **Data:** SQLite with `better-sqlite3` provides a simple transactional relational store for rooms, users, services, bookings and booking-service line items.
- **Security:** JWT bearer authentication, bcrypt password hashing and server-side role middleware distinguish `guest`, `receptionist` and `admin` permissions.
- **Supporting libraries:** Multer validates room image uploads, PDFKit creates completed-stay invoices, and Chart.js renders the admin analytics.
- **Quality:** Node's built-in test runner exercises pricing/date logic, API validation, permissions, booking conflicts and the guest-to-invoice workflow.

## Main user journeys

Guests can create an account, filter rooms by dates/type/price/capacity, view room details, add services, book, modify or cancel their own confirmed reservations, and review booking history. Receptionists can create walk-in reservations, check guests in and out, and update room readiness. Admins can manage rooms, staff and services, upload room photos, and filter occupancy, revenue and room-type analytics. Completed stays can produce a downloadable PDF invoice.

## The key challenge: preventing date-overlap double bookings

A room reservation is modelled as a half-open date interval **[check-in, check-out)**. Two stays conflict only when:

`existing.check_in < requested.check_out AND requested.check_in < existing.check_out`

This correctly rejects partial and fully-contained overlaps but permits back-to-back stays where one guest checks out on the same date another guest checks in. The API performs the overlap query and insert/update inside a `better-sqlite3` transaction, preventing concurrent requests from interleaving between the check and write. Cancelled reservations are excluded from the conflict query, so cancellation releases the dates. The same date rules are checked in the browser for fast feedback and again on the server as the source of truth.

## UX and reliability details

The interface includes loading skeletons during data fetches, explicit empty and error states, transient success/error toast messages, image previews and upload limits, form constraints, horizontally scrollable data tables, responsive grids, keyboard focus styling and reduced-motion support. Server validation remains authoritative for every write; the UI mirrors critical date, capacity, price and file constraints to reduce avoidable errors.

## Validation and test coverage

Run `npm test` to execute the automated suite. It covers date arithmetic, tax/service totals, half-open overlap boundaries, past/invalid dates, signup and duplicate-account behavior, login failures, protected admin routes, overlapping booking rejection, cancellation freeing dates, room availability filtering, role restrictions, check-in/check-out transitions and invoice generation. The repository includes an end-to-end API flow test; a browser-driven Playwright test, Stripe, email delivery, reviews and dynamic pricing are not implemented in this starter.

## Deployment and evidence

The app is structured for a single Node service (for example, Render) with `JWT_SECRET` and a persistent `DB_FILE` path. Production deployment, a public GitHub repository, Lighthouse audit results, screenshots and a recorded demo must be completed in the owner's hosting/GitHub accounts; no live URL or audit score is claimed by this source package.
