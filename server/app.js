/**
  app.js - Express application: REST API + static frontend.
  Sections: helpers, authorization, public API, dashboard, CRUD modules, reports.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================== helpers ==============================
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sum = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const asyncSafe = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { console.error(e); fail(res, 500, 'Server error.'); }
};

function getRange(q) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (q.range === 'custom' && q.start && q.end) return { start: q.start, end: q.end };
  if (q.range === 'today') return { start: today(), end: today() };
  if (q.range === 'week') {
    const s = new Date(now); s.setDate(s.getDate() - 6);
    return { start: iso(s), end: today() };
  }
  if (q.range === 'month') {
    const ym = today().slice(0, 7);
    return { start: `${ym}-01`, end: `${ym}-31` };
  }
  if (q.range === 'year') return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
  return { start: '2000-01-01', end: '2099-12-31' };
}
const inRange = (d, r) => !!d && d >= r.start && d <= r.end;

/** Work out payment status/balance from the amounts and due date. */
function finishPayment(p) {
  p.amountDue = num(p.amountDue);
  p.amountPaid = num(p.amountPaid);
  p.remainingBalance = Math.max(0, p.amountDue - p.amountPaid);
  if (p.remainingBalance === 0) p.status = 'Paid';
  else if (p.amountPaid > 0) p.status = 'Partial';
  else p.status = p.dueDate < today() ? 'Overdue' : 'Pending';
  return p;
}

const rateBuckets = new Map();
function isRateLimited(req, bucket, limit = 5, windowMs = 15 * 60 * 1000) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 1000) rateBuckets.clear();
  return false;
}

const publicReview = (r) => ({
  id: r.id,
  propertyId: r.propertyId,
  reviewerName: r.reviewerName,
  rating: r.rating,
  title: r.title || '',
  comment: r.comment,
  status: r.status,
  ownerReply: r.ownerReply || null,
  repliedAt: r.repliedAt || null,
  createdAt: r.createdAt,
});

function enrichProperty(p) {
  const st = db.get();
  const rooms = st.rooms.filter((r) => r.propertyId === p.id);
  const open = rooms.filter((r) => r.status === 'Available' && r.availableBeds > 0);
  const approvedReviews = (st.reviews || []).filter((r) => r.propertyId === p.id && r.status === 'Approved');
  const reviewCount = approvedReviews.length;
  const averageRating = reviewCount ? Math.round((sum(approvedReviews, (r) => r.rating) / reviewCount) * 10) / 10 : 0;
  const typeMap = new Map();
  open.forEach((r) => {
    const cur = typeMap.get(r.roomType) || { roomType: r.roomType, roomsAvailable: 0, bedsFree: 0 };
    cur.roomsAvailable += 1;
    cur.bedsFree += r.availableBeds;
    typeMap.set(r.roomType, cur);
  });
  return {
    ...p,
    totalRoomsCount: rooms.length,
    availableRoomsCount: open.length,
    availableBedsCount: sum(open, (r) => r.availableBeds),
    availableRoomTypes: [...typeMap.values()],
    averageRating,
    reviewCount,
  };
}

// ============================== authorization ==============================
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    req.user = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', JWT_SECRET);
    next();
  } catch {
    fail(res, 401, 'Please log in again.');
  }
}
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : fail(res, 403, 'You do not have permission for this action.');
const OWNER = allow('owner', 'admin');   // owner + system admin
const ANY = allow('owner', 'admin', 'staff');

const publicUser = (u) => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role, phone: u.phone });

app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: process.env.VERCEL ? 'demo (Vercel)' : 'local' }));

app.post('/api/auth/login', asyncSafe((req, res) => {
  const email = str(req.body.email).toLowerCase();
  const user = db.get().users.find((u) => u.email.toLowerCase() === email && u.isActive);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.passwordHash))
    return fail(res, 401, 'Invalid email or password.');
  const token = jwt.sign({ id: user.id, role: user.role, name: user.fullName }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: publicUser(user) });
}));

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.get().users.find((x) => x.id === req.user.id);
  u ? res.json(publicUser(u)) : fail(res, 404, 'User not found.');
});

