CasaBatangueño — Apartment & Dormitory Rental Management System

Public pages (shared nav & footer via public/js/layout.js)

- / (index.html) — Home: hero with quick search, Alangilan highlights, featured top 3 properties, How it Works teaser, and latest approved reviews.
- /rentals.html — Find a Rental: search & filters, property cards with star ratings, interactive Leaflet + OpenStreetMap map, property details modal (info grid, room availability, online application, and tenant reviews).
- /how-it-works.html — How it Works: expanded 6-step process (Apply → Review → Reserve → Contract & Deposit → Move In → Monthly Payment & Receipts), requirements, and payment methods.
- /about.html — About / FAQ: management profile, mission, why Alangilan, and interactive FAQ accordion.
- /contact.html — Contact: office hours, phone/email/address, contact form, and embedded Leaflet map.
- /owner.html — Owner portal: JWT login with roles (owner, admin, staff), dashboard KPIs (including pending reviews & new messages), 6 Chart.js charts with date filters, CRUD for properties, buildings, rooms, tenants, applications, reviews moderation & replies, contact messages inbox, payments (with printable receipts), expenses, and financial reports with Print / PDF / Excel export.

Stack: HTML5, CSS3, vanilla JavaScript (frontend) · Node.js + Express (backend) · bcryptjs + jsonwebtoken (security) · Chart.js, Leaflet, jsPDF, SheetJS (loaded from CDN).

Run locally

Requirements: Git Bash and Node.js

To run this code locally, open the terminal in the project folder and type:

npm install
npm start

(If cloning from GitHub for the first time, run git clone <your-repo-url> and cd <project-folder> first; once dependencies are installed, just type npm start.)

Customer portal: http://localhost:3000
Owner portal: http://localhost:3000/owner.html

Optional: create a .env file in the root folder to override PORT (defaults to 3000) or JWT_SECRET.

Demo accounts

Owner: owner@casa-bat.com / Owner123!
Admin: admin@casa-bat.com / Admin123!
Staff: staff@casa-bat.com / Staff123!

Important seed data note:
"Reset demo data" in the owner portal top bar restores server/seed.json. If you pulled updates or edited server/seed.json locally and still see old data, you MUST delete server/data/store.json and restart npm start (or npm run dev) so the server regenerates store.json from the updated seed.json.

Folder structure

server/app.js      Express app: auth, public API, reviews, contact messages, dashboard, CRUD, reports
server/server.js   Starts the server (npm start)
server/db.js       Data layer (JSON file) — the only file that touches storage
server/seed.json   Demo data (including properties, reviews, messages); live data is written to server/data/store.json
public/            index.html, rentals.html, how-it-works.html, about.html, contact.html, owner.html, css/, js/, images/
public/js/         common.js, layout.js, properties.js, home.js, rentals.js, about.js, contact.js, owner.js
api/index.js       Vercel serverless entry (re-uses server/app.js)
database/          schema.sql + seed.sql: MySQL design for XAMPP/phpMyAdmin (includes reviews and contact_messages tables)

API (Bearer token for everything except /public and /auth/login)

GET /api/health

Public endpoints:
GET /api/public/properties · GET /api/public/properties/:id
POST /api/public/applications
GET /api/public/reviews/latest · GET /api/public/properties/:id/reviews · POST /api/public/reviews
POST /api/public/contact

Auth:
POST /api/auth/login · GET /api/auth/me

Protected owner/admin/staff endpoints:
GET /api/dashboard/summary?range=today|week|month|year|all|custom&start&end
/api/properties · /api/buildings · /api/rooms · /api/tenants (POST /:id/move-out)
/api/applications (PATCH /:id/status, POST /:id/convert)
/api/reviews (GET, PATCH /:id/status, POST /:id/reply, DELETE /:id owner/admin)
/api/messages (GET, PATCH /:id/status, DELETE /:id owner/admin)
/api/payments · /api/expenses
GET /api/reports/financial · /api/users (admin) · POST /api/demo/reset

Using MySQL instead

database/schema.sql and database/seed.sql are ready to import in phpMyAdmin. To switch, replace the functions in server/db.js / the s() calls in server/app.js with mysql2/promise queries (parameterised ? placeholders).
