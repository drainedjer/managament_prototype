/**
 * db-mem.js - Ephemeral in-memory relational fallback used ONLY in non-production
 * local preview or automated tests when DATABASE_URL is not configured.
 * Never writes to disk.
 */
const fs = require('fs');
const path = require('path');
const { manilaToday, manilaNowIso, addDays, addMonths, daysBetween } = require('./time');

const SEED_PATH = path.join(__dirname, 'seed.json');
let mem = null;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function cloneSeed() {
  const raw = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  raw.counters = {
    user: Math.max(0, ...raw.users.map((x) => x.id)) + 1,
    owner: Math.max(0, ...raw.owners.map((x) => x.id)) + 1,
    property: Math.max(0, ...raw.properties.map((x) => x.id)) + 1,
    building: Math.max(0, ...raw.buildings.map((x) => x.id)) + 1,
    room: Math.max(0, ...raw.rooms.map((x) => x.id)) + 1,
    tenant: Math.max(0, ...raw.tenants.map((x) => x.id)) + 1,
    lease: Math.max(0, ...raw.leases.map((x) => x.id)) + 1,
    application: Math.max(0, ...raw.applications.map((x) => x.id)) + 1,
    reservation: Math.max(0, ...raw.reservations.map((x) => x.id)) + 1,
    payment: Math.max(0, ...raw.payments.map((x) => x.id)) + 1,
    tx: Math.max(0, ...raw.paymentTransactions.map((x) => x.id)) + 1,
    expense: Math.max(0, ...raw.expenses.map((x) => x.id)) + 1,
    review: Math.max(0, ...raw.reviews.map((x) => x.id)) + 1,
    testimonial: Math.max(0, ...raw.testimonials.map((x) => x.id)) + 1,
    message: Math.max(0, ...raw.messages.map((x) => x.id)) + 1,
    viewing: Math.max(0, ...raw.viewingRequests.map((x) => x.id)) + 1,
    waitlist: 1,
    reset: 1,
    maintenance: Math.max(0, ...raw.maintenanceRequests.map((x) => x.id)) + 1,
    announcement: Math.max(0, ...raw.announcements.map((x) => x.id)) + 1,
    notification: Math.max(0, ...raw.notifications.map((x) => x.id)) + 1,
    audit: 1,
    view: 1,
  };
  return raw;
}

function store() {
  if (!mem) {
    mem = cloneSeed();
    recalcAllRooms();
  }
  return mem;
}
function nextId(k) {
  const s = store();
  const id = s.counters[k] || 1;
  s.counters[k] = id + 1;
  return id;
}

function recalcRoom(roomId) {
  const s = store();
  const room = s.rooms.find((r) => r.id === Number(roomId) && !r.archivedAt);
  if (!room) return null;
  const occupied = s.tenants.filter((t) => t.roomId === room.id && t.status === 'Active' && !t.archivedAt).length;
  const held = s.reservations
    .filter((res) => {
      if (res.roomId !== room.id || res.status !== 'Active') return false;
      const app = s.applications.find((a) => a.id === res.applicationId && !a.archivedAt);
      return app && ['Approved', 'Reserved'].includes(app.status);
    })
    .reduce((sum, res) => sum + num(res.bedsHeld || 1), 0);

  room.occupiedBeds = Math.min(room.capacity, occupied);
  room.heldBeds = held;
  room.availableBeds = room.status === 'Maintenance' ? 0 : Math.max(0, room.capacity - room.occupiedBeds - held);
  if (room.status !== 'Maintenance') {
    if (room.availableBeds === 0 && room.occupiedBeds > 0) room.status = 'Occupied';
    else if (held > 0 && room.availableBeds === 0) room.status = 'Reserved';
    else if (held > 0 && room.occupiedBeds === 0) room.status = 'Reserved';
    else room.status = 'Available';
  }
  return room;
}

function recalcAllRooms() {
  const s = store();
  s.rooms.filter((r) => !r.archivedAt).forEach((r) => recalcRoom(r.id));
}

function enrichProperty(p) {
  const s = store();
  const rooms = s.rooms.filter((r) => r.propertyId === p.id && !r.archivedAt);
  const open = rooms.filter((r) => r.status === 'Available' && r.availableBeds > 0);
  const openPrices = open.map((r) => num(r.monthlyPrice)).filter((x) => x > 0);
  const allPrices = rooms.map((r) => num(r.monthlyPrice)).filter((x) => x > 0);
  const computedPrice = openPrices.length ? Math.min(...openPrices) : allPrices.length ? Math.min(...allPrices) : num(p.monthlyPrice);
  const approvedReviews = s.reviews.filter((r) => r.propertyId === p.id && r.status === 'Approved');
  const reviewCount = approvedReviews.length;
  const averageRating = reviewCount ? Math.round((approvedReviews.reduce((a, b) => a + b.rating, 0) / reviewCount) * 10) / 10 : 0;
  const typeMap = new Map();
  open.forEach((r) => {
    const cur = typeMap.get(r.roomType) || { roomType: r.roomType, roomsAvailable: 0, bedsFree: 0 };
    cur.roomsAvailable += 1;
    cur.bedsFree += r.availableBeds;
    typeMap.set(r.roomType, cur);
  });
  return {
    ...p,
    monthlyPrice: computedPrice,
    images: p.images && p.images.length ? p.images : ['/images/placeholder.svg'],
    totalRoomsCount: rooms.length,
    availableRoomsCount: open.length,
    availableBedsCount: open.reduce((sum, r) => sum + r.availableBeds, 0),
    availableRoomTypes: [...typeMap.values()],
    averageRating,
    reviewCount,
  };
}

function computePayment(p) {
  const s = store();
  const txs = s.paymentTransactions.filter((t) => t.paymentId === p.id);
  const active = txs.filter((t) => !t.voidedAt);
  const amountDue = num(p.amountDue);
  const amountPaid = active.reduce((sum, t) => sum + num(t.amount), 0);
  const remainingBalance = Math.max(0, amountDue - amountPaid);
  const lastTx = active[active.length - 1];
  let status = 'Pending';
  if (remainingBalance === 0) status = 'Paid';
  else if (amountPaid > 0) status = 'Partial';
  else if (p.dueDate < manilaToday()) status = 'Overdue';
  return {
    ...p,
    amountDue,
    amountPaid,
    remainingBalance,
    paymentDate: lastTx ? lastTx.paymentDate : null,
    paymentMethod: lastTx ? lastTx.paymentMethod : 'Cash',
    referenceNumber: lastTx ? lastTx.referenceNumber : `BILL-${p.billingMonth.replace('-', '')}-${String(p.id).padStart(3, '0')}`,
    receiptNumber: lastTx ? lastTx.receiptNumber : `BILL-${String(p.id).padStart(4, '0')}`,
    status,
    transactions: txs,
  };
}