// ============================== public portal ==============================
app.get('/api/public/properties', asyncSafe((req, res) => {
  const { q = '', type = '', minPrice = '', maxPrice = '', occupants = '', onlyAvailable = '', amenity = '' } = req.query;
  let list = db.get().properties.filter((p) => p.isPublished).map(enrichProperty);
  const needle = q.trim().toLowerCase();
  if (needle) list = list.filter((p) => [p.name, p.city, p.address].join(' ').toLowerCase().includes(needle));
  if (type) list = list.filter((p) => p.propertyType === type);
  if (minPrice) list = list.filter((p) => p.monthlyPrice >= num(minPrice));
  if (maxPrice) list = list.filter((p) => p.monthlyPrice <= num(maxPrice));
  if (amenity) list = list.filter((p) => p.amenities.includes(amenity));
  if (onlyAvailable === 'true') list = list.filter((p) => p.availableRoomsCount > 0);
  if (occupants) {
    const rooms = db.get().rooms;
    list = list.filter((p) => rooms.some((r) => r.propertyId === p.id && r.status === 'Available' && r.availableBeds >= num(occupants)));
  }
  res.json(list);
}));

app.get('/api/public/properties/:id', asyncSafe((req, res) => {
  const p = db.get().properties.find((x) => x.id === num(req.params.id) && x.isPublished);
  if (!p) return fail(res, 404, 'Property not found.');
  res.json({
    ...enrichProperty(p),
    buildings: db.get().buildings.filter((b) => b.propertyId === p.id),
    rooms: db.get().rooms.filter((r) => r.propertyId === p.id),
  });
}));

app.post('/api/public/applications', asyncSafe((req, res) => {
  const b = req.body;
  const s = db.get();
  const prop = s.properties.find((p) => p.id === num(b.propertyId) && p.isPublished);
  if (!str(b.fullName) || !/^\S+@\S+\.\S+$/.test(str(b.email)) || !str(b.contactNumber) || !prop || !str(b.expectedMoveInDate))
    return fail(res, 400, 'Please complete name, valid email, contact number, property and move-in date.');
  const id = db.nextId('application');
  const appl = {
    id,
    referenceNumber: `APP-${new Date().getFullYear()}-${1000 + id}`,
    fullName: str(b.fullName), email: str(b.email), contactNumber: str(b.contactNumber),
    propertyId: prop.id, preferredRoomType: str(b.preferredRoomType) || prop.propertyType,
    assignedRoomId: null, expectedMoveInDate: str(b.expectedMoveInDate), reservationDate: null,
    occupants: Math.max(1, num(b.occupants) || 1), message: str(b.message).slice(0, 500),
    status: 'Pending', createdAt: new Date().toISOString(),
  };
  s.applications.push(appl);
  db.save();
  res.status(201).json({ referenceNumber: appl.referenceNumber, status: appl.status });
}));

// ---- public reviews
app.get('/api/public/reviews/latest', asyncSafe((req, res) => {
  const st = db.get();
  const limit = Math.min(12, Math.max(1, num(req.query.limit) || 6));
  const props = new Map(st.properties.filter((p) => p.isPublished).map((p) => [p.id, p.name]));
  const latest = (st.reviews || [])
    .filter((r) => r.status === 'Approved' && props.has(r.propertyId))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id)
    .slice(0, limit)
    .map((r) => ({ ...publicReview(r), propertyName: props.get(r.propertyId) }));
  res.json(latest);
}));

app.get('/api/public/properties/:id/reviews', asyncSafe((req, res) => {
  const st = db.get();
  const prop = st.properties.find((x) => x.id === num(req.params.id) && x.isPublished);
  if (!prop) return fail(res, 404, 'Property not found.');
  const list = (st.reviews || [])
    .filter((r) => r.propertyId === prop.id && r.status === 'Approved')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  list.forEach((r) => {
    const k = Math.min(5, Math.max(1, Math.round(num(r.rating))));
    breakdown[k] += 1;
  });
  const count = list.length;
  const average = count ? Math.round((sum(list, (r) => r.rating) / count) * 10) / 10 : 0;
  res.json({ average, count, breakdown, reviews: list.map(publicReview) });
}));

