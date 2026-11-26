/**
 * db-pg.js - Asynchronous PostgreSQL (Neon) data access layer.
 * Uses parameterized queries exclusively and explicit transactions for multi-table updates.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { manilaToday, manilaNowIso, addDays, addMonths, daysBetween } = require('./time');

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required.');
  }
  if (!globalThis.__cbPool) {
    const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
    globalThis.__cbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 10000,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }
  return globalThis.__cbPool;
}

async function ensureBootstrapped() {
  if (globalThis.__cbSchemaBootstrapped) return;
  if (!globalThis.__cbBootPromise) {
    globalThis.__cbBootPromise = (async () => {
      const pool = getPool();
      const chk = await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS ready`);
      if (chk.rows[0]?.ready) {
        globalThis.__cbSchemaBootstrapped = true;
        return;
      }
      const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
      const seedPath = path.join(__dirname, '..', 'database', 'seed.sql');
      if (!fs.existsSync(schemaPath)) return;

      const client = await pool.connect();
      try {
        await client.query(`SELECT pg_advisory_lock(948271)`);
        const rechk = await client.query(`SELECT to_regclass('public.users') IS NOT NULL AS ready`);
        if (!rechk.rows[0]?.ready) {
          const schemaSql = fs.readFileSync(schemaPath, 'utf8');
          await client.query(schemaSql);
          if (fs.existsSync(seedPath)) {
            const seedSql = fs.readFileSync(seedPath, 'utf8');
            await client.query(seedSql);
          }
          console.log('[db-pg] Initialized schema and seed data on virgin Postgres database.');
        }
        globalThis.__cbSchemaBootstrapped = true;
      } finally {
        await client.query(`SELECT pg_advisory_unlock(948271)`).catch(() => {});
        client.release();
      }
    })().catch((err) => {
      globalThis.__cbBootPromise = null;
      throw err;
    });
  }
  await globalThis.__cbBootPromise;
}

const q = async (text, params = []) => {
  await ensureBootstrapped();
  return getPool().query(text, params);
};

async function withTx(fn) {
  await ensureBootstrapped();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isoDateStr = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const isoTsStr = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

async function recalcRoomTx(client, roomId) {
  const roomRes = await client.query(
    `SELECT id, property_id, capacity, status FROM rooms WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
    [roomId]
  );
  if (!roomRes.rows.length) return null;
  const room = roomRes.rows[0];
  const occRes = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM tenants WHERE room_id = $1 AND status = 'Active' AND archived_at IS NULL`,
    [roomId]
  );
  const heldRes = await client.query(
    `SELECT COALESCE(SUM(r.beds_held), 0)::int AS held
     FROM reservations r
     JOIN rental_applications a ON a.id = r.application_id
     WHERE r.room_id = $1 AND r.status = 'Active' AND a.archived_at IS NULL AND a.status IN ('Approved', 'Reserved')`,
    [roomId]
  );
  const occupiedBeds = Math.min(room.capacity, occRes.rows[0].cnt);
  const heldBeds = heldRes.rows[0].held;
  const availableBeds = Math.max(0, room.capacity - occupiedBeds - heldBeds);

  let nextStatus = room.status;
  if (room.status !== 'Maintenance') {
    if (availableBeds === 0 && occupiedBeds > 0) nextStatus = 'Occupied';
    else if (heldBeds > 0 && availableBeds === 0) nextStatus = 'Reserved';
    else if (heldBeds > 0 && occupiedBeds === 0) nextStatus = 'Reserved';
    else nextStatus = 'Available';
  }

  await client.query(
    `UPDATE rooms SET occupied_beds = $1, status = $2 WHERE id = $3`,
    [occupiedBeds, nextStatus, roomId]
  );
  return { id: room.id, propertyId: room.property_id, capacity: room.capacity, occupiedBeds, heldBeds, availableBeds, status: nextStatus };
}

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    passwordHash: r.password_hash,
    role: r.role,
    ownerId: r.owner_id,
    phone: r.phone || '',
    isActive: r.is_active,
    failedLoginAttempts: r.failed_login_attempts || 0,
    lockedUntil: isoTsStr(r.locked_until),
    consentAcceptedAt: isoTsStr(r.consent_accepted_at),
    archivedAt: isoTsStr(r.archived_at),
    createdAt: isoTsStr(r.created_at),
  };
}

function mapRoom(r, images = []) {
  const occupiedBeds = Number(r.occupied_beds || 0);
  const heldBeds = Number(r.held_beds || 0);
  const capacity = Number(r.capacity || 1);
  const availableBeds = r.status === 'Maintenance' ? 0 : Math.max(0, capacity - occupiedBeds - heldBeds);
  return {
    id: r.id,
    propertyId: r.property_id,
    buildingId: r.building_id,
    buildingName: r.building_name || '',
    floorNumber: Number(r.floor_number || 1),
    roomNumber: r.room_number,
    roomType: r.room_type,
    capacity,
    occupiedBeds,
    heldBeds,
    availableBeds,
    monthlyPrice: num(r.monthly_price),
    status: r.status,
    description: r.description || '',
    lastVacatedAt: isoDateStr(r.last_vacated_at),
    images: images.length ? images : ['/images/placeholder.svg'],
  };
}

function computePaymentFields(p, txs) {
  const activeTxs = txs.filter((t) => !t.voidedAt);
  const amountDue = num(p.amount_due);
  const amountPaid = activeTxs.reduce((s, t) => s + num(t.amount), 0);
  const remainingBalance = Math.max(0, amountDue - amountPaid);
  const dueDate = isoDateStr(p.due_date);
  const lastTx = activeTxs[activeTxs.length - 1];
  let status = 'Pending';
  if (remainingBalance === 0) status = 'Paid';
  else if (amountPaid > 0) status = 'Partial';
  else if (dueDate < manilaToday()) status = 'Overdue';

  return {
    id: p.id,
    tenantId: p.tenant_id,
    ownerId: p.owner_id,
    propertyId: p.property_id,
    roomId: p.room_id,
    billingMonth: p.billing_month,
    dueDate,
    paymentDate: lastTx ? lastTx.paymentDate : null,
    amountDue,
    amountPaid,
    remainingBalance,
    paymentMethod: lastTx ? lastTx.paymentMethod : 'Cash',
    status,
    referenceNumber: lastTx ? lastTx.referenceNumber : `BILL-${p.billing_month.replace('-', '')}-${String(p.id).padStart(3, '0')}`,
    receiptNumber: lastTx ? lastTx.receiptNumber : `BILL-${String(p.id).padStart(4, '0')}`,
    notes: p.notes || '',
    transactions: txs,
  };
}

function mapTx(t) {
  return {
    id: t.id,
    paymentId: t.payment_id,
    amount: num(t.amount),
    paymentDate: isoDateStr(t.payment_date),
    paymentMethod: t.payment_method,
    referenceNumber: t.reference_number,
    receiptNumber: t.receipt_number,
    notes: t.notes || '',
    recordedBy: t.recorded_by,
    editReason: t.edit_reason || null,
    editedBy: t.edited_by || null,
    editedAt: isoTsStr(t.edited_at),
    voidedAt: isoTsStr(t.voided_at),
    voidReason: t.void_reason || null,
    voidedBy: t.voided_by || null,
    createdAt: isoTsStr(t.created_at),
  };
}

async function hydrateProperties(propRows) {
  if (!propRows.length) return [];
  const ids = propRows.map((p) => p.id);

  const [amenRes, imgRes, roomRes, revRes] = await Promise.all([
    q(
      `SELECT pa.property_id, a.name
       FROM property_amenities pa JOIN amenities a ON a.id = pa.amenity_id
       WHERE pa.property_id = ANY($1::int[]) ORDER BY a.name`,
      [ids]
    ),
    q(
      `SELECT property_id, image_url FROM property_images
       WHERE property_id = ANY($1::int[]) ORDER BY is_primary DESC, sort_order ASC, id ASC`,
      [ids]
    ),
    q(
      `SELECT r.*, b.name AS building_name,
        COALESCE((SELECT SUM(res.beds_held)::int FROM reservations res
          JOIN rental_applications ap ON ap.id = res.application_id
          WHERE res.room_id = r.id AND res.status = 'Active' AND ap.archived_at IS NULL AND ap.status IN ('Approved','Reserved')), 0) AS held_beds
       FROM rooms r JOIN buildings b ON b.id = r.building_id
       WHERE r.property_id = ANY($1::int[]) AND r.archived_at IS NULL`,
      [ids]
    ),
    q(
      `SELECT property_id, rating FROM reviews WHERE property_id = ANY($1::int[]) AND status = 'Approved'`,
      [ids]
    ),
  ]);

  const amenMap = new Map();
  amenRes.rows.forEach((r) => {
    if (!amenMap.has(r.property_id)) amenMap.set(r.property_id, []);
    amenMap.get(r.property_id).push(r.name);
  });

  const imgMap = new Map();
  imgRes.rows.forEach((r) => {
    if (!imgMap.has(r.property_id)) imgMap.set(r.property_id, []);
    imgMap.get(r.property_id).push(r.image_url);
  });

  const roomMap = new Map();
  roomRes.rows.forEach((r) => {
    const mapped = mapRoom(r);
    if (!roomMap.has(r.property_id)) roomMap.set(r.property_id, []);
    roomMap.get(r.property_id).push(mapped);
  });

  const revMap = new Map();
  revRes.rows.forEach((r) => {
    if (!revMap.has(r.property_id)) revMap.set(r.property_id, []);
    revMap.get(r.property_id).push(Number(r.rating));
  });

  return propRows.map((p) => {
    const rooms = roomMap.get(p.id) || [];
    const open = rooms.filter((r) => r.status === 'Available' && r.availableBeds > 0);
    const allPrices = rooms.map((r) => r.monthlyPrice).filter((x) => x > 0);
    const openPrices = open.map((r) => r.monthlyPrice).filter((x) => x > 0);
    const computedPrice = openPrices.length ? Math.min(...openPrices) : allPrices.length ? Math.min(...allPrices) : num(p.monthly_price);
    const ratings = revMap.get(p.id) || [];
    const reviewCount = ratings.length;
    const averageRating = reviewCount ? Math.round((ratings.reduce((a, b) => a + b, 0) / reviewCount) * 10) / 10 : 0;

    const typeMap = new Map();
    open.forEach((r) => {
      const cur = typeMap.get(r.roomType) || { roomType: r.roomType, roomsAvailable: 0, bedsFree: 0 };
      cur.roomsAvailable += 1;
      cur.bedsFree += r.availableBeds;
      typeMap.set(r.roomType, cur);
    });

    const imgs = imgMap.get(p.id) || [];
    return {
      id: p.id,
      ownerId: p.owner_id,
      name: p.name,
      propertyType: p.property_type,
      address: p.address,
      city: p.city,
      latitude: num(p.latitude),
      longitude: num(p.longitude),
      description: p.description || '',
      monthlyPrice: computedPrice,
      amenities: amenMap.get(p.id) || [],
      houseRules: (p.house_rules || '').split('\n').map((s) => s.trim()).filter(Boolean),
      images: imgs.length ? imgs : ['/images/placeholder.svg'],
      isPublished: p.is_published,
      contactPhone: p.contact_phone || '',
      contactEmail: p.contact_email || '',
      locationAccess: p.location_access || '',
      nearbyPlaces: p.nearby_places || '',
      landmarks: p.landmarks || '',
      walkingMinutesBsu: p.walking_minutes_bsu,
      tricycleMinutesBsu: p.tricycle_minutes_bsu,
      minLeaseMonths: p.min_lease_months || 6,
      depositPolicy: p.deposit_policy || '',
      utilitiesPolicy: p.utilities_policy || '',
      inclusions: p.inclusions || '',
      curfewPolicy: p.curfew_policy || '',
      totalRoomsCount: rooms.length,
      availableRoomsCount: open.length,
      availableBedsCount: open.reduce((s, r) => s + r.availableBeds, 0),
      availableRoomTypes: [...typeMap.values()],
      averageRating,
      reviewCount,
      createdAt: isoTsStr(p.created_at),
    };
  });
}

async function syncPropertyDetailsTx(client, propertyId, amenities = [], images = []) {
  await client.query(`DELETE FROM property_amenities WHERE property_id = $1`, [propertyId]);
  for (const name of amenities) {
    const clean = String(name).trim();
    if (!clean) continue;
    const am = await client.query(
      `INSERT INTO amenities (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [clean]
    );
    await client.query(
      `INSERT INTO property_amenities (property_id, amenity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [propertyId, am.rows[0].id]
    );
  }
  await client.query(`DELETE FROM property_images WHERE property_id = $1`, [propertyId]);
  const cleanImages = images.map((s) => String(s).trim()).filter(Boolean);
  const finalImages = cleanImages.length ? cleanImages : ['/images/placeholder.svg'];
  for (let i = 0; i < finalImages.length; i++) {
    await client.query(
      `INSERT INTO property_images (property_id, image_url, is_primary, sort_order) VALUES ($1, $2, $3, $4)`,
      [propertyId, finalImages[i], i === 0, i + 1]
    );
  }
}

async function syncRoomImagesTx(client, roomId, images = []) {
  await client.query(`DELETE FROM room_images WHERE room_id = $1`, [roomId]);
  const cleanImages = images.map((s) => String(s).trim()).filter(Boolean);
  const finalImages = cleanImages.length ? cleanImages : ['/images/placeholder.svg'];
  for (let i = 0; i < finalImages.length; i++) {
    await client.query(
      `INSERT INTO room_images (room_id, image_url, is_primary, sort_order) VALUES ($1, $2, $3, $4)`,
      [roomId, finalImages[i], i === 0, i + 1]
    );
  }
}

module.exports = {
  isPostgres: () => true,

  async healthCheck() {
    await q('SELECT 1');
    const tblRes = await q(
      `SELECT to_regclass('public.users') IS NOT NULL AS has_users,
              to_regclass('public.properties') IS NOT NULL AS has_properties,
              to_regclass('public.site_settings') IS NOT NULL AS has_settings`
    );
    const { has_users, has_properties, has_settings } = tblRes.rows[0] || {};
    const schemaReady = Boolean(has_users && has_properties && has_settings);
    let userCount = 0;
    let propertyCount = 0;
    if (schemaReady) {
      const [uRes, pRes] = await Promise.all([
        q(`SELECT COUNT(*)::int AS cnt FROM users WHERE archived_at IS NULL`),
        q(`SELECT COUNT(*)::int AS cnt FROM properties WHERE archived_at IS NULL`),
      ]);
      userCount = uRes.rows[0]?.cnt ?? 0;
      propertyCount = pRes.rows[0]?.cnt ?? 0;
    }
    return {
      ok: true,
      db: 'postgres',
      schemaReady,
      seeded: userCount > 0 && propertyCount > 0,
      userCount,
      propertyCount,
    };
  },

  async findUserByEmail(email) {
    const res = await q(`SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND archived_at IS NULL LIMIT 1`, [email]);
    return mapUser(res.rows[0]);
  },

  async findUserById(id) {
    const res = await q(`SELECT * FROM users WHERE id = $1 AND archived_at IS NULL LIMIT 1`, [id]);
    return mapUser(res.rows[0]);
  },

  async getOwnerIdForUser(user) {
    if (!user) return null;
    if (user.role === 'admin') return null;
    if (user.role === 'staff') return user.ownerId || 1;
    if (user.role === 'owner') {
      const res = await q(`SELECT id FROM owners WHERE user_id = $1 LIMIT 1`, [user.id]);
      return res.rows[0]?.id || user.ownerId || null;
    }
    return null;
  },

  async recordFailedLogin(userId) {
    const res = await q(
      `UPDATE users
       SET failed_login_attempts = failed_login_attempts + 1,
           locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING failed_login_attempts, locked_until`,
      [userId]
    );
    return res.rows[0];
  },

  async clearFailedLogins(userId) {
    await q(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`, [userId]);
  },

  async createUser({ fullName, email, passwordHash, role, phone, ownerId = null, businessName = '', consentAccepted = true }) {
    return withTx(async (client) => {
      const res = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, owner_id, phone, consent_accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [fullName, email.toLowerCase(), passwordHash, role, ownerId, phone || '', consentAccepted ? new Date() : null]
      );
      const user = res.rows[0];
      if (role === 'owner') {
        const own = await client.query(
          `INSERT INTO owners (user_id, business_name) VALUES ($1, $2) RETURNING id`,
          [user.id, businessName || `${fullName} Properties`]
        );
        await client.query(`UPDATE users SET owner_id = $1 WHERE id = $2`, [own.rows[0].id, user.id]);
        user.owner_id = own.rows[0].id;
      }
      return mapUser(user);
    });
  },

  async updateUserProfile(userId, { fullName, phone }) {
    const res = await q(
      `UPDATE users SET full_name = $1, phone = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [fullName, phone || '', userId]
    );
    return mapUser(res.rows[0]);
  },

  async updateUserPassword(userId, passwordHash) {
    await q(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, userId]);
  },

  async softDeleteUserAccount(userId) {
    return withTx(async (client) => {
      const anonEmail = `deleted-user-${userId}-${Date.now()}@redacted.local`;
      await client.query(
        `UPDATE users SET full_name = 'Deleted User', email = $1, phone = '', is_active = FALSE, archived_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [anonEmail, userId]
      );
      await client.query(`DELETE FROM favorites WHERE user_id = $1`, [userId]);
      await client.query(`UPDATE rental_applications SET full_name = 'Deleted User', email = $1, contact_number = '', archived_at = NOW() WHERE user_id = $2`, [anonEmail, userId]);
      return { ok: true };
    });
  },

  async listUsers() {
    const res = await q(`SELECT * FROM users WHERE archived_at IS NULL ORDER BY id ASC`);
    return res.rows.map(mapUser);
  },

  async createPasswordReset(userId, tokenHash, expiresAt) {
    await q(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [userId, tokenHash, expiresAt]);
  },

  async consumePasswordReset(tokenHash, newPasswordHash) {
    return withTx(async (client) => {
      const res = await client.query(
        `SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
        [tokenHash]
      );
      if (!res.rows.length) return null;
      const row = res.rows[0];
      await client.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [row.id]);
      await client.query(`UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $2`, [newPasswordHash, row.user_id]);
      return row.user_id;
    });
  },

  async getSettings() {
    const res = await q(`SELECT key, value FROM site_settings`);
    const obj = {
      business_name: 'CasaBatangueño',
      tagline: 'Verified apartments, dormitories, and private rooms in Alangilan, Batangas City',
      contact_phone: '+63 917 555 0101',
      contact_email: 'owner@casa-bat.com',
      office_address: 'Neptune St. (near Alfamart), Golden Country Homes, Brgy. Alangilan, Batangas City',
      office_hours: 'Monday – Saturday, 8:00 AM – 6:00 PM (Sundays by appointment)',
    };
    res.rows.forEach((r) => { obj[r.key] = r.value; });
    return obj;
  },

  async updateSettings(data) {
    return withTx(async (client) => {
      for (const [k, v] of Object.entries(data)) {
        await client.query(
          `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [k, String(v ?? '')]
        );
      }
      return this.getSettings();
    });
  },

  async listPublicProperties(filters = {}) {
    const res = await q(`SELECT * FROM properties WHERE is_published = TRUE AND archived_at IS NULL ORDER BY id ASC`);
    let list = await hydrateProperties(res.rows);
    const needle = String(filters.q || '').trim().toLowerCase();
    if (needle) list = list.filter((p) => [p.name, p.city, p.address, p.landmarks].join(' ').toLowerCase().includes(needle));
    if (filters.type) list = list.filter((p) => p.propertyType === filters.type);
    if (filters.minPrice) list = list.filter((p) => p.monthlyPrice >= num(filters.minPrice));
    if (filters.maxPrice) list = list.filter((p) => p.monthlyPrice <= num(filters.maxPrice));
    if (filters.amenity) list = list.filter((p) => p.amenities.includes(filters.amenity));
    if (filters.onlyAvailable === 'true') list = list.filter((p) => p.availableBedsCount > 0);
    if (filters.occupants) {
      const occ = num(filters.occupants);
      const rRes = await q(
        `SELECT r.property_id, r.capacity, r.occupied_beds, r.status,
          COALESCE((SELECT SUM(res.beds_held)::int FROM reservations res JOIN rental_applications ap ON ap.id = res.application_id
            WHERE res.room_id = r.id AND res.status = 'Active' AND ap.archived_at IS NULL AND ap.status IN ('Approved','Reserved')), 0) AS held_beds
         FROM rooms r WHERE r.archived_at IS NULL AND r.status != 'Maintenance'`
      );
      const okPropIds = new Set(
        rRes.rows
          .filter((r) => Math.max(0, r.capacity - r.occupied_beds - r.held_beds) >= occ)
          .map((r) => r.property_id)
      );
      list = list.filter((p) => okPropIds.has(p.id));
    }
    return list;
  },

  async getPublicPropertyById(id) {
    const res = await q(`SELECT * FROM properties WHERE id = $1 AND is_published = TRUE AND archived_at IS NULL`, [id]);
    if (!res.rows.length) return null;
    const [prop] = await hydrateProperties(res.rows);
    const [bRes, rRes, riRes] = await Promise.all([
      q(`SELECT * FROM buildings WHERE property_id = $1 ORDER BY id`, [id]),
      q(
        `SELECT r.*, b.name AS building_name,
          COALESCE((SELECT SUM(res.beds_held)::int FROM reservations res JOIN rental_applications ap ON ap.id = res.application_id
            WHERE res.room_id = r.id AND res.status = 'Active' AND ap.archived_at IS NULL AND ap.status IN ('Approved','Reserved')), 0) AS held_beds
         FROM rooms r JOIN buildings b ON b.id = r.building_id
         WHERE r.property_id = $1 AND r.archived_at IS NULL ORDER BY r.floor_number, r.room_number`,
        [id]
      ),
      q(
        `SELECT ri.room_id, ri.image_url FROM room_images ri
         JOIN rooms r ON r.id = ri.room_id WHERE r.property_id = $1 ORDER BY ri.is_primary DESC, ri.sort_order ASC`,
        [id]
      ),
    ]);
    const riMap = new Map();
    riRes.rows.forEach((x) => {
      if (!riMap.has(x.room_id)) riMap.set(x.room_id, []);
      riMap.get(x.room_id).push(x.image_url);
    });
    return {
      ...prop,
      buildings: bRes.rows.map((b) => ({ id: b.id, propertyId: b.property_id, name: b.name, floors: b.floors, description: b.description })),
      rooms: rRes.rows.map((r) => mapRoom(r, riMap.get(r.id) || [])),
    };
  },

  async recordPropertyView(propertyId) {
    await q(`INSERT INTO property_views (property_id) VALUES ($1)`, [propertyId]);
  },

  async listOwnerProperties(ownerId) {
    const res = ownerId
      ? await q(`SELECT * FROM properties WHERE owner_id = $1 AND archived_at IS NULL ORDER BY id ASC`, [ownerId])
      : await q(`SELECT * FROM properties WHERE archived_at IS NULL ORDER BY id ASC`);
    return hydrateProperties(res.rows);
  },

  async createProperty(ownerId, data) {
    return withTx(async (client) => {
      const res = await client.query(
        `INSERT INTO properties (
           owner_id, name, property_type, address, city, latitude, longitude, description,
           monthly_price, house_rules, is_published, contact_phone, contact_email,
           location_access, nearby_places, landmarks, walking_minutes_bsu, tricycle_minutes_bsu,
           min_lease_months, deposit_policy, utilities_policy, inclusions, curfew_policy
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [
          ownerId, data.name, data.propertyType, data.address, data.city, data.latitude, data.longitude,
          data.description, data.monthlyPrice, (data.houseRules || []).join('\n'), data.isPublished !== false,
          data.contactPhone, data.contactEmail, data.locationAccess, data.nearbyPlaces, data.landmarks,
          data.walkingMinutesBsu ?? null, data.tricycleMinutesBsu ?? null, data.minLeaseMonths || 6,
          data.depositPolicy, data.utilitiesPolicy, data.inclusions, data.curfewPolicy,
        ]
      );
      const prop = res.rows[0];
      await syncPropertyDetailsTx(client, prop.id, data.amenities, data.images);
      const [hydrated] = await hydrateProperties([prop]);
      return hydrated;
    });
  },

  async updateProperty(ownerId, id, data) {
    return withTx(async (client) => {
      const check = ownerId
        ? await client.query(`SELECT id FROM properties WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [id, ownerId])
        : await client.query(`SELECT id FROM properties WHERE id = $1 AND archived_at IS NULL`, [id]);
      if (!check.rows.length) return null;
      const res = await client.query(
        `UPDATE properties SET
           name=$1, property_type=$2, address=$3, city=$4, latitude=$5, longitude=$6, description=$7,
           monthly_price=$8, house_rules=$9, is_published=COALESCE($10, is_published), contact_phone=$11,
           contact_email=$12, location_access=$13, nearby_places=$14, landmarks=$15,
           walking_minutes_bsu=$16, tricycle_minutes_bsu=$17, min_lease_months=$18,
           deposit_policy=$19, utilities_policy=$20, inclusions=$21, curfew_policy=$22, updated_at=NOW()
         WHERE id=$23 RETURNING *`,
        [
          data.name, data.propertyType, data.address, data.city, data.latitude, data.longitude, data.description,
          data.monthlyPrice, (data.houseRules || []).join('\n'), data.isPublished,
          data.contactPhone, data.contactEmail, data.locationAccess, data.nearbyPlaces, data.landmarks,
          data.walkingMinutesBsu ?? null, data.tricycleMinutesBsu ?? null, data.minLeaseMonths || 6,
          data.depositPolicy, data.utilitiesPolicy, data.inclusions, data.curfewPolicy, id,
        ]
      );
      await syncPropertyDetailsTx(client, id, data.amenities, data.images);
      const [hydrated] = await hydrateProperties([res.rows[0]]);
      return hydrated;
    });
  },

  async togglePublishProperty(ownerId, id) {
    const res = ownerId
      ? await q(`UPDATE properties SET is_published = NOT is_published, updated_at = NOW() WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL RETURNING *`, [id, ownerId])
      : await q(`UPDATE properties SET is_published = NOT is_published, updated_at = NOW() WHERE id = $1 AND archived_at IS NULL RETURNING *`, [id]);
    if (!res.rows.length) return null;
    const [hydrated] = await hydrateProperties([res.rows[0]]);
    return hydrated;
  },

  async archiveProperty(ownerId, id) {
    return withTx(async (client) => {
      const check = ownerId
        ? await client.query(`SELECT id FROM properties WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [id, ownerId])
        : await client.query(`SELECT id FROM properties WHERE id = $1 AND archived_at IS NULL`, [id]);
      if (!check.rows.length) return { error: 'not_found' };
      const act = await client.query(`SELECT COUNT(*)::int AS cnt FROM tenants WHERE property_id = $1 AND status = 'Active' AND archived_at IS NULL`, [id]);
      if (act.rows[0].cnt > 0) return { error: 'active_tenants' };
      await client.query(`UPDATE properties SET archived_at = NOW(), is_published = FALSE WHERE id = $1`, [id]);
      await client.query(`UPDATE rooms SET archived_at = NOW() WHERE property_id = $1`, [id]);
      return { ok: true };
    });
  },

  async listBuildings(ownerId) {
    const res = ownerId
      ? await q(`SELECT b.* FROM buildings b JOIN properties p ON p.id = b.property_id WHERE p.owner_id = $1 AND p.archived_at IS NULL ORDER BY b.id`, [ownerId])
      : await q(`SELECT b.* FROM buildings b JOIN properties p ON p.id = b.property_id WHERE p.archived_at IS NULL ORDER BY b.id`);
    return res.rows.map((b) => ({ id: b.id, propertyId: b.property_id, name: b.name, floors: b.floors, description: b.description, createdAt: isoTsStr(b.created_at) }));
  },

  async createBuilding(ownerId, data) {
    const check = ownerId
      ? await q(`SELECT id FROM properties WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [data.propertyId, ownerId])
      : await q(`SELECT id FROM properties WHERE id = $1 AND archived_at IS NULL`, [data.propertyId]);
    if (!check.rows.length) return null;
    const res = await q(
      `INSERT INTO buildings (property_id, name, floors, description) VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.propertyId, data.name, data.floors, data.description]
    );
    const b = res.rows[0];
    return { id: b.id, propertyId: b.property_id, name: b.name, floors: b.floors, description: b.description, createdAt: isoTsStr(b.created_at) };
  },

  async updateBuilding(ownerId, id, data) {
    const res = ownerId
      ? await q(
          `UPDATE buildings b SET name = $1, floors = $2, description = $3
           FROM properties p WHERE b.id = $4 AND b.property_id = p.id AND p.owner_id = $5 AND p.archived_at IS NULL
           RETURNING b.*`,
          [data.name, data.floors, data.description, id, ownerId]
        )
      : await q(`UPDATE buildings SET name = $1, floors = $2, description = $3 WHERE id = $4 RETURNING *`, [data.name, data.floors, data.description, id]);
    if (!res.rows.length) return null;
    const b = res.rows[0];
    return { id: b.id, propertyId: b.property_id, name: b.name, floors: b.floors, description: b.description, createdAt: isoTsStr(b.created_at) };
  },

  async deleteBuilding(ownerId, id) {
    const check = ownerId
      ? await q(`SELECT b.id FROM buildings b JOIN properties p ON p.id = b.property_id WHERE b.id = $1 AND p.owner_id = $2`, [id, ownerId])
      : await q(`SELECT id FROM buildings WHERE id = $1`, [id]);
    if (!check.rows.length) return { error: 'not_found' };
    const r = await q(`SELECT COUNT(*)::int AS cnt FROM rooms WHERE building_id = $1 AND archived_at IS NULL`, [id]);
    if (r.rows[0].cnt > 0) return { error: 'has_rooms' };
    await q(`DELETE FROM buildings WHERE id = $1`, [id]);
    return { ok: true };
  },

  async listRooms(ownerId) {
    const sql = `
      SELECT r.*, b.name AS building_name,
        COALESCE((SELECT SUM(res.beds_held)::int FROM reservations res JOIN rental_applications ap ON ap.id = res.application_id
          WHERE res.room_id = r.id AND res.status = 'Active' AND ap.archived_at IS NULL AND ap.status IN ('Approved','Reserved')), 0) AS held_beds
      FROM rooms r
      JOIN buildings b ON b.id = r.building_id
      JOIN properties p ON p.id = r.property_id
      WHERE r.archived_at IS NULL AND p.archived_at IS NULL ${ownerId ? 'AND p.owner_id = $1' : ''}
      ORDER BY r.property_id, r.floor_number, r.room_number`;
    const rRes = ownerId ? await q(sql, [ownerId]) : await q(sql);
    const ids = rRes.rows.map((r) => r.id);
    const riMap = new Map();
    if (ids.length) {
      const ri = await q(`SELECT room_id, image_url FROM room_images WHERE room_id = ANY($1::int[]) ORDER BY is_primary DESC, sort_order ASC`, [ids]);
      ri.rows.forEach((x) => {
        if (!riMap.has(x.room_id)) riMap.set(x.room_id, []);
        riMap.get(x.room_id).push(x.image_url);
      });
    }
    return rRes.rows.map((r) => mapRoom(r, riMap.get(r.id) || []));
  },

  async createRoom(ownerId, data) {
    return withTx(async (client) => {
      const bRes = ownerId
        ? await client.query(`SELECT b.id, b.property_id, b.name FROM buildings b JOIN properties p ON p.id = b.property_id WHERE b.id = $1 AND p.owner_id = $2 AND p.archived_at IS NULL`, [data.buildingId, ownerId])
        : await client.query(`SELECT b.id, b.property_id, b.name FROM buildings b JOIN properties p ON p.id = b.property_id WHERE b.id = $1 AND p.archived_at IS NULL`, [data.buildingId]);
      if (!bRes.rows.length) return { error: 'building_not_found' };
      const b = bRes.rows[0];
      const dup = await client.query(`SELECT id FROM rooms WHERE building_id = $1 AND room_number = $2 AND archived_at IS NULL`, [b.id, data.roomNumber]);
      if (dup.rows.length) return { error: 'duplicate' };
      const ins = await client.query(
        `INSERT INTO rooms (property_id, building_id, floor_number, room_number, room_type, capacity, occupied_beds, monthly_price, status, description)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9) RETURNING *`,
        [b.property_id, b.id, data.floorNumber, data.roomNumber, data.roomType, data.capacity, data.monthlyPrice, data.status, data.description]
      );
      await syncRoomImagesTx(client, ins.rows[0].id, data.images);
      const calc = await recalcRoomTx(client, ins.rows[0].id);
      return { room: mapRoom({ ...ins.rows[0], building_name: b.name, held_beds: calc.heldBeds, status: calc.status }, data.images) };
    });
  },

  async updateRoom(ownerId, id, data) {
    return withTx(async (client) => {
      const curRes = ownerId
        ? await client.query(`SELECT r.*, p.name AS property_name FROM rooms r JOIN properties p ON p.id = r.property_id WHERE r.id = $1 AND p.owner_id = $2 AND r.archived_at IS NULL FOR UPDATE`, [id, ownerId])
        : await client.query(`SELECT r.*, p.name AS property_name FROM rooms r JOIN properties p ON p.id = r.property_id WHERE r.id = $1 AND r.archived_at IS NULL FOR UPDATE`, [id]);
      if (!curRes.rows.length) return { error: 'not_found' };
      const cur = curRes.rows[0];
      const wasOccupiedOrMaint = cur.status === 'Maintenance' || cur.occupied_beds >= cur.capacity;
      if (data.capacity < cur.occupied_beds) return { error: 'capacity_low' };
      const bRes = await client.query(`SELECT id, property_id, name FROM buildings WHERE id = $1`, [data.buildingId]);
      if (!bRes.rows.length) return { error: 'building_not_found' };
      const b = bRes.rows[0];
      const upd = await client.query(
        `UPDATE rooms SET property_id=$1, building_id=$2, floor_number=$3, room_number=$4, room_type=$5, capacity=$6, monthly_price=$7, status=$8, description=$9
         WHERE id=$10 RETURNING *`,
        [b.property_id, b.id, data.floorNumber, data.roomNumber, data.roomType, data.capacity, data.monthlyPrice, data.status, data.description, id]
      );
      if (data.images && data.images.length) await syncRoomImagesTx(client, id, data.images);
      const calc = await recalcRoomTx(client, id);
      const opened = wasOccupiedOrMaint && calc.availableBeds > 0 && calc.status === 'Available';
      return { room: mapRoom({ ...upd.rows[0], building_name: b.name, held_beds: calc.heldBeds, status: calc.status }), bedOpened: opened, propertyId: b.property_id, propertyName: cur.property_name };
    });
  },

  async archiveRoom(ownerId, id) {
    return withTx(async (client) => {
      const check = ownerId
        ? await client.query(`SELECT r.id FROM rooms r JOIN properties p ON p.id = r.property_id WHERE r.id = $1 AND p.owner_id = $2 AND r.archived_at IS NULL`, [id, ownerId])
        : await client.query(`SELECT id FROM rooms WHERE id = $1 AND archived_at IS NULL`, [id]);
      if (!check.rows.length) return { error: 'not_found' };
      const act = await client.query(`SELECT COUNT(*)::int AS cnt FROM tenants WHERE room_id = $1 AND status = 'Active' AND archived_at IS NULL`, [id]);
      if (act.rows[0].cnt > 0) return { error: 'active_tenants' };
      await client.query(`UPDATE rooms SET archived_at = NOW() WHERE id = $1`, [id]);
      return { ok: true };
    });
  },

  async listTenants(ownerId) {
    const sql = `
      SELECT t.*, l.end_date AS lease_end_date, l.status AS lease_status
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT end_date, status FROM leases WHERE tenant_id = t.id ORDER BY id DESC LIMIT 1
      ) l ON TRUE
      WHERE t.archived_at IS NULL ${ownerId ? 'AND t.owner_id = $1' : ''}
      ORDER BY t.id DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((t) => ({
      id: t.id,
      userId: t.user_id,
      ownerId: t.owner_id,
      fullName: t.full_name,
      email: t.email,
      contactNumber: t.contact_number,
      address: t.address,
      emergencyContact: t.emergency_contact,
      propertyId: t.property_id,
      roomId: t.room_id,
      moveInDate: isoDateStr(t.move_in_date),
      moveOutDate: isoDateStr(t.move_out_date),
      leaseEndDate: isoDateStr(t.lease_end_date),
      leaseStatus: t.lease_status || null,
      monthlyRent: num(t.monthly_rent),
      securityDeposit: num(t.security_deposit),
      status: t.status,
      moveInChecklist: t.move_in_checklist,
      moveOutChecklist: t.move_out_checklist,
      depositDeductions: num(t.deposit_deductions),
      depositRefunded: num(t.deposit_refunded),
      depositRefundedAt: isoDateStr(t.deposit_refunded_at),
      createdAt: isoTsStr(t.created_at),
    }));
  },

  async getTenantById(ownerId, id) {
    const res = ownerId
      ? await q(`SELECT * FROM tenants WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [id, ownerId])
      : await q(`SELECT * FROM tenants WHERE id = $1 AND archived_at IS NULL`, [id]);
    if (!res.rows.length) return null;
    const t = res.rows[0];
    return {
      id: t.id, ownerId: t.owner_id, fullName: t.full_name, email: t.email, contactNumber: t.contact_number,
      address: t.address, emergencyContact: t.emergency_contact, propertyId: t.property_id, roomId: t.room_id,
      moveInDate: isoDateStr(t.move_in_date), moveOutDate: isoDateStr(t.move_out_date),
      monthlyRent: num(t.monthly_rent), securityDeposit: num(t.security_deposit), status: t.status,
    };
  },

  async createTenant(ownerId, data) {
    return withTx(async (client) => {
      const rRes = ownerId
        ? await client.query(`SELECT r.*, p.owner_id FROM rooms r JOIN properties p ON p.id = r.property_id WHERE r.id = $1 AND p.owner_id = $2 AND r.archived_at IS NULL FOR UPDATE`, [data.roomId, ownerId])
        : await client.query(`SELECT r.*, p.owner_id FROM rooms r JOIN properties p ON p.id = r.property_id WHERE r.id = $1 AND r.archived_at IS NULL FOR UPDATE`, [data.roomId]);
      if (!rRes.rows.length) return { error: 'room_not_found' };
      const room = rRes.rows[0];
      if (data.status === 'Active') {
        const calc = await recalcRoomTx(client, room.id);
        if (room.status === 'Maintenance') return { error: 'maintenance' };
        if (calc.availableBeds < 1) return { error: 'room_full' };
      }
      const moveIn = data.moveInDate || manilaToday();
      const leaseEnd = data.leaseEndDate || addMonths(moveIn, 6);
      const rent = data.monthlyRent || num(room.monthly_price);
      const uRes = data.email ? await client.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'customer' AND archived_at IS NULL LIMIT 1`, [data.email]) : { rows: [] };
      const ins = await client.query(
        `INSERT INTO tenants (user_id, owner_id, full_name, email, contact_number, address, emergency_contact, property_id, room_id, move_in_date, monthly_rent, security_deposit, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [uRes.rows[0]?.id || null, room.owner_id, data.fullName, data.email, data.contactNumber, data.address, data.emergencyContact, room.property_id, room.id, moveIn, rent, data.securityDeposit || 0, data.status]
      );
      const t = ins.rows[0];
      await client.query(
        `INSERT INTO leases (tenant_id, owner_id, property_id, room_id, start_date, end_date, monthly_rate, deposit_amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Active')`,
        [t.id, room.owner_id, room.property_id, room.id, moveIn, leaseEnd, rent, data.securityDeposit || 0]
      );
      await recalcRoomTx(client, room.id);
      return { tenant: { ...t, moveInDate: isoDateStr(t.move_in_date), monthlyRent: num(t.monthly_rent), securityDeposit: num(t.security_deposit) } };
    });
  },

  async updateTenant(ownerId, id, data) {
    return withTx(async (client) => {
      const curRes = ownerId
        ? await client.query(`SELECT * FROM tenants WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL FOR UPDATE`, [id, ownerId])
        : await client.query(`SELECT * FROM tenants WHERE id = $1 AND archived_at IS NULL FOR UPDATE`, [id]);
      if (!curRes.rows.length) return { error: 'not_found' };
      const cur = curRes.rows[0];
      const nextRoomId = data.roomId || cur.room_id;
      if (data.status === 'Active' && nextRoomId) {
        const rRes = await client.query(`SELECT * FROM rooms WHERE id = $1 AND archived_at IS NULL FOR UPDATE`, [nextRoomId]);
        if (!rRes.rows.length) return { error: 'room_not_found' };
        if (rRes.rows[0].status === 'Maintenance') return { error: 'maintenance' };
        if (nextRoomId !== cur.room_id || cur.status !== 'Active') {
          const calc = await recalcRoomTx(client, nextRoomId);
          if (calc.availableBeds < 1) return { error: 'room_full' };
        }
      }
      const upd = await client.query(
        `UPDATE tenants SET full_name=$1, email=$2, contact_number=$3, address=$4, emergency_contact=$5, room_id=$6, move_in_date=$7, move_out_date=$8, monthly_rent=$9, security_deposit=$10, status=$11
         WHERE id=$12 RETURNING *`,
        [data.fullName, data.email, data.contactNumber, data.address, data.emergencyContact, nextRoomId, data.moveInDate || cur.move_in_date, data.moveOutDate || null, data.monthlyRent ?? cur.monthly_rent, data.securityDeposit ?? cur.security_deposit, data.status, id]
      );
      if (cur.room_id) await recalcRoomTx(client, cur.room_id);
      if (nextRoomId && nextRoomId !== cur.room_id) await recalcRoomTx(client, nextRoomId);
      return { tenant: upd.rows[0] };
    });
  },

  async moveOutTenant(ownerId, id) {
    return withTx(async (client) => {
      const curRes = ownerId
        ? await client.query(`SELECT * FROM tenants WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL FOR UPDATE`, [id, ownerId])
        : await client.query(`SELECT * FROM tenants WHERE id = $1 AND archived_at IS NULL FOR UPDATE`, [id]);
      if (!curRes.rows.length) return null;
      const t = curRes.rows[0];
      const todayStr = manilaToday();
      await client.query(`UPDATE tenants SET status = 'Former Tenant', move_out_date = $1 WHERE id = $2`, [todayStr, id]);
      await client.query(`UPDATE leases SET status = 'Completed' WHERE tenant_id = $1 AND status IN ('Active','Expiring')`, [id]);
      let bedOpened = false;
      let propertyName = '';
      let roomNumber = '';
      if (t.room_id) {
        await client.query(`UPDATE rooms SET last_vacated_at = $1 WHERE id = $2`, [todayStr, t.room_id]);
        const calc = await recalcRoomTx(client, t.room_id);
        bedOpened = calc && calc.availableBeds > 0;
        const pInfo = await client.query(`SELECT p.name AS pname, r.room_number FROM rooms r JOIN properties p ON p.id = r.property_id WHERE r.id = $1`, [t.room_id]);
        propertyName = pInfo.rows[0]?.pname || '';
        roomNumber = pInfo.rows[0]?.room_number || '';
      }
      return { tenantId: id, propertyId: t.property_id, propertyName, roomNumber, bedOpened };
    });
  },

  async saveTenantChecklist(ownerId, id, data) {
    const col = data.type === 'move_in' ? 'move_in_checklist' : 'move_out_checklist';
    const payload = JSON.stringify({ items: data.items || {}, meterReading: data.meterReading || '', notes: data.notes || '', recordedAt: manilaNowIso() });
    const sql = ownerId
      ? `UPDATE tenants SET ${col} = $1::jsonb,
           deposit_deductions = COALESCE($2, deposit_deductions),
           deposit_refunded = COALESCE($3, deposit_refunded),
           deposit_refunded_at = COALESCE($4, deposit_refunded_at)
         WHERE id = $5 AND owner_id = $6 AND archived_at IS NULL RETURNING id`
      : `UPDATE tenants SET ${col} = $1::jsonb,
           deposit_deductions = COALESCE($2, deposit_deductions),
           deposit_refunded = COALESCE($3, deposit_refunded),
           deposit_refunded_at = COALESCE($4, deposit_refunded_at)
         WHERE id = $5 AND archived_at IS NULL RETURNING id`;
    const params = [payload, data.depositDeductions ?? null, data.depositRefunded ?? null, data.depositRefundedAt || null, id];
    if (ownerId) params.push(ownerId);
    const res = await q(sql, params);
    return res.rows.length ? { ok: true } : null;
  },

  async archiveTenant(ownerId, id) {
    return withTx(async (client) => {
      const curRes = ownerId
        ? await client.query(`SELECT * FROM tenants WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL FOR UPDATE`, [id, ownerId])
        : await client.query(`SELECT * FROM tenants WHERE id = $1 AND archived_at IS NULL FOR UPDATE`, [id]);
      if (!curRes.rows.length) return null;
      await client.query(`UPDATE tenants SET archived_at = NOW(), status = 'Inactive' WHERE id = $1`, [id]);
      if (curRes.rows[0].room_id) await recalcRoomTx(client, curRes.rows[0].room_id);
      return { ok: true };
    });
  },

  async listLeases(ownerId) {
    const res = ownerId
      ? await q(`SELECT l.*, t.full_name AS tenant_name, p.name AS property_name, r.room_number
                 FROM leases l JOIN tenants t ON t.id = l.tenant_id JOIN properties p ON p.id = l.property_id
                 LEFT JOIN rooms r ON r.id = l.room_id
                 WHERE l.owner_id = $1 AND t.archived_at IS NULL ORDER BY l.end_date ASC`, [ownerId])
      : await q(`SELECT l.*, t.full_name AS tenant_name, p.name AS property_name, r.room_number
                 FROM leases l JOIN tenants t ON t.id = l.tenant_id JOIN properties p ON p.id = l.property_id
                 LEFT JOIN rooms r ON r.id = l.room_id
                 WHERE t.archived_at IS NULL ORDER BY l.end_date ASC`);
    const today = manilaToday();
    return res.rows.map((l) => {
      const endDate = isoDateStr(l.end_date);
      const daysLeft = daysBetween(today, endDate);
      return {
        id: l.id, tenantId: l.tenant_id, tenantName: l.tenant_name, propertyId: l.property_id, propertyName: l.property_name,
        roomId: l.room_id, roomNumber: l.room_number || '—', startDate: isoDateStr(l.start_date), endDate,
        monthlyRate: num(l.monthly_rate), depositAmount: num(l.deposit_amount), status: l.status,
        daysLeft, expiringSoon: ['Active', 'Expiring'].includes(l.status) && daysLeft <= 30, notes: l.notes,
      };
    });
  },

  async listApplications(ownerId) {
    const sql = `
      SELECT a.*, p.owner_id, (ad.id IS NOT NULL) AS has_document
      FROM rental_applications a
      JOIN properties p ON p.id = a.property_id
      LEFT JOIN application_documents ad ON ad.application_id = a.id
      WHERE a.archived_at IS NULL AND p.archived_at IS NULL ${ownerId ? 'AND p.owner_id = $1' : ''}
      ORDER BY a.id DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((a) => ({
      id: a.id, referenceNumber: a.reference_number, userId: a.user_id, ownerId: a.owner_id,
      fullName: a.full_name, email: a.email, contactNumber: a.contact_number,
      propertyId: a.property_id, preferredRoomType: a.preferred_room_type, assignedRoomId: a.assigned_room_id,
      expectedMoveInDate: isoDateStr(a.expected_move_in_date), reservationDate: isoDateStr(a.reservation_date),
      occupants: a.occupants, message: a.message, consentAccepted: a.consent_accepted,
      status: a.status, hasDocument: !!a.has_document, createdAt: isoTsStr(a.created_at),
    }));
  },

  async getApplicationById(ownerId, id) {
    const res = ownerId
      ? await q(`SELECT a.* FROM rental_applications a JOIN properties p ON p.id = a.property_id WHERE a.id = $1 AND p.owner_id = $2 AND a.archived_at IS NULL`, [id, ownerId])
      : await q(`SELECT * FROM rental_applications WHERE id = $1 AND archived_at IS NULL`, [id]);
    return res.rows[0] ? { id: res.rows[0].id, fullName: res.rows[0].full_name, email: res.rows[0].email, contactNumber: res.rows[0].contact_number } : null;
  },

  async createPublicApplication(data, userId = null, doc = null) {
    return withTx(async (client) => {
      const pRes = await client.query(`SELECT id, owner_id, name, property_type FROM properties WHERE id = $1 AND is_published = TRUE AND archived_at IS NULL`, [data.propertyId]);
      if (!pRes.rows.length) return { error: 'property_not_found' };
      const prop = pRes.rows[0];
      const dup = await client.query(
        `SELECT id FROM rental_applications WHERE property_id = $1 AND LOWER(email) = LOWER($2) AND archived_at IS NULL AND status IN ('Pending','Approved','Reserved') LIMIT 1`,
        [prop.id, data.email]
      );
      if (dup.rows.length) return { error: 'duplicate_active' };

      const year = manilaToday().slice(0, 4);
      const ins = await client.query(
        `INSERT INTO rental_applications (
           reference_number, user_id, full_name, email, contact_number, property_id,
           preferred_room_type, expected_move_in_date, occupants, message, consent_accepted, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,'Pending') RETURNING *`,
        [`TEMP-${Date.now()}-${Math.random()}`, userId, data.fullName, data.email.toLowerCase(), data.contactNumber, prop.id, data.preferredRoomType || prop.property_type, data.expectedMoveInDate, data.occupants || 1, data.message || '']
      );
      const appRow = ins.rows[0];
      const ref = `APP-${year}-${1000 + appRow.id}`;
      await client.query(`UPDATE rental_applications SET reference_number = $1 WHERE id = $2`, [ref, appRow.id]);

      if (doc) {
        await client.query(
          `INSERT INTO application_documents (application_id, file_name, mime_type, file_size, content_base64) VALUES ($1,$2,$3,$4,$5)`,
          [appRow.id, doc.fileName, doc.mimeType, doc.fileSize, doc.contentBase64]
        );
      }

      // Notify property owner
      const ownUser = await client.query(`SELECT user_id FROM owners WHERE id = $1`, [prop.owner_id]);
      if (ownUser.rows.length) {
        await client.query(
          `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,'applications')`,
          [ownUser.rows[0].user_id, `New application ${ref}`, `${data.fullName} applied for ${prop.name}.`]
        );
      }
      return { referenceNumber: ref, status: 'Pending', propertyName: prop.name, id: appRow.id };
    });
  },

  async trackPublicApplication(referenceNumber, email) {
    const res = await q(
      `SELECT a.reference_number, a.status, a.preferred_room_type, a.expected_move_in_date, a.updated_at, p.name AS property_name
       FROM rental_applications a
       JOIN properties p ON p.id = a.property_id
       WHERE UPPER(a.reference_number) = UPPER($1) AND LOWER(a.email) = LOWER($2) AND a.archived_at IS NULL
       LIMIT 1`,
      [referenceNumber, email]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      referenceNumber: r.reference_number,
      status: r.status,
      propertyName: r.property_name,
      preferredRoomType: r.preferred_room_type,
      expectedMoveInDate: isoDateStr(r.expected_move_in_date),
      updatedAt: isoTsStr(r.updated_at),
    };
  },

  async updateApplicationStatus(ownerId, id, { status, assignedRoomId, reservationDate }) {
    return withTx(async (client) => {
      const aRes = ownerId
        ? await client.query(
            `SELECT a.*, p.owner_id, p.name AS property_name FROM rental_applications a
             JOIN properties p ON p.id = a.property_id
             WHERE a.id = $1 AND p.owner_id = $2 AND a.archived_at IS NULL FOR UPDATE`,
            [id, ownerId]
          )
        : await client.query(
            `SELECT a.*, p.owner_id, p.name AS property_name FROM rental_applications a
             JOIN properties p ON p.id = a.property_id
             WHERE a.id = $1 AND a.archived_at IS NULL FOR UPDATE`,
            [id]
          );
      if (!aRes.rows.length) return { error: 'not_found' };
      const appRow = aRes.rows[0];
      const targetRoomId = assignedRoomId ? Number(assignedRoomId) : appRow.assigned_room_id;
      const oldRoomId = appRow.assigned_room_id;
      let roomNumber = null;
      let bedOpened = false;

      if (['Approved', 'Reserved'].includes(status)) {
        if (!targetRoomId) return { error: 'room_required' };
        const roomRes = await client.query(`SELECT * FROM rooms WHERE id = $1 AND property_id = $2 AND archived_at IS NULL FOR UPDATE`, [targetRoomId, appRow.property_id]);
        if (!roomRes.rows.length) return { error: 'room_not_found' };
        const room = roomRes.rows[0];
        if (room.status === 'Maintenance') return { error: 'room_unavailable' };
        roomNumber = room.room_number;

        // Calculate available beds excluding THIS application's existing reservation if staying in same room
        const occRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM tenants WHERE room_id = $1 AND status = 'Active' AND archived_at IS NULL`, [targetRoomId]);
        const heldRes = await client.query(
          `SELECT COALESCE(SUM(r.beds_held), 0)::int AS held FROM reservations r
           JOIN rental_applications ap ON ap.id = r.application_id
           WHERE r.room_id = $1 AND r.status = 'Active' AND r.application_id != $2 AND ap.archived_at IS NULL AND ap.status IN ('Approved','Reserved')`,
          [targetRoomId, id]
        );
        const free = room.capacity - occRes.rows[0].cnt - heldRes.rows[0].held;
        if (free < appRow.occupants) {
          return { error: 'insufficient_beds', detail: `Room ${room.room_number} only has ${Math.max(0, free)} bed(s) free.` };
        }

        const resDate = reservationDate || isoDateStr(appRow.reservation_date) || manilaToday();
        const expiresAt = addDays(resDate, 7);
        await client.query(
          `INSERT INTO reservations (application_id, room_id, beds_held, reserved_date, expires_at, status)
           VALUES ($1,$2,$3,$4,$5,'Active')
           ON CONFLICT (application_id) DO UPDATE SET room_id = EXCLUDED.room_id, beds_held = EXCLUDED.beds_held, reserved_date = EXCLUDED.reserved_date, expires_at = EXCLUDED.expires_at, status = 'Active'`,
          [id, targetRoomId, appRow.occupants, resDate, expiresAt]
        );
        await client.query(
          `UPDATE rental_applications SET status = $1, assigned_room_id = $2, reservation_date = $3, updated_at = NOW() WHERE id = $4`,
          [status, targetRoomId, resDate, id]
        );
        if (oldRoomId && oldRoomId !== targetRoomId) {
          const oldCalc = await recalcRoomTx(client, oldRoomId);
          if (oldCalc && oldCalc.availableBeds > 0) bedOpened = true;
        }
        await recalcRoomTx(client, targetRoomId);
      } else {
        // Rejected / Cancelled / Pending
        await client.query(`UPDATE reservations SET status = $1 WHERE application_id = $2 AND status = 'Active'`, [status === 'Cancelled' ? 'Cancelled' : 'Cancelled', id]);
        await client.query(
          `UPDATE rental_applications SET status = $1, updated_at = NOW() WHERE id = $2`,
          [status, id]
        );
        if (oldRoomId) {
          const calc = await recalcRoomTx(client, oldRoomId);
          if (calc && calc.availableBeds > 0) bedOpened = true;
        }
      }

      return {
        application: {
          id: appRow.id, referenceNumber: appRow.reference_number, fullName: appRow.full_name, email: appRow.email,
          propertyId: appRow.property_id, propertyName: appRow.property_name, status, roomNumber,
        },
        bedOpened,
      };
    });
  },

  async convertApplicationToTenant(ownerId, id, data) {
    return withTx(async (client) => {
      const aRes = ownerId
        ? await client.query(
            `SELECT a.*, p.owner_id FROM rental_applications a JOIN properties p ON p.id = a.property_id
             WHERE a.id = $1 AND p.owner_id = $2 AND a.archived_at IS NULL FOR UPDATE`,
            [id, ownerId]
          )
        : await client.query(
            `SELECT a.*, p.owner_id FROM rental_applications a JOIN properties p ON p.id = a.property_id
             WHERE a.id = $1 AND a.archived_at IS NULL FOR UPDATE`,
            [id]
          );
      if (!aRes.rows.length) return { error: 'not_found' };
      const a = aRes.rows[0];
      if (a.status === 'Completed') return { error: 'already_converted' };
      if (!a.assigned_room_id) return { error: 'no_room' };

      const rRes = await client.query(`SELECT * FROM rooms WHERE id = $1 AND archived_at IS NULL FOR UPDATE`, [a.assigned_room_id]);
      if (!rRes.rows.length) return { error: 'no_room' };
      const room = rRes.rows[0];
      if (room.status === 'Maintenance') return { error: 'maintenance' };

      const occRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM tenants WHERE room_id = $1 AND status = 'Active' AND archived_at IS NULL`, [room.id]);
      const heldOther = await client.query(
        `SELECT COALESCE(SUM(r.beds_held), 0)::int AS held FROM reservations r
         WHERE r.room_id = $1 AND r.status = 'Active' AND r.application_id != $2`,
        [room.id, id]
      );
      if (room.capacity - occRes.rows[0].cnt - heldOther.rows[0].held < 1) {
        return { error: 'room_full' };
      }

      const moveIn = data.moveInDate || isoDateStr(a.expected_move_in_date) || manilaToday();
      const leaseEnd = data.leaseEndDate || addMonths(moveIn, 6);
      const uRes = await client.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'customer' AND archived_at IS NULL LIMIT 1`, [a.email]);

      const tIns = await client.query(
        `INSERT INTO tenants (user_id, owner_id, full_name, email, contact_number, address, emergency_contact, property_id, room_id, move_in_date, monthly_rent, security_deposit, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Active') RETURNING *`,
        [a.user_id || uRes.rows[0]?.id || null, a.owner_id, a.full_name, a.email, a.contact_number, data.address, data.emergencyContact, room.property_id, room.id, moveIn, room.monthly_price, data.securityDeposit]
      );
      const tenant = tIns.rows[0];
      await client.query(
        `INSERT INTO leases (tenant_id, owner_id, property_id, room_id, start_date, end_date, monthly_rate, deposit_amount, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Active',$9)`,
        [tenant.id, a.owner_id, room.property_id, room.id, moveIn, leaseEnd, room.monthly_price, data.securityDeposit, data.notes || '']
      );
      await client.query(`UPDATE reservations SET status = 'Converted' WHERE application_id = $1 AND status = 'Active'`, [id]);
      await client.query(`UPDATE rental_applications SET status = 'Completed', updated_at = NOW() WHERE id = $1`, [id]);
      await recalcRoomTx(client, room.id);
      return { tenant: { id: tenant.id, fullName: tenant.full_name, roomId: tenant.room_id, propertyId: tenant.property_id } };
    });
  },

  async archiveApplication(ownerId, id) {
    return withTx(async (client) => {
      const aRes = ownerId
        ? await client.query(`SELECT a.* FROM rental_applications a JOIN properties p ON p.id = a.property_id WHERE a.id = $1 AND p.owner_id = $2 AND a.archived_at IS NULL`, [id, ownerId])
        : await client.query(`SELECT * FROM rental_applications WHERE id = $1 AND archived_at IS NULL`, [id]);
      if (!aRes.rows.length) return null;
      await client.query(`UPDATE reservations SET status = 'Cancelled' WHERE application_id = $1 AND status = 'Active'`, [id]);
      await client.query(`UPDATE rental_applications SET archived_at = NOW(), status = 'Cancelled' WHERE id = $1`, [id]);
      if (aRes.rows[0].assigned_room_id) await recalcRoomTx(client, aRes.rows[0].assigned_room_id);
      return { ok: true };
    });
  },

  async getApplicationDocument(ownerId, appId) {
    const res = ownerId
      ? await q(
          `SELECT ad.* FROM application_documents ad
           JOIN rental_applications a ON a.id = ad.application_id
           JOIN properties p ON p.id = a.property_id
           WHERE ad.application_id = $1 AND p.owner_id = $2`,
          [appId, ownerId]
        )
      : await q(`SELECT * FROM application_documents WHERE application_id = $1`, [appId]);
    if (!res.rows.length) return null;
    const d = res.rows[0];
    return { fileName: d.file_name, mimeType: d.mime_type, fileSize: d.file_size, contentBase64: d.content_base64 };
  },

  async deleteApplicationDocument(ownerId, appId) {
    const res = ownerId
      ? await q(
          `DELETE FROM application_documents ad
           USING rental_applications a, properties p
           WHERE ad.application_id = $1 AND a.id = ad.application_id AND p.id = a.property_id AND p.owner_id = $2
           RETURNING ad.id`,
          [appId, ownerId]
        )
      : await q(`DELETE FROM application_documents WHERE application_id = $1 RETURNING id`, [appId]);
    return res.rows.length > 0;
  },

  async listPayments(ownerId) {
    const pRes = ownerId
      ? await q(`SELECT * FROM payments WHERE owner_id = $1 AND archived_at IS NULL ORDER BY due_date DESC, id DESC`, [ownerId])
      : await q(`SELECT * FROM payments WHERE archived_at IS NULL ORDER BY due_date DESC, id DESC`);
    if (!pRes.rows.length) return [];
    const ids = pRes.rows.map((p) => p.id);
    const txRes = await q(`SELECT * FROM payment_transactions WHERE payment_id = ANY($1::int[]) ORDER BY payment_date ASC, id ASC`, [ids]);
    const txMap = new Map();
    txRes.rows.forEach((t) => {
      if (!txMap.has(t.payment_id)) txMap.set(t.payment_id, []);
      txMap.get(t.payment_id).push(mapTx(t));
    });
    return pRes.rows.map((p) => computePaymentFields(p, txMap.get(p.id) || []));
  },

  async getPaymentById(ownerId, id) {
    const pRes = ownerId
      ? await q(`SELECT * FROM payments WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [id, ownerId])
      : await q(`SELECT * FROM payments WHERE id = $1 AND archived_at IS NULL`, [id]);
    if (!pRes.rows.length) return null;
    const txRes = await q(`SELECT * FROM payment_transactions WHERE payment_id = $1 ORDER BY payment_date ASC, id ASC`, [id]);
    return computePaymentFields(pRes.rows[0], txRes.rows.map(mapTx));
  },

  async createPayment(ownerId, userId, data) {
    return withTx(async (client) => {
      const tRes = ownerId
        ? await client.query(`SELECT * FROM tenants WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [data.tenantId, ownerId])
        : await client.query(`SELECT * FROM tenants WHERE id = $1 AND archived_at IS NULL`, [data.tenantId]);
      if (!tRes.rows.length) return { error: 'tenant_not_found' };
      const t = tRes.rows[0];
      const dup = await client.query(`SELECT id FROM payments WHERE tenant_id = $1 AND billing_month = $2 AND archived_at IS NULL`, [t.id, data.billingMonth]);
      if (dup.rows.length) return { error: 'duplicate' };
      const dueDate = data.dueDate || `${data.billingMonth}-05`;
      const amountDue = data.amountDue !== '' && data.amountDue !== undefined ? num(data.amountDue) : num(t.monthly_rent);
      const pIns = await client.query(
        `INSERT INTO payments (tenant_id, owner_id, property_id, room_id, billing_month, due_date, amount_due, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [t.id, t.owner_id, t.property_id, t.room_id, data.billingMonth, dueDate, amountDue, data.notes || '']
      );
      const payment = pIns.rows[0];
      const txs = [];
      const initAmt = num(data.initialAmountPaid);
      if (initAmt > 0) {
        const payDate = data.paymentDate || manilaToday();
        const year = payDate.slice(0, 4);
        const txIns = await client.query(
          `INSERT INTO payment_transactions (payment_id, amount, payment_date, payment_method, reference_number, receipt_number, notes, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [payment.id, initAmt, payDate, data.paymentMethod || 'Cash', `TMP-${Date.now()}`, `TMP-R-${Date.now()}`, data.notes || '', userId]
        );
        const tx = txIns.rows[0];
        const ref = `TXN-${data.billingMonth.replace('-', '')}-${String(tx.id).padStart(4, '0')}`;
        const rcpt = `RCPT-${year}-${String(tx.id).padStart(4, '0')}`;
        const upd = await client.query(`UPDATE payment_transactions SET reference_number = $1, receipt_number = $2 WHERE id = $3 RETURNING *`, [ref, rcpt, tx.id]);
        txs.push(mapTx(upd.rows[0]));
      }
      return { payment: computePaymentFields(payment, txs) };
    });
  },

  async addPaymentTransaction(ownerId, paymentId, userId, data) {
    return withTx(async (client) => {
      const pRes = ownerId
        ? await client.query(`SELECT * FROM payments WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL FOR UPDATE`, [paymentId, ownerId])
        : await client.query(`SELECT * FROM payments WHERE id = $1 AND archived_at IS NULL FOR UPDATE`, [paymentId]);
      if (!pRes.rows.length) return null;
      const p = pRes.rows[0];
      const payDate = data.paymentDate || manilaToday();
      const year = payDate.slice(0, 4);
      const txIns = await client.query(
        `INSERT INTO payment_transactions (payment_id, amount, payment_date, payment_method, reference_number, receipt_number, notes, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [paymentId, data.amount, payDate, data.paymentMethod, `TMP-${Date.now()}-${Math.random()}`, `TMP-R-${Date.now()}-${Math.random()}`, data.notes || '', userId]
      );
      const tx = txIns.rows[0];
      const ref = `TXN-${p.billing_month.replace('-', '')}-${String(tx.id).padStart(4, '0')}`;
      const rcpt = `RCPT-${year}-${String(tx.id).padStart(4, '0')}`;
      const upd = await client.query(`UPDATE payment_transactions SET reference_number = $1, receipt_number = $2 WHERE id = $3 RETURNING *`, [ref, rcpt, tx.id]);
      return mapTx(upd.rows[0]);
    });
  },

  async editPaymentTransaction(ownerId, txId, userId, data) {
    return withTx(async (client) => {
      const check = ownerId
        ? await client.query(
            `SELECT t.* FROM payment_transactions t JOIN payments p ON p.id = t.payment_id WHERE t.id = $1 AND p.owner_id = $2 AND t.voided_at IS NULL FOR UPDATE`,
            [txId, ownerId]
          )
        : await client.query(`SELECT * FROM payment_transactions WHERE id = $1 AND voided_at IS NULL FOR UPDATE`, [txId]);
      if (!check.rows.length) return null;
      const upd = await client.query(
        `UPDATE payment_transactions SET amount = $1, payment_date = $2, payment_method = $3, notes = $4, edit_reason = $5, edited_by = $6, edited_at = NOW()
         WHERE id = $7 RETURNING *`,
        [data.amount, data.paymentDate, data.paymentMethod, data.notes || '', data.reason, userId, txId]
      );
      return mapTx(upd.rows[0]);
    });
  },

  async voidPaymentTransaction(ownerId, txId, userId, reason) {
    return withTx(async (client) => {
      const check = ownerId
        ? await client.query(
            `SELECT t.* FROM payment_transactions t JOIN payments p ON p.id = t.payment_id WHERE t.id = $1 AND p.owner_id = $2 AND t.voided_at IS NULL FOR UPDATE`,
            [txId, ownerId]
          )
        : await client.query(`SELECT * FROM payment_transactions WHERE id = $1 AND voided_at IS NULL FOR UPDATE`, [txId]);
      if (!check.rows.length) return null;
      const upd = await client.query(
        `UPDATE payment_transactions SET voided_at = NOW(), void_reason = $1, voided_by = $2 WHERE id = $3 RETURNING *`,
        [reason, userId, txId]
      );
      return mapTx(upd.rows[0]);
    });
  },

  async archivePayment(ownerId, id) {
    const res = ownerId
      ? await q(`UPDATE payments SET archived_at = NOW() WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL RETURNING id`, [id, ownerId])
      : await q(`UPDATE payments SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL RETURNING id`, [id]);
    return res.rows.length > 0;
  },

  async listExpenseCategories() {
    const res = await q(`SELECT id, name, description FROM expense_categories ORDER BY id`);
    return res.rows;
  },

  async listExpenses(ownerId) {
    const sql = `
      SELECT e.*, ec.name AS category_name
      FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
      ${ownerId ? 'WHERE e.owner_id = $1' : ''}
      ORDER BY e.expense_date DESC, e.id DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((e) => ({
      id: e.id, ownerId: e.owner_id, propertyId: e.property_id, categoryId: e.category_id, category: e.category_name,
      description: e.description, amount: num(e.amount), expenseDate: isoDateStr(e.expense_date),
      paymentMethod: e.payment_method, receiptReference: e.receipt_reference,
    }));
  },

  async createExpense(ownerId, data) {
    const pRes = ownerId
      ? await q(`SELECT id, owner_id FROM properties WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [data.propertyId, ownerId])
      : await q(`SELECT id, owner_id FROM properties WHERE id = $1 AND archived_at IS NULL`, [data.propertyId]);
    if (!pRes.rows.length) return null;
    let catId = data.categoryId;
    if (!catId && data.category) {
      const c = await q(`SELECT id FROM expense_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`, [data.category]);
      catId = c.rows[0]?.id || 10;
    }
    const ins = await q(
      `INSERT INTO expenses (owner_id, property_id, category_id, description, amount, expense_date, payment_method, receipt_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [pRes.rows[0].owner_id, data.propertyId, catId || 10, data.description, data.amount, data.expenseDate || manilaToday(), data.paymentMethod, data.receiptReference || '']
    );
    const e = ins.rows[0];
    const cRes = await q(`SELECT name FROM expense_categories WHERE id = $1`, [e.category_id]);
    return {
      id: e.id, ownerId: e.owner_id, propertyId: e.property_id, categoryId: e.category_id,
      category: cRes.rows[0]?.name || 'Other Expenses', description: e.description, amount: num(e.amount),
      expenseDate: isoDateStr(e.expense_date), paymentMethod: e.payment_method, receiptReference: e.receipt_reference,
    };
  },

  async updateExpense(ownerId, id, data) {
    const pRes = ownerId
      ? await q(`SELECT id FROM properties WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`, [data.propertyId, ownerId])
      : await q(`SELECT id FROM properties WHERE id = $1 AND archived_at IS NULL`, [data.propertyId]);
    if (!pRes.rows.length) return null;
    let catId = data.categoryId;
    if (!catId && data.category) {
      const c = await q(`SELECT id FROM expense_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`, [data.category]);
      catId = c.rows[0]?.id || 10;
    }
    const res = ownerId
      ? await q(
          `UPDATE expenses SET property_id=$1, category_id=$2, description=$3, amount=$4, expense_date=$5, payment_method=$6, receipt_reference=$7
           WHERE id=$8 AND owner_id=$9 RETURNING *`,
          [data.propertyId, catId || 10, data.description, data.amount, data.expenseDate || manilaToday(), data.paymentMethod, data.receiptReference || '', id, ownerId]
        )
      : await q(
          `UPDATE expenses SET property_id=$1, category_id=$2, description=$3, amount=$4, expense_date=$5, payment_method=$6, receipt_reference=$7
           WHERE id=$8 RETURNING *`,
          [data.propertyId, catId || 10, data.description, data.amount, data.expenseDate || manilaToday(), data.paymentMethod, data.receiptReference || '', id]
        );
    if (!res.rows.length) return null;
    const e = res.rows[0];
    const cRes = await q(`SELECT name FROM expense_categories WHERE id = $1`, [e.category_id]);
    return { id: e.id, propertyId: e.property_id, categoryId: e.category_id, category: cRes.rows[0]?.name || 'Other Expenses', description: e.description, amount: num(e.amount), expenseDate: isoDateStr(e.expense_date), paymentMethod: e.payment_method, receiptReference: e.receipt_reference };
  },

  async deleteExpense(ownerId, id) {
    const res = ownerId
      ? await q(`DELETE FROM expenses WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, ownerId])
      : await q(`DELETE FROM expenses WHERE id = $1 RETURNING id`, [id]);
    return res.rows.length > 0;
  },

  async listPublicLatestReviews(limit = 6) {
    const res = await q(
      `SELECT r.id, r.property_id, r.reviewer_name, r.rating, r.title, r.comment, r.status, r.owner_reply, r.replied_at, r.created_at, p.name AS property_name
       FROM reviews r JOIN properties p ON p.id = r.property_id
       WHERE r.status = 'Approved' AND p.is_published = TRUE AND p.archived_at IS NULL
       ORDER BY r.created_at DESC, r.id DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      id: r.id, propertyId: r.property_id, propertyName: r.property_name, reviewerName: r.reviewer_name,
      rating: r.rating, title: r.title, comment: r.comment, status: r.status, ownerReply: r.owner_reply,
      repliedAt: isoTsStr(r.replied_at), createdAt: isoTsStr(r.created_at),
    }));
  },

  async listPropertyReviews(propertyId) {
    const pRes = await q(`SELECT id FROM properties WHERE id = $1 AND is_published = TRUE AND archived_at IS NULL`, [propertyId]);
    if (!pRes.rows.length) return null;
    const res = await q(
      `SELECT id, property_id, reviewer_name, rating, title, comment, status, owner_reply, replied_at, created_at
       FROM reviews WHERE property_id = $1 AND status = 'Approved' ORDER BY created_at DESC, id DESC`,
      [propertyId]
    );
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    res.rows.forEach((r) => { breakdown[r.rating] = (breakdown[r.rating] || 0) + 1; });
    const count = res.rows.length;
    const average = count ? Math.round((res.rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
    return {
      average, count, breakdown,
      reviews: res.rows.map((r) => ({
        id: r.id, propertyId: r.property_id, reviewerName: r.reviewer_name, rating: r.rating,
        title: r.title, comment: r.comment, status: r.status, ownerReply: r.owner_reply,
        repliedAt: isoTsStr(r.replied_at), createdAt: isoTsStr(r.created_at),
      })),
    };
  },

  async createPublicReview(data) {
    const pRes = await q(`SELECT id FROM properties WHERE id = $1 AND is_published = TRUE AND archived_at IS NULL`, [data.propertyId]);
    if (!pRes.rows.length) return { error: 'property_not_found' };
    const dup = await q(`SELECT id FROM reviews WHERE property_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`, [data.propertyId, data.email]);
    if (dup.rows.length) return { error: 'duplicate' };
    const ins = await q(
      `INSERT INTO reviews (property_id, reviewer_name, email, rating, title, comment, status) VALUES ($1,$2,$3,$4,$5,$6,'Pending') RETURNING id, status`,
      [data.propertyId, data.reviewerName, data.email.toLowerCase(), data.rating, data.title || '', data.comment]
    );
    return { review: ins.rows[0] };
  },

  async listReviews(ownerId) {
    const sql = `
      SELECT r.* FROM reviews r JOIN properties p ON p.id = r.property_id
      WHERE p.archived_at IS NULL ${ownerId ? 'AND p.owner_id = $1' : ''}
      ORDER BY r.created_at DESC, r.id DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((r) => ({
      id: r.id, propertyId: r.property_id, reviewerName: r.reviewer_name, email: r.email, rating: r.rating,
      title: r.title, comment: r.comment, status: r.status, ownerReply: r.owner_reply,
      repliedAt: isoTsStr(r.replied_at), createdAt: isoTsStr(r.created_at),
    }));
  },

  async updateReviewStatus(ownerId, id, status) {
    const res = ownerId
      ? await q(`UPDATE reviews r SET status = $1 FROM properties p WHERE r.id = $2 AND r.property_id = p.id AND p.owner_id = $3 RETURNING r.*`, [status, id, ownerId])
      : await q(`UPDATE reviews SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
    return res.rows[0] || null;
  },

  async replyReview(ownerId, id, ownerReply) {
    const res = ownerId
      ? await q(`UPDATE reviews r SET owner_reply = $1, replied_at = NOW() FROM properties p WHERE r.id = $2 AND r.property_id = p.id AND p.owner_id = $3 RETURNING r.*`, [ownerReply, id, ownerId])
      : await q(`UPDATE reviews SET owner_reply = $1, replied_at = NOW() WHERE id = $2 RETURNING *`, [ownerReply, id]);
    return res.rows[0] || null;
  },

  async deleteReview(ownerId, id) {
    const res = ownerId
      ? await q(`DELETE FROM reviews r USING properties p WHERE r.id = $1 AND r.property_id = p.id AND p.owner_id = $2 RETURNING r.id`, [id, ownerId])
      : await q(`DELETE FROM reviews WHERE id = $1 RETURNING id`, [id]);
    return res.rows.length > 0;
  },

  async listPublicTestimonials() {
    const res = await q(
      `SELECT t.*, p.name AS property_name FROM testimonials t LEFT JOIN properties p ON p.id = t.property_id
       WHERE t.status = 'Approved' ORDER BY t.id DESC LIMIT 6`
    );
    return res.rows.map((t) => ({ id: t.id, propertyId: t.property_id, propertyName: t.property_name || '', authorName: t.author_name, roleLabel: t.role_label, rating: t.rating, quote: t.quote, createdAt: isoTsStr(t.created_at) }));
  },

  async listTestimonials(ownerId) {
    const sql = `
      SELECT t.*, p.name AS property_name FROM testimonials t LEFT JOIN properties p ON p.id = t.property_id
      ${ownerId ? 'WHERE (t.property_id IS NULL OR p.owner_id = $1)' : ''}
      ORDER BY t.id DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((t) => ({ id: t.id, propertyId: t.property_id, propertyName: t.property_name || '', authorName: t.author_name, roleLabel: t.role_label, rating: t.rating, quote: t.quote, status: t.status, createdAt: isoTsStr(t.created_at) }));
  },

  async createPublicTestimonial(data) {
    const ins = await q(
      `INSERT INTO testimonials (property_id, author_name, role_label, rating, quote, status) VALUES ($1,$2,$3,$4,$5,'Pending') RETURNING *`,
      [data.propertyId || null, data.authorName, data.roleLabel || 'Resident', data.rating || 5, data.quote]
    );
    return ins.rows[0];
  },

  async updateTestimonialStatus(id, status) {
    const res = await q(`UPDATE testimonials SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
    return res.rows[0] || null;
  },

  async deleteTestimonial(id) {
    const res = await q(`DELETE FROM testimonials WHERE id = $1 RETURNING id`, [id]);
    return res.rows.length > 0;
  },

  async createContactMessage(data) {
    const ins = await q(
      `INSERT INTO contact_messages (full_name, email, phone, subject, message, consent_accepted, status)
       VALUES ($1,$2,$3,$4,$5,TRUE,'New') RETURNING *`,
      [data.fullName, data.email.toLowerCase(), data.phone || '', data.subject || 'General inquiry', data.message]
    );
    return ins.rows[0];
  },

  async listMessages() {
    const res = await q(`SELECT * FROM contact_messages ORDER BY created_at DESC, id DESC`);
    return res.rows.map((m) => ({
      id: m.id, fullName: m.full_name, email: m.email, phone: m.phone, subject: m.subject, message: m.message, status: m.status, createdAt: isoTsStr(m.created_at),
    }));
  },

  async updateMessageStatus(id, status) {
    const res = await q(`UPDATE contact_messages SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
    return res.rows[0] || null;
  },

  async deleteMessage(id) {
    const res = await q(`DELETE FROM contact_messages WHERE id = $1 RETURNING id`, [id]);
    return res.rows.length > 0;
  },

  async createViewingRequest(data, userId = null) {
    const pRes = await q(`SELECT id, owner_id, name FROM properties WHERE id = $1 AND is_published = TRUE AND archived_at IS NULL`, [data.propertyId]);
    if (!pRes.rows.length) return null;
    const prop = pRes.rows[0];
    const ins = await q(
      `INSERT INTO viewing_requests (property_id, user_id, full_name, email, phone, preferred_date, preferred_time, notes, consent_accepted, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,'Pending') RETURNING *`,
      [prop.id, userId, data.fullName, data.email.toLowerCase(), data.phone, data.preferredDate, data.preferredTime, data.notes || '']
    );
    const ownUser = await q(`SELECT user_id FROM owners WHERE id = $1`, [prop.owner_id]);
    if (ownUser.rows.length) {
      await q(`INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,'viewings')`, [ownUser.rows[0].user_id, `New viewing request`, `${data.fullName} requested a viewing at ${prop.name} on ${data.preferredDate}.`]);
    }
    return { ...ins.rows[0], propertyName: prop.name };
  },

  async listViewingRequests(ownerId) {
    const sql = `
      SELECT v.*, p.name AS property_name FROM viewing_requests v JOIN properties p ON p.id = v.property_id
      WHERE p.archived_at IS NULL ${ownerId ? 'AND p.owner_id = $1' : ''}
      ORDER BY v.preferred_date ASC, v.id DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((v) => ({
      id: v.id, propertyId: v.property_id, propertyName: v.property_name, fullName: v.full_name, email: v.email,
      phone: v.phone, preferredDate: isoDateStr(v.preferred_date), preferredTime: v.preferred_time, notes: v.notes,
      status: v.status, createdAt: isoTsStr(v.created_at),
    }));
  },

  async updateViewingStatus(ownerId, id, status) {
    const res = ownerId
      ? await q(
          `UPDATE viewing_requests v SET status = $1 FROM properties p
           WHERE v.id = $2 AND v.property_id = p.id AND p.owner_id = $3
           RETURNING v.*, p.name AS property_name`,
          [status, id, ownerId]
        )
      : await q(
          `UPDATE viewing_requests v SET status = $1 FROM properties p WHERE v.id = $2 AND p.id = v.property_id RETURNING v.*, p.name AS property_name`,
          [status, id]
        );
    if (!res.rows.length) return null;
    const v = res.rows[0];
    return { id: v.id, fullName: v.full_name, email: v.email, propertyName: v.property_name, preferredDate: isoDateStr(v.preferred_date), preferredTime: v.preferred_time, status: v.status };
  },

  async joinWaitlist(data) {
    const pRes = await q(`SELECT id, name FROM properties WHERE id = $1 AND is_published = TRUE AND archived_at IS NULL`, [data.propertyId]);
    if (!pRes.rows.length) return null;
    const dup = await q(`SELECT id FROM waitlist WHERE property_id = $1 AND LOWER(email) = LOWER($2) AND status = 'Waiting' LIMIT 1`, [data.propertyId, data.email]);
    if (dup.rows.length) return { alreadyWaiting: true, propertyName: pRes.rows[0].name };
    const ins = await q(
      `INSERT INTO waitlist (property_id, full_name, email, phone, preferred_room_type, consent_accepted, status)
       VALUES ($1,$2,$3,$4,$5,TRUE,'Waiting') RETURNING *`,
      [data.propertyId, data.fullName, data.email.toLowerCase(), data.phone || '', data.preferredRoomType || 'Any']
    );
    return { entry: ins.rows[0], propertyName: pRes.rows[0].name };
  },

  async listWaitlist(ownerId) {
    const sql = `
      SELECT w.*, p.name AS property_name FROM waitlist w JOIN properties p ON p.id = w.property_id
      WHERE p.archived_at IS NULL ${ownerId ? 'AND p.owner_id = $1' : ''}
      ORDER BY w.created_at DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((w) => ({
      id: w.id, propertyId: w.property_id, propertyName: w.property_name, fullName: w.full_name,
      email: w.email, phone: w.phone, preferredRoomType: w.preferred_room_type, status: w.status,
      notifiedAt: isoTsStr(w.notified_at), createdAt: isoTsStr(w.created_at),
    }));
  },

  async getWaitingForProperty(propertyId) {
    const res = await q(`SELECT * FROM waitlist WHERE property_id = $1 AND status = 'Waiting' ORDER BY id ASC`, [propertyId]);
    return res.rows.map((w) => ({ id: w.id, fullName: w.full_name, email: w.email, propertyId: w.property_id }));
  },

  async markWaitlistNotified(ids) {
    if (!ids.length) return;
    await q(`UPDATE waitlist SET status = 'Notified', notified_at = NOW() WHERE id = ANY($1::int[])`, [ids]);
  },

  async listCustomerFavorites(userId) {
    const res = await q(
      `SELECT p.* FROM favorites f JOIN properties p ON p.id = f.property_id
       WHERE f.user_id = $1 AND p.is_published = TRUE AND p.archived_at IS NULL ORDER BY f.created_at DESC`,
      [userId]
    );
    return hydrateProperties(res.rows);
  },

  async addFavorite(userId, propertyId) {
    await q(`INSERT INTO favorites (user_id, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, propertyId]);
    return { ok: true };
  },

  async removeFavorite(userId, propertyId) {
    await q(`DELETE FROM favorites WHERE user_id = $1 AND property_id = $2`, [userId, propertyId]);
    return { ok: true };
  },

  async listCustomerApplications(userId, email) {
    const res = await q(
      `SELECT a.*, p.name AS property_name, r.room_number
       FROM rental_applications a
       JOIN properties p ON p.id = a.property_id
       LEFT JOIN rooms r ON r.id = a.assigned_room_id
       WHERE a.archived_at IS NULL AND (a.user_id = $1 OR LOWER(a.email) = LOWER($2))
       ORDER BY a.created_at DESC`,
      [userId, email]
    );
    return res.rows.map((a) => ({
      id: a.id, referenceNumber: a.reference_number, propertyId: a.property_id, propertyName: a.property_name,
      preferredRoomType: a.preferred_room_type, roomNumber: a.room_number || null,
      expectedMoveInDate: isoDateStr(a.expected_move_in_date), occupants: a.occupants, status: a.status,
      createdAt: isoTsStr(a.created_at),
    }));
  },

  async getCustomerLeaseAndPayments(userId, email) {
    const tRes = await q(
      `SELECT t.*, p.name AS property_name, r.room_number
       FROM tenants t JOIN properties p ON p.id = t.property_id LEFT JOIN rooms r ON r.id = t.room_id
       WHERE t.archived_at IS NULL AND (t.user_id = $1 OR LOWER(t.email) = LOWER($2))
       ORDER BY t.id DESC`,
      [userId, email]
    );
    if (!tRes.rows.length) return { tenants: [], leases: [], payments: [] };
    const tIds = tRes.rows.map((t) => t.id);
    const [lRes, pRes] = await Promise.all([
      q(`SELECT l.*, p.name AS property_name, r.room_number FROM leases l JOIN properties p ON p.id = l.property_id LEFT JOIN rooms r ON r.id = l.room_id WHERE l.tenant_id = ANY($1::int[]) ORDER BY l.start_date DESC`, [tIds]),
      q(`SELECT * FROM payments WHERE tenant_id = ANY($1::int[]) AND archived_at IS NULL ORDER BY due_date DESC`, [tIds]),
    ]);
    const pIds = pRes.rows.map((p) => p.id);
    const txMap = new Map();
    if (pIds.length) {
      const txRes = await q(`SELECT * FROM payment_transactions WHERE payment_id = ANY($1::int[]) ORDER BY payment_date ASC, id ASC`, [pIds]);
      txRes.rows.forEach((tx) => {
        if (!txMap.has(tx.payment_id)) txMap.set(tx.payment_id, []);
        txMap.get(tx.payment_id).push(mapTx(tx));
      });
    }
    return {
      tenants: tRes.rows.map((t) => ({ id: t.id, fullName: t.full_name, propertyId: t.property_id, propertyName: t.property_name, roomId: t.room_id, roomNumber: t.room_number || '—', moveInDate: isoDateStr(t.move_in_date), monthlyRent: num(t.monthly_rent), securityDeposit: num(t.security_deposit), status: t.status })),
      leases: lRes.rows.map((l) => ({ id: l.id, propertyName: l.property_name, roomNumber: l.room_number || '—', startDate: isoDateStr(l.start_date), endDate: isoDateStr(l.end_date), monthlyRate: num(l.monthly_rate), depositAmount: num(l.deposit_amount), status: l.status })),
      payments: pRes.rows.map((p) => computePaymentFields(p, txMap.get(p.id) || [])),
    };
  },

  async createMaintenanceRequest(userId, email, data) {
    const tRes = await q(
      `SELECT t.* FROM tenants t WHERE t.archived_at IS NULL AND t.status = 'Active' AND (t.user_id = $1 OR LOWER(t.email) = LOWER($2)) ORDER BY t.id DESC LIMIT 1`,
      [userId, email]
    );
    let propId = data.propertyId;
    let roomId = data.roomId || null;
    let tenantId = null;
    let ownerId = null;
    if (tRes.rows.length) {
      tenantId = tRes.rows[0].id;
      propId = propId || tRes.rows[0].property_id;
      roomId = roomId || tRes.rows[0].room_id;
      ownerId = tRes.rows[0].owner_id;
    } else if (propId) {
      const pRes = await q(`SELECT owner_id FROM properties WHERE id = $1 AND archived_at IS NULL`, [propId]);
      ownerId = pRes.rows[0]?.owner_id || null;
    }
    if (!propId || !ownerId) return { error: 'no_property' };
    const ins = await q(
      `INSERT INTO maintenance_requests (owner_id, property_id, room_id, tenant_id, user_id, title, description, priority, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Open') RETURNING *`,
      [ownerId, propId, roomId, tenantId, userId, data.title, data.description, data.priority]
    );
    return { request: ins.rows[0] };
  },

  async listCustomerMaintenance(userId) {
    const res = await q(
      `SELECT m.*, p.name AS property_name, r.room_number
       FROM maintenance_requests m JOIN properties p ON p.id = m.property_id LEFT JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = $1 ORDER BY m.created_at DESC`,
      [userId]
    );
    return res.rows.map((m) => ({ id: m.id, propertyName: m.property_name, roomNumber: m.room_number || '—', title: m.title, description: m.description, priority: m.priority, status: m.status, ownerNotes: m.owner_notes, createdAt: isoTsStr(m.created_at) }));
  },

  async listOwnerMaintenance(ownerId) {
    const sql = `
      SELECT m.*, p.name AS property_name, r.room_number, t.full_name AS tenant_name
      FROM maintenance_requests m
      JOIN properties p ON p.id = m.property_id
      LEFT JOIN rooms r ON r.id = m.room_id
      LEFT JOIN tenants t ON t.id = m.tenant_id
      ${ownerId ? 'WHERE m.owner_id = $1' : ''}
      ORDER BY CASE m.status WHEN 'Open' THEN 1 WHEN 'In Progress' THEN 2 ELSE 3 END, m.created_at DESC`;
    const res = ownerId ? await q(sql, [ownerId]) : await q(sql);
    return res.rows.map((m) => ({
      id: m.id, propertyId: m.property_id, propertyName: m.property_name, roomNumber: m.room_number || '—',
      tenantName: m.tenant_name || 'Resident', title: m.title, description: m.description, priority: m.priority,
      status: m.status, ownerNotes: m.owner_notes, resolvedAt: isoTsStr(m.resolved_at), createdAt: isoTsStr(m.created_at),
    }));
  },

  async updateMaintenanceRequest(ownerId, id, { status, ownerNotes }) {
    const res = ownerId
      ? await q(
          `UPDATE maintenance_requests SET status = $1, owner_notes = $2, resolved_at = CASE WHEN $1 = 'Done' THEN NOW() ELSE NULL END
           WHERE id = $3 AND owner_id = $4 RETURNING *`,
          [status, ownerNotes || '', id, ownerId]
        )
      : await q(
          `UPDATE maintenance_requests SET status = $1, owner_notes = $2, resolved_at = CASE WHEN $1 = 'Done' THEN NOW() ELSE NULL END
           WHERE id = $3 RETURNING *`,
          [status, ownerNotes || '', id]
        );
    return res.rows[0] || null;
  },

  async listPublicAnnouncements(propertyId = null) {
    const res = propertyId
      ? await q(`SELECT a.*, p.name AS property_name FROM announcements a LEFT JOIN properties p ON p.id = a.property_id WHERE a.is_published = TRUE AND (a.property_id IS NULL OR a.property_id = $1) ORDER BY a.created_at DESC`, [propertyId])
      : await q(`SELECT a.*, p.name AS property_name FROM announcements a LEFT JOIN properties p ON p.id = a.property_id WHERE a.is_published = TRUE ORDER BY a.created_at DESC`);
    return res.rows.map((a) => ({ id: a.id, propertyId: a.property_id, propertyName: a.property_name || 'All Properties', title: a.title, body: a.body, createdAt: isoTsStr(a.created_at) }));
  },

  async listOwnerAnnouncements(ownerId) {
    const res = ownerId
      ? await q(`SELECT a.*, p.name AS property_name FROM announcements a LEFT JOIN properties p ON p.id = a.property_id WHERE a.owner_id = $1 ORDER BY a.created_at DESC`, [ownerId])
      : await q(`SELECT a.*, p.name AS property_name FROM announcements a LEFT JOIN properties p ON p.id = a.property_id ORDER BY a.created_at DESC`);
    return res.rows.map((a) => ({ id: a.id, propertyId: a.property_id, propertyName: a.property_name || 'All Properties', title: a.title, body: a.body, isPublished: a.is_published, createdAt: isoTsStr(a.created_at) }));
  },

  async createAnnouncement(ownerId, data) {
    const ins = await q(
      `INSERT INTO announcements (owner_id, property_id, title, body, is_published) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ownerId, data.propertyId || null, data.title, data.body, data.isPublished !== false]
    );
    return ins.rows[0];
  },

  async deleteAnnouncement(ownerId, id) {
    const res = ownerId
      ? await q(`DELETE FROM announcements WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, ownerId])
      : await q(`DELETE FROM announcements WHERE id = $1 RETURNING id`, [id]);
    return res.rows.length > 0;
  },

  async listNotifications(userId) {
    const res = await q(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY is_read ASC, created_at DESC LIMIT 30`, [userId]);
    return res.rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, isRead: n.is_read, createdAt: isoTsStr(n.created_at) }));
  },

  async markNotificationRead(userId, id) {
    if (id === 'all') {
      await q(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [userId]);
      return { ok: true };
    }
    await q(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [id, userId]);
    return { ok: true };
  },

  async exportCustomerData(userId) {
    const user = await this.findUserById(userId);
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;
    const [favorites, applications, leaseData, maintenance, reviews] = await Promise.all([
      this.listCustomerFavorites(userId),
      this.listCustomerApplications(userId, user.email),
      this.getCustomerLeaseAndPayments(userId, user.email),
      this.listCustomerMaintenance(userId),
      q(`SELECT id, property_id, rating, title, comment, status, created_at FROM reviews WHERE LOWER(email) = LOWER($1)`, [user.email]).then((r) => r.rows),
    ]);
    return { exportedAt: manilaNowIso(), profile: safeUser, favorites: favorites.map((f) => ({ id: f.id, name: f.name })), applications, ...leaseData, maintenance, reviews };
  },

  async logAudit({ userId = null, action, entityType, entityId = null, details = null, ipAddress = null }) {
    try {
      await q(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, action, entityType, entityId, details ? JSON.stringify(details) : null, ipAddress]
      );
    } catch (err) {
      console.warn('[audit] failed:', err.message);
    }
  },

  async listAuditLogs(ownerId, limit = 100) {
    const sql = ownerId
      ? `SELECT al.*, u.full_name AS actor_name, u.role AS actor_role FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE u.owner_id = $1 OR al.user_id IS NULL ORDER BY al.created_at DESC LIMIT $2`
      : `SELECT al.*, u.full_name AS actor_name, u.role AS actor_role FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC LIMIT $1`;
    const res = ownerId ? await q(sql, [ownerId, limit]) : await q(sql, [limit]);
    return res.rows.map((a) => ({
      id: a.id, userId: a.user_id, actorName: a.actor_name || 'Public/System', actorRole: a.actor_role || 'system',
      action: a.action, entityType: a.entity_type, entityId: a.entity_id, details: a.details, ipAddress: a.ip_address, createdAt: isoTsStr(a.created_at),
    }));
  },

  async getDashboardSummary(ownerId, range) {
    const [props, blds, rooms, tenants, pays, exps, revs, msgs, viewings, leases, maint] = await Promise.all([
      this.listOwnerProperties(ownerId),
      this.listBuildings(ownerId),
      this.listRooms(ownerId),
      this.listTenants(ownerId),
      this.listPayments(ownerId),
      this.listExpenses(ownerId),
      this.listReviews(ownerId),
      this.listMessages(),
      this.listViewingRequests(ownerId),
      this.listLeases(ownerId),
      this.listOwnerMaintenance(ownerId),
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

    const months = [...new Set([
      ...paysDue.map((p) => p.dueDate.slice(0, 7)),
      ...allTxs.map((t) => t.paymentDate.slice(0, 7)),
      ...expsInRange.map((e) => e.expenseDate.slice(0, 7)),
    ])].sort();

    const incomeByDueMonth = months.map((m) => paysDue.filter((p) => p.dueDate.startsWith(m)).reduce((s, p) => s + p.amountPaid, 0));
    const incomeByPaymentDate = months.map((m) => allTxs.filter((t) => t.paymentDate.startsWith(m)).reduce((s, t) => s + t.amount, 0));
    const expenseByMonth = months.map((m) => expsInRange.filter((e) => e.expenseDate.startsWith(m)).reduce((s, e) => s + e.amount, 0));
    const statuses = ['Paid', 'Partial', 'Pending', 'Overdue'];

    return {
      kpis: {
        totalProperties: props.length,
        totalBuildings: blds.length,
        totalRooms: rooms.length,
        availableRooms: roomCount('Available'),
        occupiedRooms: roomCount('Occupied'),
        reservedRooms: roomCount('Reserved'),
        totalTenants: activeTenants.length,
        monthlyExpectedIncome: activeTenants.reduce((s, t) => s + t.monthlyRent, 0),
        totalCollected: collectedByDue,
        collectedByPaymentDate: collectedByPayDate,
        pendingPayments: paysDue.filter((p) => ['Pending', 'Partial'].includes(p.status)).reduce((s, p) => s + p.remainingBalance, 0),
        overduePayments: paysDue.filter((p) => p.status === 'Overdue').reduce((s, p) => s + p.remainingBalance, 0),
        monthlyExpenses: expensesTotal,
        netIncome: collectedByDue - expensesTotal,
        pendingReviews: revs.filter((r) => r.status === 'Pending').length,
        unreadMessages: msgs.filter((m) => m.status === 'New').length,
        pendingViewings: viewings.filter((v) => v.status === 'Pending').length,
        openMaintenance: maint.filter((m) => m.status !== 'Done').length,
        expiringLeases: leases.filter((l) => l.expiringSoon).length,
      },
      charts: {
        months,
        incomeByMonth: incomeByDueMonth,
        incomeByDueMonth,
        incomeByPaymentDate,
        expenseByMonth,
        occupancy: {
          labels: ['Available', 'Occupied', 'Reserved', 'Maintenance'],
          values: ['Available', 'Occupied', 'Reserved', 'Maintenance'].map(roomCount),
        },
        paymentStatus: {
          labels: statuses,
          values: statuses.map((st) => paysDue.filter((p) => p.status === st).length),
        },
        propertyPerformance: {
          labels: props.map((p) => p.name),
          values: props.map((p) => paysDue.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amountPaid, 0)),
        },
      },
    };
  },

  async getFinancialReport(ownerId, range) {
    const [props, rooms, tenants, pays, exps, apps] = await Promise.all([
      this.listOwnerProperties(ownerId),
      this.listRooms(ownerId),
      this.listTenants(ownerId),
      this.listPayments(ownerId),
      this.listExpenses(ownerId),
      this.listApplications(ownerId),
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

    const viewsRes = await q(
      `SELECT property_id, COUNT(*)::int AS cnt FROM property_views WHERE property_id = ANY($1::int[]) GROUP BY property_id`,
      [props.map((p) => p.id)]
    );
    const viewMap = new Map(viewsRes.rows.map((r) => [r.property_id, r.cnt]));

    const today = manilaToday();
    const vacantRooms = rooms.filter((r) => r.status === 'Available' && r.lastVacatedAt);
    const avgVacancyDays = vacantRooms.length
      ? Math.round(vacantRooms.reduce((s, r) => s + Math.max(0, daysBetween(r.lastVacatedAt, today)), 0) / vacantRooms.length)
      : 0;

    const months = [...new Set([...paysDue.map((p) => p.billingMonth), ...txsInRange.map((t) => t.paymentDate.slice(0, 7))])].sort();
    const byDueMonth = months.map((m) => ({
      month: m,
      expected: paysDue.filter((p) => p.billingMonth === m).reduce((s, p) => s + p.amountDue, 0),
      collected: paysDue.filter((p) => p.billingMonth === m).reduce((s, p) => s + p.amountPaid, 0),
    }));
    const byPaymentDate = months.map((m) => ({
      month: m,
      collected: txsInRange.filter((t) => t.paymentDate.startsWith(m)).reduce((s, t) => s + t.amount, 0),
    }));

    return {
      range,
      summary: {
        expectedIncome,
        collected: collectedByDue,
        collectedByPaymentDate: collectedByPayDate,
        outstanding,
        expenses: expensesTotal,
        netIncome: collectedByDue - expensesTotal,
        netIncomeByPaymentDate: collectedByPayDate - expensesTotal,
      },
      occupancy: {
        totalRooms: rooms.length,
        occupied,
        available: rooms.filter((r) => r.status === 'Available').length,
        reserved: rooms.filter((r) => r.status === 'Reserved').length,
        percent: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0,
      },
      byDueMonth,
      byPaymentDate,
      byProperty: props.map((p) => ({
        name: p.name,
        income: paysDue.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amountPaid, 0),
        incomeByPayDate: txsInRange.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amount, 0),
        expenses: expsInRange.filter((x) => x.propertyId === p.id).reduce((s, x) => s + x.amount, 0),
      })),
      byCategory: [...new Set(expsInRange.map((e) => e.category))].map((c) => ({
        category: c,
        amount: expsInRange.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0),
      })),
      byTenant: tenants
        .map((t) => ({
          name: t.fullName,
          paid: paysDue.filter((p) => p.tenantId === t.id).reduce((s, p) => s + p.amountPaid, 0),
          balance: paysDue.filter((p) => p.tenantId === t.id).reduce((s, p) => s + p.remainingBalance, 0),
        }))
        .filter((x) => x.paid || x.balance),
      analytics: {
        collectionRate: expectedIncome ? Math.round((collectedByDue / expectedIncome) * 1000) / 10 : 0,
        avgVacancyDays,
        occupancyTrend: months.map((m) => ({
          month: m,
          occupiedBilled: paysDue.filter((p) => p.billingMonth === m).length,
          occupancyRate: rooms.length ? Math.min(100, Math.round((paysDue.filter((p) => p.billingMonth === m).length / rooms.length) * 100)) : 0,
        })),
        viewsVsApplications: props.map((p) => ({
          propertyName: p.name,
          views: viewMap.get(p.id) || 0,
          applications: apps.filter((a) => a.propertyId === p.id).length,
        })),
      },
    };
  },

  async runDailyCron() {
    const today = manilaToday();
    const in3Days = addDays(today, 3);
    const in30Days = addDays(today, 30);

    return withTx(async (client) => {
      // 1. Expire stale reservations
      const expRes = await client.query(
        `SELECT r.id, r.application_id, r.room_id, a.property_id, p.name AS property_name
         FROM reservations r
         JOIN rental_applications a ON a.id = r.application_id
         JOIN properties p ON p.id = a.property_id
         WHERE r.status = 'Active' AND r.expires_at < $1 FOR UPDATE`,
        [today]
      );
      const freedProperties = [];
      for (const row of expRes.rows) {
        await client.query(`UPDATE reservations SET status = 'Expired' WHERE id = $1`, [row.id]);
        await client.query(`UPDATE rental_applications SET status = 'Cancelled', updated_at = NOW() WHERE id = $1`, [row.application_id]);
        const calc = await recalcRoomTx(client, row.room_id);
        if (calc && calc.availableBeds > 0) freedProperties.push({ propertyId: row.property_id, propertyName: row.property_name });
      }

      // 2. Rent reminders (3 days before due date) and overdue notifications
      const remRes = await client.query(
        `SELECT p.id, p.billing_month, p.due_date, p.amount_due, t.full_name, t.email,
           COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.payment_id = p.id AND pt.voided_at IS NULL), 0) AS paid
         FROM payments p JOIN tenants t ON t.id = p.tenant_id
         WHERE p.archived_at IS NULL AND p.due_date = $1 AND p.reminder_sent_at IS NULL`,
        [in3Days]
      );
      const upcomingReminders = [];
      for (const r of remRes.rows) {
        const rem = num(r.amount_due) - num(r.paid);
        if (rem > 0 && r.email) {
          await client.query(`UPDATE payments SET reminder_sent_at = NOW() WHERE id = $1`, [r.id]);
          upcomingReminders.push({ to: r.email, fullName: r.full_name, billingMonth: r.billing_month, dueDate: isoDateStr(r.due_date), remainingBalance: rem, isOverdue: false });
        }
      }

      const ovRes = await client.query(
        `SELECT p.id, p.billing_month, p.due_date, p.amount_due, t.full_name, t.email,
           COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.payment_id = p.id AND pt.voided_at IS NULL), 0) AS paid
         FROM payments p JOIN tenants t ON t.id = p.tenant_id
         WHERE p.archived_at IS NULL AND p.due_date < $1 AND p.overdue_notified_at IS NULL`,
        [today]
      );
      const overdueReminders = [];
      for (const r of ovRes.rows) {
        const rem = num(r.amount_due) - num(r.paid);
        if (rem > 0 && r.email) {
          await client.query(`UPDATE payments SET overdue_notified_at = NOW() WHERE id = $1`, [r.id]);
          overdueReminders.push({ to: r.email, fullName: r.full_name, billingMonth: r.billing_month, dueDate: isoDateStr(r.due_date), remainingBalance: rem, isOverdue: true });
        }
      }

      // 3. Lease expiry alerts within 30 days
      const lRes = await client.query(
        `SELECT l.id, l.end_date, t.full_name, r.room_number, o.user_id AS owner_user_id
         FROM leases l
         JOIN tenants t ON t.id = l.tenant_id
         LEFT JOIN rooms r ON r.id = l.room_id
         JOIN owners o ON o.id = l.owner_id
         WHERE l.status IN ('Active','Expiring') AND l.end_date BETWEEN $1 AND $2 AND l.renewal_notified_at IS NULL`,
        [today, in30Days]
      );
      for (const l of lRes.rows) {
        await client.query(`UPDATE leases SET status = 'Expiring', renewal_notified_at = NOW() WHERE id = $1`, [l.id]);
        await client.query(
          `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,'tenants')`,
          [l.owner_user_id, 'Lease expiring within 30 days', `${l.full_name} (${l.room_number || 'Unit'}) lease ends ${isoDateStr(l.end_date)}.`]
        );
      }

      return {
        expiredReservations: expRes.rows.length,
        upcomingReminders,
        overdueReminders,
        leaseAlertsCreated: lRes.rows.length,
        freedProperties,
      };
    });
  },
};