module.exports = {
  isPostgres: () => false,

  async healthCheck() {
    return { ok: true, db: 'preview-memory' };
  },

  async resetDemo() {
    mem = cloneSeed();
    recalcAllRooms();
    return { ok: true };
  },

  async findUserByEmail(email) {
    return store().users.find((u) => u.email.toLowerCase() === String(email).toLowerCase() && !u.archivedAt) || null;
  },

  async findUserById(id) {
    return store().users.find((u) => u.id === Number(id) && !u.archivedAt) || null;
  },

  async getOwnerIdForUser(user) {
    if (!user) return null;
    if (user.role === 'admin') return null;
    if (user.role === 'staff') return user.ownerId || 1;
    if (user.role === 'owner') {
      const own = store().owners.find((o) => o.userId === user.id);
      return own ? own.id : user.ownerId || null;
    }
    return null;
  },

  async recordFailedLogin(userId) {
    const u = store().users.find((x) => x.id === Number(userId));
    if (!u) return null;
    u.failedLoginAttempts = (u.failedLoginAttempts || 0) + 1;
    if (u.failedLoginAttempts >= 5) {
      u.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    }
    return { failed_login_attempts: u.failedLoginAttempts, locked_until: u.lockedUntil };
  },

  async clearFailedLogins(userId) {
    const u = store().users.find((x) => x.id === Number(userId));
    if (u) { u.failedLoginAttempts = 0; u.lockedUntil = null; }
  },

  async createUser({ fullName, email, passwordHash, role, phone, ownerId = null, businessName = '', consentAccepted = true }) {
    const s = store();
    const user = {
      id: nextId('user'),
      fullName,
      email: email.toLowerCase(),
      passwordHash,
      role,
      ownerId,
      phone: phone || '',
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      consentAcceptedAt: consentAccepted ? manilaNowIso() : null,
      archivedAt: null,
      createdAt: manilaNowIso(),
    };
    if (role === 'owner') {
      const oid = nextId('owner');
      s.owners.push({ id: oid, userId: user.id, businessName: businessName || `${fullName} Properties`, taxId: null, billingAddress: null });
      user.ownerId = oid;
    }
    s.users.push(user);
    return user;
  },

  async updateUserProfile(userId, { fullName, phone }) {
    const u = store().users.find((x) => x.id === Number(userId) && !x.archivedAt);
    if (!u) return null;
    u.fullName = fullName;
    u.phone = phone || '';
    return u;
  },

  async updateUserPassword(userId, passwordHash) {
    const u = store().users.find((x) => x.id === Number(userId) && !x.archivedAt);
    if (u) u.passwordHash = passwordHash;
  },

  async softDeleteUserAccount(userId) {
    const s = store();
    const u = s.users.find((x) => x.id === Number(userId) && !x.archivedAt);
    if (!u) return null;
    const anonEmail = `deleted-user-${userId}-${Date.now()}@redacted.local`;
    u.fullName = 'Deleted User';
    u.email = anonEmail;
    u.phone = '';
    u.isActive = false;
    u.archivedAt = manilaNowIso();
    s.favorites = s.favorites.filter((f) => f.userId !== userId);
    s.applications.filter((a) => a.userId === userId).forEach((a) => {
      a.fullName = 'Deleted User';
      a.email = anonEmail;
      a.contactNumber = '';
      a.archivedAt = manilaNowIso();
    });
    return { ok: true };
  },

  async listUsers() {
    return store().users.filter((u) => !u.archivedAt);
  },

  async createPasswordReset(userId, tokenHash, expiresAt) {
    store().passwordResets.push({ id: nextId('reset'), userId, tokenHash, expiresAt: new Date(expiresAt).toISOString(), usedAt: null });
  },

  async consumePasswordReset(tokenHash, newPasswordHash) {
    const s = store();
    const row = s.passwordResets.find((r) => r.tokenHash === tokenHash && !r.usedAt && new Date(r.expiresAt).getTime() > Date.now());
    if (!row) return null;
    row.usedAt = manilaNowIso();
    const u = s.users.find((x) => x.id === row.userId);
    if (u) { u.passwordHash = newPasswordHash; u.failedLoginAttempts = 0; u.lockedUntil = null; }
    return row.userId;
  },

  async getSettings() {
    return { ...store().siteSettings };
  },

  async updateSettings(data) {
    Object.assign(store().siteSettings, data);
    return { ...store().siteSettings };
  },

  async listPublicProperties(filters = {}) {
    const s = store();
    let list = s.properties.filter((p) => p.isPublished && !p.archivedAt).map(enrichProperty);
    const needle = String(filters.q || '').trim().toLowerCase();
    if (needle) list = list.filter((p) => [p.name, p.city, p.address, p.landmarks].join(' ').toLowerCase().includes(needle));
    if (filters.type) list = list.filter((p) => p.propertyType === filters.type);
    if (filters.minPrice) list = list.filter((p) => p.monthlyPrice >= num(filters.minPrice));
    if (filters.maxPrice) list = list.filter((p) => p.monthlyPrice <= num(filters.maxPrice));
    if (filters.amenity) list = list.filter((p) => p.amenities.includes(filters.amenity));
    if (filters.onlyAvailable === 'true') list = list.filter((p) => p.availableBedsCount > 0);
    if (filters.occupants) {
      const occ = num(filters.occupants);
      list = list.filter((p) => s.rooms.some((r) => r.propertyId === p.id && !r.archivedAt && r.status !== 'Maintenance' && r.availableBeds >= occ));
    }
    return list;
  },

  async getPublicPropertyById(id) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(id) && x.isPublished && !x.archivedAt);
    if (!p) return null;
    return {
      ...enrichProperty(p),
      buildings: s.buildings.filter((b) => b.propertyId === p.id),
      rooms: s.rooms.filter((r) => r.propertyId === p.id && !r.archivedAt).map((r) => ({ ...r, images: r.images?.length ? r.images : ['/images/placeholder.svg'] })),
    };
  },

  async recordPropertyView(propertyId) {
    store().propertyViews.push({ id: nextId('view'), propertyId: Number(propertyId), viewedAt: manilaNowIso() });
  },

  async listOwnerProperties(ownerId) {
    return store().properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map(enrichProperty);
  },

  async createProperty(ownerId, data) {
    const s = store();
    const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);
    const imgs = lines(data.images);
    const p = {
      id: nextId('property'),
      ownerId,
      name: data.name,
      propertyType: data.propertyType,
      address: data.address,
      city: data.city || 'Batangas City',
      latitude: num(data.latitude),
      longitude: num(data.longitude),
      description: data.description || '',
      monthlyPrice: num(data.monthlyPrice),
      amenities: lines(data.amenities),
      houseRules: lines(data.houseRules),
      images: imgs.length ? imgs : ['/images/placeholder.svg'],
      isPublished: data.isPublished !== false,
      contactPhone: data.contactPhone || '',
      contactEmail: data.contactEmail || '',
      locationAccess: data.locationAccess || '',
      nearbyPlaces: data.nearbyPlaces || '',
      landmarks: data.landmarks || '',
      walkingMinutesBsu: data.walkingMinutesBsu === '' ? null : data.walkingMinutesBsu ?? null,
      tricycleMinutesBsu: data.tricycleMinutesBsu === '' ? null : data.tricycleMinutesBsu ?? null,
      minLeaseMonths: num(data.minLeaseMonths) || 6,
      depositPolicy: data.depositPolicy || '',
      utilitiesPolicy: data.utilitiesPolicy || '',
      inclusions: data.inclusions || '',
      curfewPolicy: data.curfewPolicy || '',
      archivedAt: null,
      createdAt: manilaNowIso(),
    };
    s.properties.push(p);
    return enrichProperty(p);
  },

  async updateProperty(ownerId, id, data) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);
    const imgs = lines(data.images);
    Object.assign(p, {
      ...data,
      amenities: lines(data.amenities),
      houseRules: lines(data.houseRules),
      images: imgs.length ? imgs : p.images,
      isPublished: data.isPublished === undefined ? p.isPublished : !!data.isPublished,
    });
    return enrichProperty(p);
  },

  async togglePublishProperty(ownerId, id) {
    const p = store().properties.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    p.isPublished = !p.isPublished;
    return enrichProperty(p);
  },

  async archiveProperty(ownerId, id) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return { error: 'not_found' };
    if (s.tenants.some((t) => t.propertyId === p.id && t.status === 'Active' && !t.archivedAt)) return { error: 'active_tenants' };
    p.archivedAt = manilaNowIso();
    p.isPublished = false;
    s.rooms.filter((r) => r.propertyId === p.id).forEach((r) => (r.archivedAt = manilaNowIso()));
    return { ok: true };
  },

  async listBuildings(ownerId) {
    const s = store();
    const propIds = new Set(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => p.id));
    return s.buildings.filter((b) => propIds.has(b.propertyId));
  },

  async createBuilding(ownerId, data) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(data.propertyId) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    const row = { id: nextId('building'), propertyId: p.id, name: data.name, floors: Math.max(1, num(data.floors)), description: data.description || '', createdAt: manilaNowIso() };
    s.buildings.push(row);
    return row;
  },

  async updateBuilding(ownerId, id, data) {
    const s = store();
    const row = s.buildings.find((b) => b.id === Number(id));
    if (!row) return null;
    const p = s.properties.find((x) => x.id === row.propertyId && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    Object.assign(row, { name: data.name, floors: Math.max(1, num(data.floors)), description: data.description || '' });
    s.rooms.filter((r) => r.buildingId === row.id).forEach((r) => (r.buildingName = row.name));
    return row;
  },

  async deleteBuilding(ownerId, id) {
    const s = store();
    const row = s.buildings.find((b) => b.id === Number(id));
    if (!row) return { error: 'not_found' };
    const p = s.properties.find((x) => x.id === row.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return { error: 'not_found' };
    if (s.rooms.some((r) => r.buildingId === row.id && !r.archivedAt)) return { error: 'has_rooms' };
    s.buildings = s.buildings.filter((b) => b.id !== row.id);
    return { ok: true };
  },

  async listRooms(ownerId) {
    const s = store();
    const propIds = new Set(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => p.id));
    return s.rooms.filter((r) => !r.archivedAt && propIds.has(r.propertyId)).map((r) => ({ ...r, images: r.images?.length ? r.images : ['/images/placeholder.svg'] }));
  },

  async createRoom(ownerId, data) {
    const s = store();
    const b = s.buildings.find((x) => x.id === Number(data.buildingId));
    if (!b) return { error: 'building_not_found' };
    const p = s.properties.find((x) => x.id === b.propertyId && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return { error: 'building_not_found' };
    if (s.rooms.some((r) => r.buildingId === b.id && r.roomNumber === data.roomNumber && !r.archivedAt)) return { error: 'duplicate' };
    const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);
    const imgs = lines(data.images);
    const room = {
      id: nextId('room'), propertyId: p.id, buildingId: b.id, buildingName: b.name, floorNumber: num(data.floorNumber) || 1,
      roomNumber: data.roomNumber, roomType: data.roomType, capacity: Math.max(1, num(data.capacity)), occupiedBeds: 0,
      heldBeds: 0, availableBeds: 0, monthlyPrice: num(data.monthlyPrice), status: data.status || 'Available',
      description: data.description || '', images: imgs.length ? imgs : ['/images/placeholder.svg'], lastVacatedAt: null, archivedAt: null,
    };
    s.rooms.push(room);
    recalcRoom(room.id);
    return { room };
  },

  async updateRoom(ownerId, id, data) {
    const s = store();
    const r = s.rooms.find((x) => x.id === Number(id) && !x.archivedAt);
    if (!r) return { error: 'not_found' };
    const p = s.properties.find((x) => x.id === r.propertyId && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return { error: 'not_found' };
    if (num(data.capacity) < r.occupiedBeds) return { error: 'capacity_low' };
    const b = s.buildings.find((x) => x.id === Number(data.buildingId)) || { id: r.buildingId, propertyId: r.propertyId, name: r.buildingName };
    const wasBlocked = r.status === 'Maintenance' || r.availableBeds === 0;
    const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);
    const imgs = lines(data.images);
    Object.assign(r, {
      propertyId: b.propertyId, buildingId: b.id, buildingName: b.name, floorNumber: num(data.floorNumber) || 1,
      roomNumber: data.roomNumber, roomType: data.roomType, capacity: num(data.capacity), monthlyPrice: num(data.monthlyPrice),
      status: data.status || 'Available', description: data.description || '',
      images: imgs.length ? imgs : r.images,
    });
    recalcRoom(r.id);
    return { room: r, bedOpened: wasBlocked && r.availableBeds > 0 && r.status === 'Available', propertyId: p.id, propertyName: p.name };
  },

  async archiveRoom(ownerId, id) {
    const s = store();
    const r = s.rooms.find((x) => x.id === Number(id) && !x.archivedAt);
    if (!r) return { error: 'not_found' };
    const p = s.properties.find((x) => x.id === r.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return { error: 'not_found' };
    if (s.tenants.some((t) => t.roomId === r.id && t.status === 'Active' && !t.archivedAt)) return { error: 'active_tenants' };
    r.archivedAt = manilaNowIso();
    return { ok: true };
  },

  async listTenants(ownerId) {
    const s = store();
    return s.tenants
      .filter((t) => !t.archivedAt && (!ownerId || t.ownerId === ownerId))
      .map((t) => {
        const lease = [...s.leases].reverse().find((l) => l.tenantId === t.id);
        return { ...t, leaseEndDate: lease ? lease.endDate : null, leaseStatus: lease ? lease.status : null };
      });
  },

  async getTenantById(ownerId, id) {
    return store().tenants.find((t) => t.id === Number(id) && !t.archivedAt && (!ownerId || t.ownerId === ownerId)) || null;
  },

  async createTenant(ownerId, data) {
    const s = store();
    const room = s.rooms.find((r) => r.id === Number(data.roomId) && !r.archivedAt);
    if (!room) return { error: 'room_not_found' };
    const prop = s.properties.find((p) => p.id === room.propertyId && !p.archivedAt && (!ownerId || p.ownerId === ownerId));
    if (!prop) return { error: 'room_not_found' };
    if (data.status === 'Active') {
      if (room.status === 'Maintenance') return { error: 'maintenance' };
      recalcRoom(room.id);
      if (room.availableBeds < 1) return { error: 'room_full' };
    }
    const moveIn = data.moveInDate || manilaToday();
    const leaseEnd = data.leaseEndDate || addMonths(moveIn, 6);
    const rent = num(data.monthlyRent) || num(room.monthlyPrice);
    const user = data.email ? s.users.find((u) => u.email.toLowerCase() === data.email.toLowerCase() && u.role === 'customer' && !u.archivedAt) : null;
    const t = {
      id: nextId('tenant'), userId: user ? user.id : null, ownerId: prop.ownerId, fullName: data.fullName,
      email: data.email || '', contactNumber: data.contactNumber, address: data.address || '', emergencyContact: data.emergencyContact || '',
      propertyId: prop.id, roomId: room.id, moveInDate: moveIn, moveOutDate: null, monthlyRent: rent,
      securityDeposit: num(data.securityDeposit), status: data.status || 'Active',
      moveInChecklist: null, moveOutChecklist: null, depositDeductions: 0, depositRefunded: 0, depositRefundedAt: null,
      archivedAt: null, createdAt: manilaNowIso(),
    };
    s.tenants.push(t);
    s.leases.push({ id: nextId('lease'), tenantId: t.id, ownerId: prop.ownerId, propertyId: prop.id, roomId: room.id, startDate: moveIn, endDate: leaseEnd, monthlyRate: rent, depositAmount: t.securityDeposit, status: 'Active', renewalNotifiedAt: null, notes: '' });
    recalcRoom(room.id);
    return { tenant: t };
  },

  async updateTenant(ownerId, id, data) {
    const s = store();
    const t = s.tenants.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!t) return { error: 'not_found' };
    const nextRoomId = data.roomId ? Number(data.roomId) : t.roomId;
    if (data.status === 'Active' && nextRoomId) {
      const room = s.rooms.find((r) => r.id === nextRoomId && !r.archivedAt);
      if (!room) return { error: 'room_not_found' };
      if (room.status === 'Maintenance') return { error: 'maintenance' };
      if (nextRoomId !== t.roomId || t.status !== 'Active') {
        recalcRoom(room.id);
        if (room.availableBeds < 1) return { error: 'room_full' };
      }
    }
    const oldRoomId = t.roomId;
    Object.assign(t, {
      fullName: data.fullName, email: data.email, contactNumber: data.contactNumber, address: data.address,
      emergencyContact: data.emergencyContact, roomId: nextRoomId, moveInDate: data.moveInDate || t.moveInDate,
      moveOutDate: data.moveOutDate || null, monthlyRent: data.monthlyRent ?? t.monthlyRent,
      securityDeposit: data.securityDeposit ?? t.securityDeposit, status: data.status,
    });
    if (oldRoomId) recalcRoom(oldRoomId);
    if (nextRoomId) recalcRoom(nextRoomId);
    return { tenant: t };
  },

  async moveOutTenant(ownerId, id) {
    const s = store();
    const t = s.tenants.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!t) return null;
    const today = manilaToday();
    t.status = 'Former Tenant';
    t.moveOutDate = today;
    s.leases.filter((l) => l.tenantId === t.id && ['Active', 'Expiring'].includes(l.status)).forEach((l) => (l.status = 'Completed'));
    let bedOpened = false;
    let roomNumber = '';
    const prop = s.properties.find((p) => p.id === t.propertyId);
    if (t.roomId) {
      const r = s.rooms.find((x) => x.id === t.roomId);
      if (r) { r.lastVacatedAt = today; roomNumber = r.roomNumber; }
      const calc = recalcRoom(t.roomId);
      bedOpened = !!(calc && calc.availableBeds > 0);
    }
    return { tenantId: t.id, propertyId: t.propertyId, propertyName: prop?.name || '', roomNumber, bedOpened };
  },

  async saveTenantChecklist(ownerId, id, data) {
    const t = store().tenants.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!t) return null;
    const entry = { items: data.items || {}, meterReading: data.meterReading || '', notes: data.notes || '', recordedAt: manilaNowIso() };
    if (data.type === 'move_in') t.moveInChecklist = entry;
    else t.moveOutChecklist = entry;
    if (data.depositDeductions !== undefined) t.depositDeductions = num(data.depositDeductions);
    if (data.depositRefunded !== undefined) t.depositRefunded = num(data.depositRefunded);
    if (data.depositRefundedAt !== undefined) t.depositRefundedAt = data.depositRefundedAt || null;
    return { ok: true };
  },

  async archiveTenant(ownerId, id) {
    const t = store().tenants.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!t) return null;
    t.archivedAt = manilaNowIso();
    t.status = 'Inactive';
    if (t.roomId) recalcRoom(t.roomId);
    return { ok: true };
  },

  async listLeases(ownerId) {
    const s = store();
    const today = manilaToday();
    return s.leases
      .filter((l) => !ownerId || l.ownerId === ownerId)
      .map((l) => {
        const t = s.tenants.find((x) => x.id === l.tenantId);
        if (!t || t.archivedAt) return null;
        const p = s.properties.find((x) => x.id === l.propertyId);
        const r = s.rooms.find((x) => x.id === l.roomId);
        const daysLeft = daysBetween(today, l.endDate);
        return {
          ...l, tenantName: t.fullName, propertyName: p?.name || '', roomNumber: r?.roomNumber || '—',
          daysLeft, expiringSoon: ['Active', 'Expiring'].includes(l.status) && daysLeft <= 30,
        };
      })
      .filter(Boolean);
  },

  async listApplications(ownerId) {
    const s = store();
    const propMap = new Map(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => [p.id, p]));
    return s.applications
      .filter((a) => !a.archivedAt && propMap.has(a.propertyId))
      .map((a) => ({
        ...a,
        ownerId: propMap.get(a.propertyId).ownerId,
        hasDocument: s.applicationDocuments.some((d) => d.applicationId === a.id),
      }))
      .sort((a, b) => b.id - a.id);
  },

  async getApplicationById(ownerId, id) {
    const s = store();
    const a = s.applications.find((x) => x.id === Number(id) && !x.archivedAt);
    if (!a) return null;
    const p = s.properties.find((x) => x.id === a.propertyId && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    return p ? a : null;
  },

  async createPublicApplication(data, userId = null, doc = null) {
    const s = store();
    const prop = s.properties.find((p) => p.id === Number(data.propertyId) && p.isPublished && !p.archivedAt);
    if (!prop) return { error: 'property_not_found' };
    const dup = s.applications.some(
      (a) => a.propertyId === prop.id && !a.archivedAt && a.email.toLowerCase() === data.email.toLowerCase() && ['Pending', 'Approved', 'Reserved'].includes(a.status)
    );
    if (dup) return { error: 'duplicate_active' };
    const id = nextId('application');
    const year = manilaToday().slice(0, 4);
    const ref = `APP-${year}-${1000 + id}`;
    const appRow = {
      id, referenceNumber: ref, userId, fullName: data.fullName, email: data.email.toLowerCase(),
      contactNumber: data.contactNumber, propertyId: prop.id, preferredRoomType: data.preferredRoomType || prop.propertyType,
      assignedRoomId: null, expectedMoveInDate: data.expectedMoveInDate, reservationDate: null,
      occupants: num(data.occupants) || 1, message: data.message || '', consentAccepted: true,
      status: 'Pending', archivedAt: null, createdAt: manilaNowIso(), updatedAt: manilaNowIso(),
    };
    s.applications.push(appRow);
    if (doc) s.applicationDocuments.push({ id: id, applicationId: id, ...doc });
    const own = s.owners.find((o) => o.id === prop.ownerId);
    if (own) {
      s.notifications.push({ id: nextId('notification'), userId: own.userId, title: `New application ${ref}`, body: `${data.fullName} applied for ${prop.name}.`, link: 'applications', isRead: false, createdAt: manilaNowIso() });
    }
    return { referenceNumber: ref, status: 'Pending', propertyName: prop.name, id };
  },

  async trackPublicApplication(referenceNumber, email) {
    const s = store();
    const a = s.applications.find(
      (x) => !x.archivedAt && x.referenceNumber.toUpperCase() === String(referenceNumber).toUpperCase() && x.email.toLowerCase() === String(email).toLowerCase()
    );
    if (!a) return null;
    const p = s.properties.find((x) => x.id === a.propertyId);
    return {
      referenceNumber: a.referenceNumber,
      status: a.status,
      propertyName: p?.name || '',
      preferredRoomType: a.preferredRoomType,
      expectedMoveInDate: a.expectedMoveInDate,
      updatedAt: a.updatedAt || a.createdAt,
    };
  },

  async updateApplicationStatus(ownerId, id, { status, assignedRoomId, reservationDate }) {
    const s = store();
    const a = s.applications.find((x) => x.id === Number(id) && !x.archivedAt);
    if (!a) return { error: 'not_found' };
    const prop = s.properties.find((p) => p.id === a.propertyId && !p.archivedAt && (!ownerId || p.ownerId === ownerId));
    if (!prop) return { error: 'not_found' };
    const targetRoomId = assignedRoomId ? Number(assignedRoomId) : a.assignedRoomId;
    const oldRoomId = a.assignedRoomId;
    let roomNumber = null;
    let bedOpened = false;

    if (['Approved', 'Reserved'].includes(status)) {
      if (!targetRoomId) return { error: 'room_required' };
      const room = s.rooms.find((r) => r.id === targetRoomId && r.propertyId === prop.id && !r.archivedAt);
      if (!room) return { error: 'room_not_found' };
      if (room.status === 'Maintenance') return { error: 'room_unavailable' };
      roomNumber = room.roomNumber;
      const occupied = s.tenants.filter((t) => t.roomId === room.id && t.status === 'Active' && !t.archivedAt).length;
      const heldOther = s.reservations
        .filter((r) => {
          if (r.roomId !== room.id || r.status !== 'Active' || r.applicationId === a.id) return false;
          const other = s.applications.find((x) => x.id === r.applicationId && !x.archivedAt);
          return other && ['Approved', 'Reserved'].includes(other.status);
        })
        .reduce((sum, r) => sum + num(r.bedsHeld || 1), 0);
      const free = room.capacity - occupied - heldOther;
      if (free < a.occupants) {
        return { error: 'insufficient_beds', detail: `Room ${room.roomNumber} only has ${Math.max(0, free)} bed(s) free.` };
      }
      const resDate = reservationDate || a.reservationDate || manilaToday();
      const expiresAt = addDays(resDate, 7);
      const existing = s.reservations.find((r) => r.applicationId === a.id);
      if (existing) {
        Object.assign(existing, { roomId: targetRoomId, bedsHeld: a.occupants, reservedDate: resDate, expiresAt, status: 'Active' });
      } else {
        s.reservations.push({ id: nextId('reservation'), applicationId: a.id, roomId: targetRoomId, bedsHeld: a.occupants, reservedDate: resDate, expiresAt, status: 'Active' });
      }
      a.status = status;
      a.assignedRoomId = targetRoomId;
      a.reservationDate = resDate;
      a.updatedAt = manilaNowIso();
      if (oldRoomId && oldRoomId !== targetRoomId) {
        const oldCalc = recalcRoom(oldRoomId);
        if (oldCalc && oldCalc.availableBeds > 0) bedOpened = true;
      }
      recalcRoom(targetRoomId);
    } else {
      s.reservations.filter((r) => r.applicationId === a.id && r.status === 'Active').forEach((r) => (r.status = 'Cancelled'));
      a.status = status;
      a.updatedAt = manilaNowIso();
      if (oldRoomId) {
        const calc = recalcRoom(oldRoomId);
        if (calc && calc.availableBeds > 0) bedOpened = true;
      }
    }
    return { application: { ...a, propertyName: prop.name, roomNumber }, bedOpened };
  },

  async convertApplicationToTenant(ownerId, id, data) {
    const s = store();
    const a = s.applications.find((x) => x.id === Number(id) && !x.archivedAt);
    if (!a) return { error: 'not_found' };
    const prop = s.properties.find((p) => p.id === a.propertyId && !p.archivedAt && (!ownerId || p.ownerId === ownerId));
    if (!prop) return { error: 'not_found' };
    if (a.status === 'Completed') return { error: 'already_converted' };
    const room = s.rooms.find((r) => r.id === a.assignedRoomId && !r.archivedAt);
    if (!room) return { error: 'no_room' };
    if (room.status === 'Maintenance') return { error: 'maintenance' };
    const occupied = s.tenants.filter((t) => t.roomId === room.id && t.status === 'Active' && !t.archivedAt).length;
    const heldOther = s.reservations.filter((r) => r.roomId === room.id && r.status === 'Active' && r.applicationId !== a.id).reduce((sum, r) => sum + num(r.bedsHeld || 1), 0);
    if (room.capacity - occupied - heldOther < 1) return { error: 'room_full' };

    const moveIn = data.moveInDate || a.expectedMoveInDate || manilaToday();
    const leaseEnd = data.leaseEndDate || addMonths(moveIn, 6);
    const user = s.users.find((u) => u.email.toLowerCase() === a.email.toLowerCase() && u.role === 'customer' && !u.archivedAt);
    const tenant = {
      id: nextId('tenant'), userId: a.userId || user?.id || null, ownerId: prop.ownerId, fullName: a.fullName,
      email: a.email, contactNumber: a.contactNumber, address: data.address, emergencyContact: data.emergencyContact,
      propertyId: room.propertyId, roomId: room.id, moveInDate: moveIn, moveOutDate: null,
      monthlyRent: room.monthlyPrice, securityDeposit: num(data.securityDeposit), status: 'Active',
      moveInChecklist: null, moveOutChecklist: null, depositDeductions: 0, depositRefunded: 0, depositRefundedAt: null,
      archivedAt: null, createdAt: manilaNowIso(),
    };
    s.tenants.push(tenant);
    s.leases.push({ id: nextId('lease'), tenantId: tenant.id, ownerId: prop.ownerId, propertyId: room.propertyId, roomId: room.id, startDate: moveIn, endDate: leaseEnd, monthlyRate: room.monthlyPrice, depositAmount: tenant.securityDeposit, status: 'Active', renewalNotifiedAt: null, notes: data.notes || '' });
    s.reservations.filter((r) => r.applicationId === a.id && r.status === 'Active').forEach((r) => (r.status = 'Converted'));
    a.status = 'Completed';
    a.updatedAt = manilaNowIso();
    recalcRoom(room.id);
    return { tenant };
  },

  async archiveApplication(ownerId, id) {
    const s = store();
    const a = s.applications.find((x) => x.id === Number(id) && !x.archivedAt);
    if (!a) return null;
    const prop = s.properties.find((p) => p.id === a.propertyId && (!ownerId || p.ownerId === ownerId));
    if (!prop) return null;
    s.reservations.filter((r) => r.applicationId === a.id && r.status === 'Active').forEach((r) => (r.status = 'Cancelled'));
    a.archivedAt = manilaNowIso();
    a.status = 'Cancelled';
    if (a.assignedRoomId) recalcRoom(a.assignedRoomId);
    return { ok: true };
  },

  async getApplicationDocument(ownerId, appId) {
    const s = store();
    const a = s.applications.find((x) => x.id === Number(appId));
    if (!a) return null;
    const p = s.properties.find((x) => x.id === a.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    return s.applicationDocuments.find((d) => d.applicationId === Number(appId)) || null;
  },

  async deleteApplicationDocument(ownerId, appId) {
    const s = store();
    const a = s.applications.find((x) => x.id === Number(appId));
    if (!a) return false;
    const p = s.properties.find((x) => x.id === a.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return false;
    const before = s.applicationDocuments.length;
    s.applicationDocuments = s.applicationDocuments.filter((d) => d.applicationId !== Number(appId));
    return s.applicationDocuments.length < before;
  },

  async listPayments(ownerId) {
    return store().payments.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map(computePayment).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.id - a.id);
  },

  async getPaymentById(ownerId, id) {
    const p = store().payments.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    return p ? computePayment(p) : null;
  },

  async createPayment(ownerId, userId, data) {
    const s = store();
    const t = s.tenants.find((x) => x.id === Number(data.tenantId) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!t) return { error: 'tenant_not_found' };
    if (s.payments.some((p) => p.tenantId === t.id && p.billingMonth === data.billingMonth && !p.archivedAt)) return { error: 'duplicate' };
    const p = {
      id: nextId('payment'), tenantId: t.id, ownerId: t.ownerId, propertyId: t.propertyId, roomId: t.roomId,
      billingMonth: data.billingMonth, dueDate: data.dueDate || `${data.billingMonth}-05`,
      amountDue: data.amountDue !== '' && data.amountDue !== undefined ? num(data.amountDue) : num(t.monthlyRent),
      notes: data.notes || '', archivedAt: null,
    };
    s.payments.push(p);
    const initAmt = num(data.initialAmountPaid);
    if (initAmt > 0) {
      const txId = nextId('tx');
      const payDate = data.paymentDate || manilaToday();
      s.paymentTransactions.push({
        id: txId, paymentId: p.id, amount: initAmt, paymentDate: payDate, paymentMethod: data.paymentMethod || 'Cash',
        referenceNumber: `TXN-${data.billingMonth.replace('-', '')}-${String(txId).padStart(4, '0')}`,
        receiptNumber: `RCPT-${payDate.slice(0, 4)}-${String(txId).padStart(4, '0')}`,
        notes: data.notes || '', recordedBy: userId, voidedAt: null, voidReason: null,
      });
    }
    return { payment: computePayment(p) };
  },

  async addPaymentTransaction(ownerId, paymentId, userId, data) {
    const s = store();
    const p = s.payments.find((x) => x.id === Number(paymentId) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    const txId = nextId('tx');
    const payDate = data.paymentDate || manilaToday();
    const tx = {
      id: txId, paymentId: p.id, amount: num(data.amount), paymentDate: payDate, paymentMethod: data.paymentMethod,
      referenceNumber: `TXN-${p.billingMonth.replace('-', '')}-${String(txId).padStart(4, '0')}`,
      receiptNumber: `RCPT-${payDate.slice(0, 4)}-${String(txId).padStart(4, '0')}`,
      notes: data.notes || '', recordedBy: userId, voidedAt: null, voidReason: null,
    };
    s.paymentTransactions.push(tx);
    return tx;
  },

  async editPaymentTransaction(ownerId, txId, userId, data) {
    const s = store();
    const tx = s.paymentTransactions.find((t) => t.id === Number(txId) && !t.voidedAt);
    if (!tx) return null;
    const p = s.payments.find((x) => x.id === tx.paymentId && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    Object.assign(tx, { amount: num(data.amount), paymentDate: data.paymentDate, paymentMethod: data.paymentMethod, notes: data.notes || '', editReason: data.reason, editedBy: userId, editedAt: manilaNowIso() });
    return tx;
  },

  async voidPaymentTransaction(ownerId, txId, userId, reason) {
    const s = store();
    const tx = s.paymentTransactions.find((t) => t.id === Number(txId) && !t.voidedAt);
    if (!tx) return null;
    const p = s.payments.find((x) => x.id === tx.paymentId && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    tx.voidedAt = manilaNowIso();
    tx.voidReason = reason;
    tx.voidedBy = userId;
    return tx;
  },

  async archivePayment(ownerId, id) {
    const p = store().payments.find((x) => x.id === Number(id) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return false;
    p.archivedAt = manilaNowIso();
    return true;
  },

  async listExpenseCategories() { return store().expenseCategories; },

  async listExpenses(ownerId) {
    return store().expenses.filter((e) => !ownerId || e.ownerId === ownerId).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  },

  async createExpense(ownerId, data) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(data.propertyId) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    const cat = s.expenseCategories.find((c) => c.id === Number(data.categoryId) || c.name.toLowerCase() === String(data.category || '').toLowerCase()) || s.expenseCategories[9];
    const row = {
      id: nextId('expense'), ownerId: p.ownerId, propertyId: p.id, categoryId: cat.id, category: cat.name,
      description: data.description, amount: num(data.amount), expenseDate: data.expenseDate || manilaToday(),
      paymentMethod: data.paymentMethod || 'Cash', receiptReference: data.receiptReference || '',
    };
    s.expenses.push(row);
    return row;
  },

  async updateExpense(ownerId, id, data) {
    const s = store();
    const e = s.expenses.find((x) => x.id === Number(id) && (!ownerId || x.ownerId === ownerId));
    if (!e) return null;
    const p = s.properties.find((x) => x.id === Number(data.propertyId) && !x.archivedAt && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    const cat = s.expenseCategories.find((c) => c.id === Number(data.categoryId) || c.name.toLowerCase() === String(data.category || '').toLowerCase()) || s.expenseCategories[9];
    Object.assign(e, { propertyId: p.id, categoryId: cat.id, category: cat.name, description: data.description, amount: num(data.amount), expenseDate: data.expenseDate || e.expenseDate, paymentMethod: data.paymentMethod || e.paymentMethod, receiptReference: data.receiptReference || '' });
    return e;
  },

  async deleteExpense(ownerId, id) {
    const s = store();
    const before = s.expenses.length;
    s.expenses = s.expenses.filter((e) => !(e.id === Number(id) && (!ownerId || e.ownerId === ownerId)));
    return s.expenses.length < before;
  },

  async listPublicLatestReviews(limit = 6) {
    const s = store();
    const props = new Map(s.properties.filter((p) => p.isPublished && !p.archivedAt).map((p) => [p.id, p.name]));
    return s.reviews
      .filter((r) => r.status === 'Approved' && props.has(r.propertyId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(0, limit)
      .map(({ email, ...rest }) => ({ ...rest, propertyName: props.get(rest.propertyId) }));
  },

  async listPropertyReviews(propertyId) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(propertyId) && x.isPublished && !x.archivedAt);
    if (!p) return null;
    const list = s.reviews.filter((r) => r.propertyId === p.id && r.status === 'Approved').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    list.forEach((r) => { breakdown[r.rating] = (breakdown[r.rating] || 0) + 1; });
    const count = list.length;
    const average = count ? Math.round((list.reduce((a, b) => a + b.rating, 0) / count) * 10) / 10 : 0;
    return { average, count, breakdown, reviews: list.map(({ email, ...rest }) => rest) };
  },

  async createPublicReview(data) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(data.propertyId) && x.isPublished && !x.archivedAt);
    if (!p) return { error: 'property_not_found' };
    if (s.reviews.some((r) => r.propertyId === p.id && r.email.toLowerCase() === data.email.toLowerCase())) return { error: 'duplicate' };
    const rev = { id: nextId('review'), propertyId: p.id, reviewerName: data.reviewerName, email: data.email.toLowerCase(), rating: num(data.rating), title: data.title || '', comment: data.comment, status: 'Pending', ownerReply: null, repliedAt: null, createdAt: manilaNowIso() };
    s.reviews.push(rev);
    return { review: rev };
  },

  async listReviews(ownerId) {
    const s = store();
    const propIds = new Set(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => p.id));
    return s.reviews.filter((r) => propIds.has(r.propertyId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async updateReviewStatus(ownerId, id, status) {
    const s = store();
    const rev = s.reviews.find((r) => r.id === Number(id));
    if (!rev) return null;
    const p = s.properties.find((x) => x.id === rev.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    rev.status = status;
    return rev;
  },

  async replyReview(ownerId, id, ownerReply) {
    const s = store();
    const rev = s.reviews.find((r) => r.id === Number(id));
    if (!rev) return null;
    const p = s.properties.find((x) => x.id === rev.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    rev.ownerReply = ownerReply;
    rev.repliedAt = manilaNowIso();
    return rev;
  },

  async deleteReview(ownerId, id) {
    const s = store();
    const rev = s.reviews.find((r) => r.id === Number(id));
    if (!rev) return false;
    const p = s.properties.find((x) => x.id === rev.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return false;
    s.reviews = s.reviews.filter((r) => r.id !== rev.id);
    return true;
  },

  async listPublicTestimonials() {
    const s = store();
    return s.testimonials.filter((t) => t.status === 'Approved').slice(-6).reverse().map((t) => ({ ...t, propertyName: s.properties.find((p) => p.id === t.propertyId)?.name || '' }));
  },

  async listTestimonials(ownerId) {
    const s = store();
    const propIds = new Set(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => p.id));
    return s.testimonials.filter((t) => !t.propertyId || propIds.has(t.propertyId)).map((t) => ({ ...t, propertyName: s.properties.find((p) => p.id === t.propertyId)?.name || '' }));
  },

  async createPublicTestimonial(data) {
    const row = { id: nextId('testimonial'), propertyId: data.propertyId ? Number(data.propertyId) : null, authorName: data.authorName, roleLabel: data.roleLabel || 'Resident', rating: num(data.rating) || 5, quote: data.quote, status: 'Pending', createdAt: manilaNowIso() };
    store().testimonials.push(row);
    return row;
  },

  async updateTestimonialStatus(id, status) {
    const t = store().testimonials.find((x) => x.id === Number(id));
    if (!t) return null;
    t.status = status;
    return t;
  },

  async deleteTestimonial(id) {
    const s = store();
    const before = s.testimonials.length;
    s.testimonials = s.testimonials.filter((t) => t.id !== Number(id));
    return s.testimonials.length < before;
  },

  async createContactMessage(data) {
    const row = { id: nextId('message'), fullName: data.fullName, email: data.email.toLowerCase(), phone: data.phone || '', subject: data.subject || 'General inquiry', message: data.message, consentAccepted: true, status: 'New', createdAt: manilaNowIso() };
    store().messages.push(row);
    return row;
  },

  async listMessages() { return [...store().messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },

  async updateMessageStatus(id, status) {
    const m = store().messages.find((x) => x.id === Number(id));
    if (!m) return null;
    m.status = status;
    return m;
  },

  async deleteMessage(id) {
    const s = store();
    const before = s.messages.length;
    s.messages = s.messages.filter((m) => m.id !== Number(id));
    return s.messages.length < before;
  },

  async createViewingRequest(data, userId = null) {
    const s = store();
    const prop = s.properties.find((p) => p.id === Number(data.propertyId) && p.isPublished && !p.archivedAt);
    if (!prop) return null;
    const row = { id: nextId('viewing'), propertyId: prop.id, userId, fullName: data.fullName, email: data.email.toLowerCase(), phone: data.phone, preferredDate: data.preferredDate, preferredTime: data.preferredTime, notes: data.notes || '', consentAccepted: true, status: 'Pending', createdAt: manilaNowIso() };
    s.viewingRequests.push(row);
    const own = s.owners.find((o) => o.id === prop.ownerId);
    if (own) s.notifications.push({ id: nextId('notification'), userId: own.userId, title: 'New viewing request', body: `${data.fullName} requested a viewing at ${prop.name} on ${data.preferredDate}.`, link: 'viewings', isRead: false, createdAt: manilaNowIso() });
    return { ...row, propertyName: prop.name };
  },

  async listViewingRequests(ownerId) {
    const s = store();
    const propMap = new Map(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => [p.id, p.name]));
    return s.viewingRequests.filter((v) => propMap.has(v.propertyId)).map((v) => ({ ...v, propertyName: propMap.get(v.propertyId) }));
  },

  async updateViewingStatus(ownerId, id, status) {
    const s = store();
    const v = s.viewingRequests.find((x) => x.id === Number(id));
    if (!v) return null;
    const p = s.properties.find((x) => x.id === v.propertyId && (!ownerId || x.ownerId === ownerId));
    if (!p) return null;
    v.status = status;
    return { ...v, propertyName: p.name };
  },

  async joinWaitlist(data) {
    const s = store();
    const p = s.properties.find((x) => x.id === Number(data.propertyId) && x.isPublished && !x.archivedAt);
    if (!p) return null;
    if (s.waitlist.some((w) => w.propertyId === p.id && w.email.toLowerCase() === data.email.toLowerCase() && w.status === 'Waiting')) {
      return { alreadyWaiting: true, propertyName: p.name };
    }
    const row = { id: nextId('waitlist'), propertyId: p.id, fullName: data.fullName, email: data.email.toLowerCase(), phone: data.phone || '', preferredRoomType: data.preferredRoomType || 'Any', consentAccepted: true, status: 'Waiting', notifiedAt: null, createdAt: manilaNowIso() };
    s.waitlist.push(row);
    return { entry: row, propertyName: p.name };
  },

  async listWaitlist(ownerId) {
    const s = store();
    const propMap = new Map(s.properties.filter((p) => !p.archivedAt && (!ownerId || p.ownerId === ownerId)).map((p) => [p.id, p.name]));
    return s.waitlist.filter((w) => propMap.has(w.propertyId)).map((w) => ({ ...w, propertyName: propMap.get(w.propertyId) }));
  },

  async getWaitingForProperty(propertyId) {
    return store().waitlist.filter((w) => w.propertyId === Number(propertyId) && w.status === 'Waiting');
  },

  async markWaitlistNotified(ids) {
    const set = new Set(ids);
    store().waitlist.filter((w) => set.has(w.id)).forEach((w) => { w.status = 'Notified'; w.notifiedAt = manilaNowIso(); });
  },

  async listCustomerFavorites(userId) {
    const s = store();
    const favIds = new Set(s.favorites.filter((f) => f.userId === Number(userId)).map((f) => f.propertyId));
    return s.properties.filter((p) => favIds.has(p.id) && p.isPublished && !p.archivedAt).map(enrichProperty);
  },

  async addFavorite(userId, propertyId) {
    const s = store();
    if (!s.favorites.some((f) => f.userId === Number(userId) && f.propertyId === Number(propertyId))) {
      s.favorites.push({ userId: Number(userId), propertyId: Number(propertyId), createdAt: manilaNowIso() });
    }
    return { ok: true };
  },

  async removeFavorite(userId, propertyId) {
    const s = store();
    s.favorites = s.favorites.filter((f) => !(f.userId === Number(userId) && f.propertyId === Number(propertyId)));
    return { ok: true };
  },

  async listCustomerApplications(userId, email) {
    const s = store();
    return s.applications
      .filter((a) => !a.archivedAt && (a.userId === Number(userId) || a.email.toLowerCase() === String(email).toLowerCase()))
      .map((a) => ({
        ...a,
        propertyName: s.properties.find((p) => p.id === a.propertyId)?.name || '',
        roomNumber: s.rooms.find((r) => r.id === a.assignedRoomId)?.roomNumber || null,
      }))
      .sort((a, b) => b.id - a.id);
  },

  async getCustomerLeaseAndPayments(userId, email) {
    const s = store();
    const tenants = s.tenants.filter((t) => !t.archivedAt && (t.userId === Number(userId) || t.email.toLowerCase() === String(email).toLowerCase()));
    const tIds = new Set(tenants.map((t) => t.id));
    return {
      tenants: tenants.map((t) => ({ ...t, propertyName: s.properties.find((p) => p.id === t.propertyId)?.name || '', roomNumber: s.rooms.find((r) => r.id === t.roomId)?.roomNumber || '—' })),
      leases: s.leases.filter((l) => tIds.has(l.tenantId)).map((l) => ({ ...l, propertyName: s.properties.find((p) => p.id === l.propertyId)?.name || '', roomNumber: s.rooms.find((r) => r.id === l.roomId)?.roomNumber || '—' })),
      payments: s.payments.filter((p) => !p.archivedAt && tIds.has(p.tenantId)).map(computePayment),
    };
  },

  async createMaintenanceRequest(userId, email, data) {
    const s = store();
    const t = s.tenants.find((x) => !x.archivedAt && x.status === 'Active' && (x.userId === Number(userId) || x.email.toLowerCase() === String(email).toLowerCase()));
    const propId = data.propertyId || t?.propertyId;
    const prop = s.properties.find((p) => p.id === Number(propId) && !p.archivedAt);
    if (!prop) return { error: 'no_property' };
    const reqRow = { id: nextId('maintenance'), ownerId: prop.ownerId, propertyId: prop.id, roomId: data.roomId || t?.roomId || null, tenantId: t?.id || null, userId: Number(userId), title: data.title, description: data.description, priority: data.priority || 'Medium', status: 'Open', ownerNotes: '', resolvedAt: null, createdAt: manilaNowIso() };
    s.maintenanceRequests.push(reqRow);
    return { request: reqRow };
  },

  async listCustomerMaintenance(userId) {
    const s = store();
    return s.maintenanceRequests.filter((m) => m.userId === Number(userId)).map((m) => ({ ...m, propertyName: s.properties.find((p) => p.id === m.propertyId)?.name || '', roomNumber: s.rooms.find((r) => r.id === m.roomId)?.roomNumber || '—' }));
  },

  async listOwnerMaintenance(ownerId) {
    const s = store();
    return s.maintenanceRequests
      .filter((m) => !ownerId || m.ownerId === ownerId)
      .map((m) => ({ ...m, propertyName: s.properties.find((p) => p.id === m.propertyId)?.name || '', roomNumber: s.rooms.find((r) => r.id === m.roomId)?.roomNumber || '—', tenantName: s.tenants.find((t) => t.id === m.tenantId)?.fullName || 'Resident' }));
  },

  async updateMaintenanceRequest(ownerId, id, { status, ownerNotes }) {
    const m = store().maintenanceRequests.find((x) => x.id === Number(id) && (!ownerId || x.ownerId === ownerId));
    if (!m) return null;
    m.status = status;
    m.ownerNotes = ownerNotes || '';
    m.resolvedAt = status === 'Done' ? manilaNowIso() : null;
    return m;
  },

  async listPublicAnnouncements(propertyId = null) {
    const s = store();
    return s.announcements
      .filter((a) => a.isPublished && (!propertyId || !a.propertyId || a.propertyId === Number(propertyId)))
      .map((a) => ({ ...a, propertyName: s.properties.find((p) => p.id === a.propertyId)?.name || 'All Properties' }));
  },

  async listOwnerAnnouncements(ownerId) {
    const s = store();
    return s.announcements.filter((a) => !ownerId || a.ownerId === ownerId).map((a) => ({ ...a, propertyName: s.properties.find((p) => p.id === a.propertyId)?.name || 'All Properties' }));
  },

  async createAnnouncement(ownerId, data) {
    const row = { id: nextId('announcement'), ownerId, propertyId: data.propertyId ? Number(data.propertyId) : null, title: data.title, body: data.body, isPublished: data.isPublished !== false, createdAt: manilaNowIso() };
    store().announcements.push(row);
    return row;
  },

  async deleteAnnouncement(ownerId, id) {
    const s = store();
    const before = s.announcements.length;
    s.announcements = s.announcements.filter((a) => !(a.id === Number(id) && (!ownerId || a.ownerId === ownerId)));
    return s.announcements.length < before;
  },

  async listNotifications(userId) {
    return store().notifications.filter((n) => n.userId === Number(userId)).sort((a, b) => Number(a.isRead) - Number(b.isRead) || b.id - a.id);
  },

  async markNotificationRead(userId, id) {
    const s = store();
    s.notifications.filter((n) => n.userId === Number(userId) && (id === 'all' || n.id === Number(id))).forEach((n) => (n.isRead = true));
    return { ok: true };
  },

  async exportCustomerData(userId) {
    const user = await this.findUserById(userId);
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;
    const [favorites, applications, leaseData, maintenance] = await Promise.all([
      this.listCustomerFavorites(userId),
      this.listCustomerApplications(userId, user.email),
      this.getCustomerLeaseAndPayments(userId, user.email),
      this.listCustomerMaintenance(userId),
    ]);
    const reviews = store().reviews.filter((r) => r.email.toLowerCase() === user.email.toLowerCase()).map(({ email, ...r }) => r);
    return { exportedAt: manilaNowIso(), profile: safeUser, favorites: favorites.map((f) => ({ id: f.id, name: f.name })), applications, ...leaseData, maintenance, reviews };
  },

  async logAudit({ userId = null, action, entityType, entityId = null, details = null, ipAddress = null }) {
    const s = store();
    const u = userId ? s.users.find((x) => x.id === Number(userId)) : null;
    s.auditLogs.unshift({ id: nextId('audit'), userId, actorName: u?.fullName || 'Public/System', actorRole: u?.role || 'system', action, entityType, entityId, details, ipAddress, createdAt: manilaNowIso() });
    if (s.auditLogs.length > 500) s.auditLogs.length = 500;
  },

  async listAuditLogs(ownerId, limit = 100) {
    const s = store();
    return s.auditLogs
      .filter((a) => {
        if (!ownerId || !a.userId) return true;
        const u = s.users.find((x) => x.id === a.userId);
        return !u || u.ownerId === ownerId || u.role === 'customer';
      })
      .slice(0, limit);
  },

  async getDashboardSummary(ownerId, range) {
    const [props, blds, rooms, tenants, pays, exps, revs, msgs, viewings, leases, maint] = await Promise.all([
      this.listOwnerProperties(ownerId), this.listBuildings(ownerId), this.listRooms(ownerId),
      this.listTenants(ownerId), this.listPayments(ownerId), this.listExpenses(ownerId),
      this.listReviews(ownerId), this.listMessages(), this.listViewingRequests(ownerId),
      this.listLeases(ownerId), this.listOwnerMaintenance(ownerId),
    ]);
    const inRange = (d) => !!d && d >= range.start && d <= range.end;
    const paysDue = pays.filter((p) => inRange(p.dueDate));
    const allTxs = pays.flatMap((p) => p.transactions.filter((t) => !t.voidedAt && inRange(t.paymentDate)));
    const expsInRange = exps.filter((e) => inRange(e.expenseDate));
    const collectedByDue = paysDue.reduce((s, p) => s + p.amountPaid, 0);
    const collectedByPayDate = allTxs.reduce((s, t) => s + t.amount, 0);
    const expensesTotal = expsInRange.reduce((s, e) => s + e.amount, 0);
    const activeTenants = tenants.filter((t) => t.status === 'Active');
    const roomCount = (st) => rooms.filter((r) => r.status === st).length;
    const months = [...new Set([...paysDue.map((p) => p.dueDate.slice(0, 7)), ...allTxs.map((t) => t.paymentDate.slice(0, 7)), ...expsInRange.map((e) => e.expenseDate.slice(0, 7))])].sort();
    const incomeByDueMonth = months.map((m) => paysDue.filter((p) => p.dueDate.startsWith(m)).reduce((s, p) => s + p.amountPaid, 0));
    const incomeByPaymentDate = months.map((m) => allTxs.filter((t) => t.paymentDate.startsWith(m)).reduce((s, t) => s + t.amount, 0));
    const expenseByMonth = months.map((m) => expsInRange.filter((e) => e.expenseDate.startsWith(m)).reduce((s, e) => s + e.amount, 0));
    const statuses = ['Paid', 'Partial', 'Pending', 'Overdue'];
    return {
      kpis: {
        totalProperties: props.length, totalBuildings: blds.length, totalRooms: rooms.length,
        availableRooms: roomCount('Available'), occupiedRooms: roomCount('Occupied'), reservedRooms: roomCount('Reserved'),
        totalTenants: activeTenants.length, monthlyExpectedIncome: activeTenants.reduce((s, t) => s + t.monthlyRent, 0),
        totalCollected: collectedByDue, collectedByPaymentDate: collectedByPayDate,
        pendingPayments: paysDue.filter((p) => ['Pending', 'Partial'].includes(p.status)).reduce((s, p) => s + p.remainingBalance, 0),
        overduePayments: paysDue.filter((p) => p.status === 'Overdue').reduce((s, p) => s + p.remainingBalance, 0),
        monthlyExpenses: expensesTotal, netIncome: collectedByDue - expensesTotal,
        pendingReviews: revs.filter((r) => r.status === 'Pending').length, unreadMessages: msgs.filter((m) => m.status === 'New').length,
        pendingViewings: viewings.filter((v) => v.status === 'Pending').length, openMaintenance: maint.filter((m) => m.status !== 'Done').length,
        expiringLeases: leases.filter((l) => l.expiringSoon).length,
      },
      charts: {
        months, incomeByMonth: incomeByDueMonth, incomeByDueMonth, incomeByPaymentDate, expenseByMonth,
        occupancy: { labels: ['Available', 'Occupied', 'Reserved', 'Maintenance'], values: ['Available', 'Occupied', 'Reserved', 'Maintenance'].map(roomCount) },
        paymentStatus: { labels: statuses, values: statuses.map((st) => paysDue.filter((p) => p.status === st).length) },
        propertyPerformance: { labels: props.map((p) => p.name), values: props.map((p) => paysDue.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amountPaid, 0)) },
      },
    };
  },

  async getFinancialReport(ownerId, range) {
    const [props, rooms, tenants, pays, exps, apps] = await Promise.all([
      this.listOwnerProperties(ownerId), this.listRooms(ownerId), this.listTenants(ownerId),
      this.listPayments(ownerId), this.listExpenses(ownerId), this.listApplications(ownerId),
    ]);
    const inRange = (d) => !!d && d >= range.start && d <= range.end;
    const paysDue = pays.filter((p) => inRange(p.dueDate));
    const txsInRange = pays.flatMap((p) => p.transactions.filter((t) => !t.voidedAt && inRange(t.paymentDate)).map((t) => ({ ...t, propertyId: p.propertyId })));
    const expsInRange = exps.filter((e) => inRange(e.expenseDate));
    const expectedIncome = paysDue.reduce((s, p) => s + p.amountDue, 0);
    const collectedByDue = paysDue.reduce((s, p) => s + p.amountPaid, 0);
    const collectedByPayDate = txsInRange.reduce((s, t) => s + t.amount, 0);
    const outstanding = paysDue.reduce((s, p) => s + p.remainingBalance, 0);
    const expensesTotal = expsInRange.reduce((s, e) => s + e.amount, 0);
    const occupied = rooms.filter((r) => r.status === 'Occupied').length;
    const today = manilaToday();
    const vacantRooms = rooms.filter((r) => r.status === 'Available' && r.lastVacatedAt);
    const avgVacancyDays = vacantRooms.length ? Math.round(vacantRooms.reduce((s, r) => s + Math.max(0, daysBetween(r.lastVacatedAt, today)), 0) / vacantRooms.length) : 0;
    const months = [...new Set([...paysDue.map((p) => p.billingMonth), ...txsInRange.map((t) => t.paymentDate.slice(0, 7))])].sort();
    return {
      range,
      summary: { expectedIncome, collected: collectedByDue, collectedByPaymentDate: collectedByPayDate, outstanding, expenses: expensesTotal, netIncome: collectedByDue - expensesTotal, netIncomeByPaymentDate: collectedByPayDate - expensesTotal },
      occupancy: { totalRooms: rooms.length, occupied, available: rooms.filter((r) => r.status === 'Available').length, reserved: rooms.filter((r) => r.status === 'Reserved').length, percent: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0 },
      byDueMonth: months.map((m) => ({ month: m, expected: paysDue.filter((p) => p.billingMonth === m).reduce((s, p) => s + p.amountDue, 0), collected: paysDue.filter((p) => p.billingMonth === m).reduce((s, p) => s + p.amountPaid, 0) })),
      byPaymentDate: months.map((m) => ({ month: m, collected: txsInRange.filter((t) => t.paymentDate.startsWith(m)).reduce((s, t) => s + t.amount, 0) })),
      byProperty: props.map((p) => ({ name: p.name, income: paysDue.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amountPaid, 0), incomeByPayDate: txsInRange.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amount, 0), expenses: expsInRange.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amount, 0) })),
      byCategory: [...new Set(expsInRange.map((e) => e.category))].map((c) => ({ category: c, amount: expsInRange.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0) })),
      byTenant: tenants.map((t) => ({ name: t.fullName, paid: paysDue.filter((p) => p.tenantId === t.id).reduce((s, p) => s + p.amountPaid, 0), balance: paysDue.filter((p) => p.tenantId === t.id).reduce((s, p) => s + p.remainingBalance, 0) })).filter((x) => x.paid || x.balance),
      analytics: {
        collectionRate: expectedIncome ? Math.round((collectedByDue / expectedIncome) * 1000) / 10 : 0,
        avgVacancyDays,
        occupancyTrend: months.map((m) => ({ month: m, occupiedBilled: paysDue.filter((p) => p.billingMonth === m).length, occupancyRate: rooms.length ? Math.min(100, Math.round((paysDue.filter((p) => p.billingMonth === m).length / rooms.length) * 100)) : 0 })),
        viewsVsApplications: props.map((p) => ({ propertyName: p.name, views: store().propertyViews.filter((v) => v.propertyId === p.id).length, applications: apps.filter((a) => a.propertyId === p.id).length })),
      },
    };
  },

  async runDailyCron() {
    const s = store();
    const today = manilaToday();
    const in3Days = addDays(today, 3);
    const in30Days = addDays(today, 30);
    const freedProperties = [];
    let expiredReservations = 0;

    for (const res of s.reservations) {
      if (res.status === 'Active' && res.expiresAt < today) {
        res.status = 'Expired';
        expiredReservations++;
        const app = s.applications.find((a) => a.id === res.applicationId);
        if (app) app.status = 'Cancelled';
        const calc = recalcRoom(res.roomId);
        if (calc && calc.availableBeds > 0 && app) {
          const prop = s.properties.find((p) => p.id === app.propertyId);
          if (prop) freedProperties.push({ propertyId: prop.id, propertyName: prop.name });
        }
      }
    }

    const upcomingReminders = [];
    const overdueReminders = [];
    for (const rawPay of s.payments.filter((p) => !p.archivedAt)) {
      const p = computePayment(rawPay);
      if (p.remainingBalance <= 0) continue;
      const t = s.tenants.find((x) => x.id === p.tenantId);
      if (!t?.email) continue;
      if (p.dueDate === in3Days && !rawPay.reminderSentAt) {
        rawPay.reminderSentAt = manilaNowIso();
        upcomingReminders.push({ to: t.email, fullName: t.fullName, billingMonth: p.billingMonth, dueDate: p.dueDate, remainingBalance: p.remainingBalance, isOverdue: false });
      } else if (p.dueDate < today && !rawPay.overdueNotifiedAt) {
        rawPay.overdueNotifiedAt = manilaNowIso();
        overdueReminders.push({ to: t.email, fullName: t.fullName, billingMonth: p.billingMonth, dueDate: p.dueDate, remainingBalance: p.remainingBalance, isOverdue: true });
      }
    }

    let leaseAlertsCreated = 0;
    for (const l of s.leases) {
      if (['Active', 'Expiring'].includes(l.status) && l.endDate >= today && l.endDate <= in30Days && !l.renewalNotifiedAt) {
        l.status = 'Expiring';
        l.renewalNotifiedAt = manilaNowIso();
        leaseAlertsCreated++;
        const own = s.owners.find((o) => o.id === l.ownerId);
        const t = s.tenants.find((x) => x.id === l.tenantId);
        const r = s.rooms.find((x) => x.id === l.roomId);
        if (own) s.notifications.push({ id: nextId('notification'), userId: own.userId, title: 'Lease expiring within 30 days', body: `${t?.fullName || 'Tenant'} (${r?.roomNumber || 'Unit'}) lease ends ${l.endDate}.`, link: 'tenants', isRead: false, createdAt: manilaNowIso() });
      }
    }

    return { expiredReservations, upcomingReminders, overdueReminders, leaseAlertsCreated, freedProperties };
  },
};