app.post('/api/public/reviews', asyncSafe((req, res) => {
  if (isRateLimited(req, 'review', 5, 15 * 60 * 1000)) {
    return fail(res, 429, 'Too many review submissions from this network. Please try again later.');
  }
  const b = req.body;
  const st = db.get();
  const prop = st.properties.find((p) => p.id === num(b.propertyId) && p.isPublished);
  const reviewerName = str(b.reviewerName).slice(0, 80);
  const email = str(b.email).toLowerCase().slice(0, 150);
  const rating = Math.round(num(b.rating));
  const title = str(b.title).slice(0, 120);
  const comment = str(b.comment).slice(0, 600);
  if (!prop) return fail(res, 404, 'Property not found.');
  if (!reviewerName || !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Please enter your name and a valid email address.');
  if (rating < 1 || rating > 5) return fail(res, 400, 'Please choose a star rating from 1 to 5.');
  if (comment.length < 10) return fail(res, 400, 'Review comment must be at least 10 characters.');
  const duplicate = (st.reviews || []).some((r) => r.propertyId === prop.id && r.email.toLowerCase() === email);
  if (duplicate) return fail(res, 409, 'You have already submitted a review for this property.');
  const rev = {
    id: db.nextId('review'),
    propertyId: prop.id,
    reviewerName,
    email,
    rating,
    title,
    comment,
    status: 'Pending',
    ownerReply: null,
    repliedAt: null,
    createdAt: new Date().toISOString(),
  };
  st.reviews.push(rev);
  db.save();
  res.status(201).json({ id: rev.id, status: rev.status, message: 'Thanks! Your review will appear after approval.' });
}));

// ---- public contact
app.post('/api/public/contact', asyncSafe((req, res) => {
  if (isRateLimited(req, 'contact', 5, 15 * 60 * 1000)) {
    return fail(res, 429, 'Too many messages sent recently. Please try again later.');
  }
  const b = req.body;
  const fullName = str(b.fullName).slice(0, 100);
  const email = str(b.email).toLowerCase().slice(0, 150);
  const phone = str(b.phone).slice(0, 40);
  const subject = str(b.subject).slice(0, 120);
  const message = str(b.message).slice(0, 1000);
  if (!fullName || !/^\S+@\S+\.\S+$/.test(email) || message.length < 10) {
    return fail(res, 400, 'Please enter your name, a valid email, and a message (at least 10 characters).');
  }
  const msg = {
    id: db.nextId('message'),
    fullName,
    email,
    phone,
    subject: subject || 'General inquiry',
    message,
    status: 'New',
    createdAt: new Date().toISOString(),
  };
  db.get().messages.push(msg);
  db.save();
  res.status(201).json({ ok: true, id: msg.id, message: 'Message sent! We will get back to you soon.' });
}));

// ============================== dashboard ==============================
app.get('/api/dashboard/summary', auth, ANY, asyncSafe((req, res) => {
  const s = db.get();
  const r = getRange(req.query);
  const pays = s.payments.filter((p) => inRange(p.dueDate, r)).map((p) => finishPayment({ ...p }));
  const exps = s.expenses.filter((e) => inRange(e.expenseDate, r));
  const collected = sum(pays, (p) => p.amountPaid);
  const expenses = sum(exps, (e) => e.amount);
  const roomCount = (st) => s.rooms.filter((x) => x.status === st).length;
  const activeTenants = s.tenants.filter((t) => t.status === 'Active');

  const months = [...new Set([...pays.map((p) => p.dueDate.slice(0, 7)), ...exps.map((e) => e.expenseDate.slice(0, 7))])].sort();
  const incomeByMonth = months.map((m) => sum(pays.filter((p) => p.dueDate.startsWith(m)), (p) => p.amountPaid));
  const expenseByMonth = months.map((m) => sum(exps.filter((e) => e.expenseDate.startsWith(m)), (e) => e.amount));
  const statuses = ['Paid', 'Partial', 'Pending', 'Overdue'];

  res.json({
    kpis: {
      totalProperties: s.properties.length, totalBuildings: s.buildings.length, totalRooms: s.rooms.length,
      availableRooms: roomCount('Available'), occupiedRooms: roomCount('Occupied'), reservedRooms: roomCount('Reserved'),
      totalTenants: activeTenants.length,
      monthlyExpectedIncome: sum(activeTenants, (t) => t.monthlyRent),
      totalCollected: collected,
      pendingPayments: sum(pays.filter((p) => ['Pending', 'Partial'].includes(p.status)), (p) => p.remainingBalance),
      overduePayments: sum(pays.filter((p) => p.status === 'Overdue'), (p) => p.remainingBalance),
      monthlyExpenses: expenses, netIncome: collected - expenses,
      pendingReviews: (s.reviews || []).filter((rev) => rev.status === 'Pending').length,
      unreadMessages: (s.messages || []).filter((m) => m.status === 'New').length,
    },
    charts: {
      months, incomeByMonth, expenseByMonth,
      occupancy: { labels: ['Available', 'Occupied', 'Reserved', 'Maintenance'], values: ['Available', 'Occupied', 'Reserved', 'Maintenance'].map(roomCount) },
      paymentStatus: { labels: statuses, values: statuses.map((st) => pays.filter((p) => p.status === st).length) },
      propertyPerformance: {
        labels: s.properties.map((p) => p.name),
        values: s.properties.map((p) => sum(pays.filter((x) => x.propertyId === p.id), (x) => x.amountPaid)),
      },
    },
  });
}));

// ============================== CRUD modules ==============================
const s = () => db.get();
const byId = (list, id) => list.find((x) => x.id === num(id));

// ---- properties
app.get('/api/properties', auth, ANY, (_q, res) => res.json(s().properties.map(enrichProperty)));
function readProperty(b, base = {}) {
  const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);
  return {
    ...base, name: str(b.name), propertyType: str(b.propertyType), address: str(b.address), city: str(b.city),
    latitude: num(b.latitude), longitude: num(b.longitude), description: str(b.description),
    monthlyPrice: num(b.monthlyPrice), amenities: lines(b.amenities), houseRules: lines(b.houseRules),
    contactPhone: str(b.contactPhone), contactEmail: str(b.contactEmail),
    locationAccess: str(b.locationAccess), nearbyPlaces: str(b.nearbyPlaces),
    depositPolicy: str(b.depositPolicy), utilitiesPolicy: str(b.utilitiesPolicy),
    inclusions: str(b.inclusions), curfewPolicy: str(b.curfewPolicy),
    images: lines(b.images).length ? lines(b.images) : base.images || ['/images/APT-01.png'],
    isPublished: b.isPublished === undefined ? base.isPublished !== false : !!b.isPublished,
  };
}
app.post('/api/properties', auth, OWNER, asyncSafe((req, res) => {
  const p = readProperty(req.body, { id: db.nextId('property'), ownerId: req.user.id, createdAt: new Date().toISOString() });
  if (!p.name || !p.propertyType || !p.address) return fail(res, 400, 'Name, type and address are required.');
  s().properties.push(p); db.save(); res.status(201).json(p);
}));
app.put('/api/properties/:id', auth, OWNER, asyncSafe((req, res) => {
  const i = s().properties.findIndex((p) => p.id === num(req.params.id));
  if (i < 0) return fail(res, 404, 'Property not found.');
  s().properties[i] = readProperty(req.body, s().properties[i]); db.save(); res.json(s().properties[i]);
}));
app.patch('/api/properties/:id/publish', auth, OWNER, asyncSafe((req, res) => {
  const p = byId(s().properties, req.params.id);
  if (!p) return fail(res, 404, 'Property not found.');
  p.isPublished = !p.isPublished; db.save(); res.json(p);
}));
app.delete('/api/properties/:id', auth, OWNER, asyncSafe((req, res) => {
  const id = num(req.params.id);
  if (s().tenants.some((t) => t.propertyId === id && t.status === 'Active')) return fail(res, 409, 'Property has active tenants.');
  const st = s();
  st.properties = st.properties.filter((p) => p.id !== id);
  st.buildings = st.buildings.filter((b) => b.propertyId !== id);
  st.rooms = st.rooms.filter((r) => r.propertyId !== id);
  db.save(); res.json({ ok: true });
}));

// ---- buildings
app.get('/api/buildings', auth, ANY, (_q, res) => res.json(s().buildings));
app.post('/api/buildings', auth, OWNER, asyncSafe((req, res) => {
  const b = req.body;
  if (!byId(s().properties, b.propertyId) || !str(b.name)) return fail(res, 400, 'Property and name are required.');
  const row = { id: db.nextId('building'), propertyId: num(b.propertyId), name: str(b.name), floors: Math.max(1, num(b.floors)), description: str(b.description), createdAt: new Date().toISOString() };
  s().buildings.push(row); db.save(); res.status(201).json(row);
}));
app.put('/api/buildings/:id', auth, OWNER, asyncSafe((req, res) => {
  const row = byId(s().buildings, req.params.id);
  if (!row) return fail(res, 404, 'Building not found.');
  Object.assign(row, { name: str(req.body.name) || row.name, floors: Math.max(1, num(req.body.floors)), description: str(req.body.description) });
  s().rooms.filter((r) => r.buildingId === row.id).forEach((r) => (r.buildingName = row.name));
  db.save(); res.json(row);
}));
app.delete('/api/buildings/:id', auth, OWNER, asyncSafe((req, res) => {
  const id = num(req.params.id);
  if (s().rooms.some((r) => r.buildingId === id)) return fail(res, 409, 'Delete or move the rooms in this building first.');
  s().buildings = s().buildings.filter((b) => b.id !== id); db.save(); res.json({ ok: true });
}));

// ---- rooms
app.get('/api/rooms', auth, ANY, (_q, res) => res.json(s().rooms));
function readRoom(b, base = {}) {
  const building = byId(s().buildings, b.buildingId);
  return {
    ...base, propertyId: building ? building.propertyId : base.propertyId, buildingId: building ? building.id : base.buildingId,
    buildingName: building ? building.name : base.buildingName, floorNumber: num(b.floorNumber) || 1,
    roomNumber: str(b.roomNumber), roomType: str(b.roomType), capacity: Math.max(1, num(b.capacity)),
    monthlyPrice: num(b.monthlyPrice), status: str(b.status) || 'Available', description: str(b.description),
    images: base.images || [],
  };
}
app.post('/api/rooms', auth, ANY, asyncSafe((req, res) => {
  const room = readRoom(req.body, { id: db.nextId('room'), occupiedBeds: 0 });
  if (!room.buildingId || !room.roomNumber) return fail(res, 400, 'Building and room number are required.');
  if (s().rooms.some((r) => r.buildingId === room.buildingId && r.roomNumber === room.roomNumber)) return fail(res, 409, 'Room number already exists in this building.');
  s().rooms.push(room); db.recalcRooms(); db.save(); res.status(201).json(room);
}));
app.put('/api/rooms/:id', auth, ANY, asyncSafe((req, res) => {
  const i = s().rooms.findIndex((r) => r.id === num(req.params.id));
  if (i < 0) return fail(res, 404, 'Room not found.');
  const next = readRoom(req.body, s().rooms[i]);
  if (next.capacity < next.occupiedBeds) return fail(res, 409, 'Capacity cannot be lower than current occupants.');
  s().rooms[i] = next; db.recalcRooms(); db.save(); res.json(next);
}));
app.delete('/api/rooms/:id', auth, OWNER, asyncSafe((req, res) => {
  const id = num(req.params.id);
  if (s().tenants.some((t) => t.roomId === id && t.status === 'Active')) return fail(res, 409, 'Room has active tenants.');
  s().rooms = s().rooms.filter((r) => r.id !== id); db.save(); res.json({ ok: true });
}));

// ---- tenants
app.get('/api/tenants', auth, ANY, (_q, res) => res.json(s().tenants));
function checkRoomSpace(roomId, ignoreTenantId) {
  if (!roomId) return null;
  const room = byId(s().rooms, roomId);
  if (!room) return 'Room not found.';
  if (room.status === 'Maintenance') return 'Room is under maintenance.';
  const used = s().tenants.filter((t) => t.roomId === room.id && t.status === 'Active' && t.id !== ignoreTenantId).length;
  return used >= room.capacity ? `Room ${room.roomNumber} is full (capacity ${room.capacity}).` : null;
}
function readTenant(b, base = {}) {
  const room = byId(s().rooms, b.roomId);
  return {
    ...base, fullName: str(b.fullName), email: str(b.email), contactNumber: str(b.contactNumber), address: str(b.address),
    emergencyContact: str(b.emergencyContact), propertyId: room ? room.propertyId : num(b.propertyId), roomId: room ? room.id : null,
    moveInDate: str(b.moveInDate) || today(), moveOutDate: str(b.moveOutDate) || null,
    monthlyRent: num(b.monthlyRent) || (room ? room.monthlyPrice : 0), securityDeposit: num(b.securityDeposit),
    status: str(b.status) || 'Active',
  };
}
app.post('/api/tenants', auth, ANY, asyncSafe((req, res) => {
  const t = readTenant(req.body, { id: db.nextId('tenant'), createdAt: new Date().toISOString() });
  if (!t.fullName || !t.propertyId) return fail(res, 400, 'Name and room/property are required.');
  const err = t.status === 'Active' && checkRoomSpace(t.roomId); if (err) return fail(res, 409, err);
  s().tenants.push(t); db.recalcRooms(); db.save(); res.status(201).json(t);
}));
app.put('/api/tenants/:id', auth, ANY, asyncSafe((req, res) => {
  const i = s().tenants.findIndex((t) => t.id === num(req.params.id));
  if (i < 0) return fail(res, 404, 'Tenant not found.');
  const t = readTenant(req.body, s().tenants[i]);
  const err = t.status === 'Active' && checkRoomSpace(t.roomId, t.id); if (err) return fail(res, 409, err);
  s().tenants[i] = t; db.recalcRooms(); db.save(); res.json(t);
}));
app.post('/api/tenants/:id/move-out', auth, ANY, asyncSafe((req, res) => {
  const t = byId(s().tenants, req.params.id);
  if (!t) return fail(res, 404, 'Tenant not found.');
  Object.assign(t, { status: 'Former Tenant', moveOutDate: today() });
  db.recalcRooms(); db.save(); res.json(t);
}));
app.delete('/api/tenants/:id', auth, OWNER, asyncSafe((req, res) => {
  s().tenants = s().tenants.filter((t) => t.id !== num(req.params.id)); db.recalcRooms(); db.save(); res.json({ ok: true });
}));

// ---- applications
app.get('/api/applications', auth, ANY, (_q, res) => res.json(s().applications));
app.patch('/api/applications/:id/status', auth, ANY, asyncSafe((req, res) => {
  const a = byId(s().applications, req.params.id);
  const { status, assignedRoomId, reservationDate } = req.body;
  if (!a) return fail(res, 404, 'Application not found.');
  if (!['Pending', 'Approved', 'Rejected', 'Reserved', 'Completed', 'Cancelled'].includes(status)) return fail(res, 400, 'Invalid status.');
  const roomId = assignedRoomId ? num(assignedRoomId) : a.assignedRoomId;
  if (['Approved', 'Reserved'].includes(status) && roomId) {
    const room = byId(s().rooms, roomId);
    if (!room || room.status === 'Maintenance' || room.availableBeds < 1) return fail(res, 409, 'That room is not available.');
    const clash = s().applications.find((x) => x.id !== a.id && x.assignedRoomId === roomId && ['Approved', 'Reserved'].includes(x.status) && room.capacity === 1);
    if (clash) return fail(res, 409, `Room already reserved by ${clash.referenceNumber}.`);
  }
  Object.assign(a, { status, assignedRoomId: roomId || null, reservationDate: str(reservationDate) || a.reservationDate || (status === 'Reserved' ? today() : null) });
  db.recalcRooms(); db.save(); res.json(a);
}));
app.post('/api/applications/:id/convert', auth, ANY, asyncSafe((req, res) => {
  const a = byId(s().applications, req.params.id);
  if (!a) return fail(res, 404, 'Application not found.');
  if (a.status === 'Completed') return fail(res, 409, 'Already converted.');
  const room = byId(s().rooms, a.assignedRoomId);
  if (!room) return fail(res, 400, 'Assign a room before converting.');
  const err = checkRoomSpace(room.id); if (err) return fail(res, 409, err);
  const t = { id: db.nextId('tenant'), fullName: a.fullName, email: a.email, contactNumber: a.contactNumber, address: '', emergencyContact: '',
    propertyId: room.propertyId, roomId: room.id, moveInDate: a.expectedMoveInDate, moveOutDate: null, monthlyRent: room.monthlyPrice,
    securityDeposit: room.monthlyPrice, status: 'Active', createdAt: new Date().toISOString() };
  s().tenants.push(t); a.status = 'Completed'; db.recalcRooms(); db.save(); res.status(201).json(t);
}));

// ---- payments
app.get('/api/payments', auth, ANY, (_q, res) => res.json(s().payments.map((p) => finishPayment({ ...p }))));
app.post('/api/payments', auth, ANY, asyncSafe((req, res) => {
  const b = req.body;
  const t = byId(s().tenants, b.tenantId);
  if (!t) return fail(res, 400, 'Choose a tenant.');
  const month = str(b.billingMonth);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 400, 'Billing month must be YYYY-MM.');
  if (s().payments.some((p) => p.tenantId === t.id && p.billingMonth === month)) return fail(res, 409, 'A payment record for this tenant and month already exists. Edit it instead.');
  const id = db.nextId('payment');
  const p = finishPayment({
    id, tenantId: t.id, propertyId: t.propertyId, roomId: t.roomId, billingMonth: month,
    dueDate: str(b.dueDate) || `${month}-05`, paymentDate: num(b.amountPaid) > 0 ? str(b.paymentDate) || today() : null,
    amountDue: num(b.amountDue) || t.monthlyRent, amountPaid: num(b.amountPaid), paymentMethod: str(b.paymentMethod) || 'Cash',
    referenceNumber: `TXN-${month.replace('-', '')}-${String(id).padStart(3, '0')}`,
    receiptNumber: `RCPT-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`, notes: str(b.notes),
  });
  s().payments.push(p); db.save(); res.status(201).json(p);
}));
app.put('/api/payments/:id', auth, ANY, asyncSafe((req, res) => {
  const p = byId(s().payments, req.params.id);
  if (!p) return fail(res, 404, 'Payment not found.');
  const b = req.body;
  Object.assign(p, { amountDue: num(b.amountDue) || p.amountDue, amountPaid: num(b.amountPaid), paymentMethod: str(b.paymentMethod) || p.paymentMethod,
    dueDate: str(b.dueDate) || p.dueDate, paymentDate: num(b.amountPaid) > 0 ? str(b.paymentDate) || p.paymentDate || today() : null, notes: str(b.notes) });
  finishPayment(p); db.save(); res.json(p);
}));

// ---- expenses
app.get('/api/expenses', auth, ANY, (_q, res) => res.json(s().expenses));
function readExpense(b, base = {}) {
  return { ...base, propertyId: num(b.propertyId), category: str(b.category) || 'Other Expenses', description: str(b.description), amount: num(b.amount),
    expenseDate: str(b.expenseDate) || today(), paymentMethod: str(b.paymentMethod) || 'Cash', receiptReference: str(b.receiptReference) };
}
app.post('/api/expenses', auth, ANY, asyncSafe((req, res) => {
  const e = readExpense(req.body, { id: db.nextId('expense'), createdAt: new Date().toISOString() });
  if (!byId(s().properties, e.propertyId) || !e.description || e.amount <= 0) return fail(res, 400, 'Property, description and a positive amount are required.');
  s().expenses.push(e); db.save(); res.status(201).json(e);
}));
app.put('/api/expenses/:id', auth, ANY, asyncSafe((req, res) => {
  const i = s().expenses.findIndex((e) => e.id === num(req.params.id));
  if (i < 0) return fail(res, 404, 'Expense not found.');
  s().expenses[i] = readExpense(req.body, s().expenses[i]); db.save(); res.json(s().expenses[i]);
}));
app.delete('/api/expenses/:id', auth, OWNER, asyncSafe((req, res) => {
  s().expenses = s().expenses.filter((e) => e.id !== num(req.params.id)); db.save(); res.json({ ok: true });
}));

// ---- reviews (owner/staff moderation)
app.get('/api/reviews', auth, ANY, (_q, res) => {
  const list = [...(s().reviews || [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
  res.json(list);
});
app.patch('/api/reviews/:id/status', auth, ANY, asyncSafe((req, res) => {
  const rev = byId(s().reviews || [], req.params.id);
  if (!rev) return fail(res, 404, 'Review not found.');
  const status = str(req.body.status);
  if (!['Pending', 'Approved', 'Rejected'].includes(status)) return fail(res, 400, 'Invalid review status.');
  rev.status = status;
  db.save();
  res.json(rev);
}));
app.post('/api/reviews/:id/reply', auth, ANY, asyncSafe((req, res) => {
  const rev = byId(s().reviews || [], req.params.id);
  if (!rev) return fail(res, 404, 'Review not found.');
  const reply = str(req.body.ownerReply).slice(0, 600);
  if (!reply) return fail(res, 400, 'Reply text cannot be empty.');
  rev.ownerReply = reply;
  rev.repliedAt = new Date().toISOString();
  db.save();
  res.json(rev);
}));
app.delete('/api/reviews/:id', auth, OWNER, asyncSafe((req, res) => {
  const id = num(req.params.id);
  if (!byId(s().reviews || [], id)) return fail(res, 404, 'Review not found.');
  s().reviews = s().reviews.filter((r) => r.id !== id);
  db.save();
  res.json({ ok: true });
}));

// ---- contact messages (owner/staff inbox)
app.get('/api/messages', auth, ANY, (_q, res) => {
  const list = [...(s().messages || [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
  res.json(list);
});
app.patch('/api/messages/:id/status', auth, ANY, asyncSafe((req, res) => {
  const msg = byId(s().messages || [], req.params.id);
  if (!msg) return fail(res, 404, 'Message not found.');
  const status = str(req.body.status);
  if (!['New', 'Read', 'Replied'].includes(status)) return fail(res, 400, 'Invalid status.');
  msg.status = status;
  db.save();
  res.json(msg);
}));
app.delete('/api/messages/:id', auth, OWNER, asyncSafe((req, res) => {
  const id = num(req.params.id);
  if (!byId(s().messages || [], id)) return fail(res, 404, 'Message not found.');
  s().messages = s().messages.filter((m) => m.id !== id);
  db.save();
  res.json({ ok: true });
}));

// ============================== reports ==============================
app.get('/api/reports/financial', auth, ANY, asyncSafe((req, res) => {
  const r = getRange(req.query);
  const st = s();
  const pays = st.payments.filter((p) => inRange(p.dueDate, r)).map((p) => finishPayment({ ...p }));
  const exps = st.expenses.filter((e) => inRange(e.expenseDate, r));
  const collected = sum(pays, (p) => p.amountPaid);
  const expenses = sum(exps, (e) => e.amount);
  const occupied = st.rooms.filter((x) => x.status === 'Occupied').length;
  res.json({
    range: r,
    summary: { expectedIncome: sum(pays, (p) => p.amountDue), collected, outstanding: sum(pays, (p) => p.remainingBalance), expenses, netIncome: collected - expenses },
    occupancy: {
      totalRooms: st.rooms.length, occupied, available: st.rooms.filter((x) => x.status === 'Available').length,
      reserved: st.rooms.filter((x) => x.status === 'Reserved').length,
      percent: st.rooms.length ? Math.round((occupied / st.rooms.length) * 100) : 0,
    },
    byProperty: st.properties.map((p) => ({ name: p.name, income: sum(pays.filter((x) => x.propertyId === p.id), (x) => x.amountPaid), expenses: sum(exps.filter((x) => x.propertyId === p.id), (x) => x.amount) })),
    byCategory: [...new Set(exps.map((e) => e.category))].map((c) => ({ category: c, amount: sum(exps.filter((e) => e.category === c), (e) => e.amount) })),
    byTenant: st.tenants.map((t) => ({ name: t.fullName, paid: sum(pays.filter((p) => p.tenantId === t.id), (p) => p.amountPaid), balance: sum(pays.filter((p) => p.tenantId === t.id), (p) => p.remainingBalance) })).filter((x) => x.paid || x.balance),
  });
}));

// ============================== users (admin) + demo reset ==============================
app.get('/api/users', auth, allow('admin'), (_q, res) => res.json(s().users.map(publicUser)));
app.post('/api/users', auth, allow('admin'), asyncSafe((req, res) => {
  const b = req.body;
  if (!str(b.fullName) || !/^\S+@\S+\.\S+$/.test(str(b.email)) || String(b.password || '').length < 8) return fail(res, 400, 'Name, valid email and an 8+ character password are required.');
  if (s().users.some((u) => u.email.toLowerCase() === str(b.email).toLowerCase())) return fail(res, 409, 'Email already in use.');
  const u = { id: db.nextId('user'), fullName: str(b.fullName), email: str(b.email), passwordHash: bcrypt.hashSync(b.password, 10),
    role: ['owner', 'admin', 'staff'].includes(b.role) ? b.role : 'staff', phone: str(b.phone), isActive: true, createdAt: new Date().toISOString() };
  s().users.push(u); db.save(); res.status(201).json(publicUser(u));
}));
app.post('/api/demo/reset', auth, OWNER, (_q, res) => { db.reset(); res.json({ ok: true }); });

app.use('/api', (_q, res) => fail(res, 404, 'Unknown API route.'));
module.exports = app;
