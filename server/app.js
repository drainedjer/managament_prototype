/**
 * app.js - Express 4 application for CasaBatangueño (Vercel serverless + local dev).
 * Handles security middleware, httpOnly cookie + CSRF auth, role-based access control,
 * owner isolation, masked staff views, private ID document access, Resend emails, and Vercel Cron.
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { put } = require('@vercel/blob');

const db = require('./db');
const V = require('./validate');
const { getDateRange } = require('./time');
const email = require('./email');

const app = express();
app.set('trust proxy', 1);

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const BCRYPT_ROUNDS = 12;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const SESSION_COOKIE = 'cb_session';
const CSRF_COOKIE = 'cb_csrf';

// Enforce JWT_SECRET in production/Vercel; use an ephemeral random key in local dev/test if unset.
let resolvedJwtSecret = process.env.JWT_SECRET || '';
if (!resolvedJwtSecret) {
  if (IS_PROD || process.env.ENFORCE_JWT_SECRET === 'true') {
    throw new Error('JWT_SECRET environment variable is required in production/Vercel.');
  }
  resolvedJwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET not set — using ephemeral in-memory secret for local dev/test.');
}
const getJwtSecret = () => process.env.JWT_SECRET || resolvedJwtSecret;

// ---------- security headers & CORS ----------
const IS_VERCEL = !!process.env.VERCEL;
app.use(
  helmet({
    frameguard: IS_VERCEL ? { action: 'sameorigin' } : false,
    hsts: IS_VERCEL,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://unpkg.com',
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://unpkg.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://tile.openstreetmap.org',
          'https://*.tile.openstreetmap.org',
          'https://unpkg.com',
          'https://*.public.blob.vercel-storage.com',
        ],
        connectSrc: ["'self'"],
        frameAncestors: IS_VERCEL ? ["'self'"] : ["'self'", 'https:', 'http://localhost:*'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        ...(IS_VERCEL ? {} : { upgradeInsecureRequests: null }),
      },
    },
  })
);

function getAllowedOrigins() {
  const set = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
  if (process.env.VERCEL_URL) set.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.APP_URL) set.add(process.env.APP_URL.replace(/\/$/, ''));
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .forEach((o) => set.add(o));
  return set;
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      const allowed = getAllowedOrigins();
      if (allowed.has(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '4mb' }));

// ---------- rate limiting ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' },
});

const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many submissions from your network. Please try again shortly.' },
});

// ---------- cookie & CSRF helpers ----------
function cookieBaseOpts(req) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;
  return {
    path: '/',
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    ...(isHttps ? { partitioned: true } : {}),
  };
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieBaseOpts(req),
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function ensureCsrfCookie(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || typeof token !== 'string' || token.length < 16) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      ...cookieBaseOpts(req),
      httpOnly: false,
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  return token;
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, { ...cookieBaseOpts(req), httpOnly: true });
}

// Require matching double-submit CSRF token when a session cookie is active on state-changing routes.
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/cron/daily') return next();
  const hasSessionCookie = !!req.cookies?.[SESSION_COOKIE];
  if (!hasSessionCookie) return next();

  const headerToken = req.get('x-csrf-token');
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Please refresh and try again.' });
  }
  const origin = req.get('origin');
  const host = req.get('host');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host && !getAllowedOrigins().has(origin)) {
        return res.status(403).json({ error: 'Origin mismatch.' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid Origin header.' });
    }
  }
  next();
}
app.use(csrfProtect);

// ---------- auth helpers & RBAC ----------
function readAuthToken(req) {
  if (req.cookies?.[SESSION_COOKIE]) return req.cookies[SESSION_COOKIE];
  const hdr = req.get('authorization') || '';
  if (hdr.startsWith('Bearer ')) return hdr.slice(7).trim();
  return null;
}

async function attachOptionalUser(req, res, next) {
  const token = readAuthToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await db.findUserById(payload.id);
    if (user && user.isActive) {
      req.user = user;
      req.ownerId = await db.getOwnerIdForUser(user);
    }
  } catch {
    // ignore expired/invalid optional token
  }
  next();
}

async function requireAuth(req, res, next) {
  const token = readAuthToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await db.findUserById(payload.id);
    if (!user || !user.isActive) return res.status(401).json({ error: 'Session is no longer valid.' });
    req.user = user;
    req.ownerId = await db.getOwnerIdForUser(user);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission for this action.' });
  }
  next();
};
const requireStaff = requireRoles('staff', 'owner', 'admin');
const requireOwner = requireRoles('owner', 'admin');
const requireAdmin = requireRoles('admin');

function safeUserDto(u, ownerId = null) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    phone: u.phone || '',
    ownerId: ownerId ?? u.ownerId ?? null,
  };
}

// ---------- masking helpers for staff role ----------
function maskEmail(val) {
  const s = String(val || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '***' : '';
  const local = s.slice(0, at);
  return `${local[0]}***${s.slice(at)}`;
}

function maskPhone(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '****';
  const tail = s.slice(-4);
  const head = s.startsWith('+') ? s.slice(0, 5) : s.slice(0, 2);
  return `${head} *** ${tail}`;
}

function formatTenantForRole(t, role) {
  if (role !== 'staff') return t;
  return {
    id: t.id,
    ownerId: t.ownerId,
    fullName: t.fullName,
    email: maskEmail(t.email),
    contactNumber: maskPhone(t.contactNumber),
    propertyId: t.propertyId,
    roomId: t.roomId,
    moveInDate: t.moveInDate,
    moveOutDate: t.moveOutDate,
    monthlyRent: t.monthlyRent,
    status: t.status,
    leaseEndDate: t.leaseEndDate,
    leaseStatus: t.leaseStatus,
    masked: true,
  };
}

function formatAppForRole(a, role) {
  if (role !== 'staff') return a;
  return {
    ...a,
    email: maskEmail(a.email),
    contactNumber: maskPhone(a.contactNumber),
    hasDocument: false,
    masked: true,
  };
}

// ---------- file magic-byte helpers ----------
function detectFileSignature(buf, allowPdf = false) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  if (allowPdf && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { ext: 'pdf', mime: 'application/pdf' };
  }
  return null;
}

function decodeBase64Payload(input) {
  const raw = String(input || '').replace(/^data:[^;]+;base64,/, '').trim();
  const buf = Buffer.from(raw, 'base64');
  return buf;
}

async function notifyWaitlistForProperty(propertyId, propertyName, roomNumber = '') {
  try {
    const waiting = await db.getWaitingForProperty(propertyId);
    if (!waiting.length) return;
    await Promise.all(
      waiting.map((w) =>
        email.sendWaitlistAlertEmail({
          to: w.email,
          fullName: w.fullName,
          propertyName,
          roomNumber,
        })
      )
    );
    await db.markWaitlistNotified(waiting.map((w) => w.id));
  } catch (err) {
    console.warn('[waitlist] Notification error:', err.message);
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================
// HEALTH & CSRF
// ============================================================
app.get('/api/health', wrap(async (req, res) => {
  const h = await db.healthCheck();
  res.status(h.ok ? 200 : 503).json(h);
}));

app.get('/api/auth/csrf', (req, res) => {
  const csrfToken = ensureCsrfCookie(req, res);
  res.json({ csrfToken });
});

// ============================================================
// AUTHENTICATION & CUSTOMER SELF-SERVICE
// ============================================================
app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.loginSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { email: userEmail, password } = parsed.data;

  const user = await db.findUserByEmail(userEmail);
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return res.status(423).json({
      error: 'Account temporarily locked due to too many failed login attempts. Try again in 15 minutes.',
    });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const lockInfo = await db.recordFailedLogin(user.id);
    await db.logAudit({
      userId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
      details: { attempts: lockInfo?.failed_login_attempts || 1 },
      ipAddress: req.ip,
    });
    if (lockInfo?.locked_until) {
      return res.status(423).json({
        error: 'Too many failed login attempts. Account locked for 15 minutes.',
      });
    }
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  await db.clearFailedLogins(user.id);
  const ownerId = await db.getOwnerIdForUser(user);
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, getJwtSecret(), { expiresIn: '8h' });
  setSessionCookie(req, res, token);
  const csrfToken = ensureCsrfCookie(req, res);

  await db.logAudit({
    userId: user.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'user',
    entityId: user.id,
    ipAddress: req.ip,
  });

  res.json({ user: safeUserDto(user, ownerId), csrfToken });
}));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.registerSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { fullName, email: userEmail, password, phone } = parsed.data;

  const existing = await db.findUserByEmail(userEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await db.createUser({
    fullName,
    email: userEmail,
    passwordHash,
    role: 'customer',
    phone,
    consentAccepted: true,
  });

  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, getJwtSecret(), { expiresIn: '8h' });
  setSessionCookie(req, res, token);
  const csrfToken = ensureCsrfCookie(req, res);
  await db.logAudit({
    userId: user.id,
    action: 'REGISTER_CUSTOMER',
    entityType: 'user',
    entityId: user.id,
    ipAddress: req.ip,
  });
  res.status(201).json({ user: safeUserDto(user), csrfToken });
}));

app.post('/api/auth/logout', attachOptionalUser, wrap(async (req, res) => {
  if (req.user) {
    await db.logAudit({ userId: req.user.id, action: 'LOGOUT', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
}));

app.post('/api/auth/forgot-password', authLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.forgotPasswordSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const user = await db.findUserByEmail(parsed.data.email);
  if (user && user.isActive) {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await db.createPasswordReset(user.id, tokenHash, expiresAt);

    const origin = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${origin}/account.html?resetToken=${encodeURIComponent(rawToken)}`;
    await email.sendPasswordResetEmail({ to: user.email, fullName: user.fullName, resetUrl });
    await db.logAudit({ userId: user.id, action: 'PASSWORD_RESET_REQUEST', entityType: 'user', entityId: user.id, ipAddress: req.ip });
  }
  res.json({ message: 'If an account matches that email, a password reset link has been sent.' });
}));

app.post('/api/auth/reset-password', authLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.resetPasswordSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
  const userId = await db.consumePasswordReset(tokenHash, passwordHash);
  if (!userId) return res.status(400).json({ error: 'Reset link is invalid or expired.' });

  await db.logAudit({ userId, action: 'PASSWORD_RESET_COMPLETE', entityType: 'user', entityId: userId, ipAddress: req.ip });
  res.json({ message: 'Password updated. You can now sign in with your new password.' });
}));

app.get('/api/auth/me', requireAuth, (req, res) => {
  const csrfToken = ensureCsrfCookie(req, res);
  res.json({
    ...safeUserDto(req.user, req.ownerId),
    csrfToken,
    demoResetEnabled: process.env.NODE_ENV !== 'production',
  });
});

app.patch('/api/auth/profile', requireAuth, wrap(async (req, res) => {
  const parsed = V.validate(V.profileSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const updated = await db.updateUserProfile(req.user.id, parsed.data);
  await db.logAudit({ userId: req.user.id, action: 'PROFILE_UPDATE', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
  res.json(safeUserDto(updated, req.ownerId));
}));

app.post('/api/auth/change-password', requireAuth, wrap(async (req, res) => {
  const parsed = V.validate(V.changePasswordSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const ok = await bcrypt.compare(parsed.data.currentPassword, req.user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
  const hash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await db.updateUserPassword(req.user.id, hash);
  await db.logAudit({ userId: req.user.id, action: 'PASSWORD_CHANGE', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
  res.json({ ok: true, message: 'Password changed successfully.' });
}));

app.get('/api/auth/my-data', requireAuth, wrap(async (req, res) => {
  const payload = await db.exportCustomerData(req.user.id);
  if (!payload) return res.status(404).json({ error: 'Account not found.' });
  await db.logAudit({ userId: req.user.id, action: 'DATA_EXPORT', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
  res.setHeader('Content-Disposition', 'attachment; filename="casabatangueno-my-data.json"');
  res.json(payload);
}));

app.post('/api/auth/delete-account', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Only customer accounts can be self-deleted here.' });
  }
  const parsed = V.validate(V.deleteAccountSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const ok = await bcrypt.compare(parsed.data.password, req.user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Incorrect password.' });

  await db.logAudit({ userId: req.user.id, action: 'ACCOUNT_DELETE', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
  await db.softDeleteUserAccount(req.user.id);
  clearSessionCookie(req, res);
  res.json({ ok: true, message: 'Your account and personal details have been deleted.' });
}));

// ============================================================
// PUBLIC ENDPOINTS (NO PERSONAL DATA EXPOSED)
// ============================================================
app.get('/api/public/settings', wrap(async (req, res) => {
  res.json(await db.getSettings());
}));

app.get('/api/public/properties', wrap(async (req, res) => {
  res.json(await db.listPublicProperties(req.query));
}));

app.get('/api/public/properties/:id', wrap(async (req, res) => {
  const p = await db.getPublicPropertyById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found.' });
  await db.recordPropertyView(p.id).catch(() => {});
  res.json(p);
}));

app.get('/api/public/properties/:id/reviews', wrap(async (req, res) => {
  const data = await db.listPropertyReviews(req.params.id);
  if (!data) return res.status(404).json({ error: 'Property not found.' });
  res.json(data);
}));

app.get('/api/public/reviews/latest', wrap(async (req, res) => {
  const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 6));
  res.json(await db.listPublicLatestReviews(limit));
}));

app.get('/api/public/testimonials', wrap(async (req, res) => {
  res.json(await db.listPublicTestimonials());
}));

app.get('/api/public/announcements', wrap(async (req, res) => {
  res.json(await db.listPublicAnnouncements(req.query.propertyId || null));
}));

app.post('/api/public/applications', publicWriteLimiter, attachOptionalUser, wrap(async (req, res) => {
  const parsed = V.validate(V.applicationSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  let doc = null;
  if (parsed.data.idDocument) {
    const buf = decodeBase64Payload(parsed.data.idDocument.contentBase64);
    if (!buf.length || buf.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'ID document must be 2 MB or smaller.' });
    }
    const sig = detectFileSignature(buf, true);
    if (!sig) {
      return res.status(400).json({ error: 'ID document must be a valid JPG, PNG, WEBP, or PDF file.' });
    }
    doc = {
      fileName: `${crypto.randomUUID()}.${sig.ext}`,
      mimeType: sig.mime,
      fileSize: buf.length,
      contentBase64: buf.toString('base64'),
    };
  }

  const out = await db.createPublicApplication(parsed.data, req.user?.id || null, doc);
  if (out.error === 'property_not_found') return res.status(404).json({ error: 'Property not found.' });
  if (out.error === 'duplicate_active') {
    return res.status(409).json({
      error: 'You already have an active (Pending, Approved, or Reserved) application for this property.',
    });
  }

  await db.logAudit({
    userId: req.user?.id || null,
    action: 'APPLICATION_SUBMIT',
    entityType: 'application',
    entityId: out.id,
    details: { referenceNumber: out.referenceNumber, propertyId: parsed.data.propertyId },
    ipAddress: req.ip,
  });

  await email.sendApplicationConfirmation({
    to: parsed.data.email,
    fullName: parsed.data.fullName,
    referenceNumber: out.referenceNumber,
    propertyName: out.propertyName,
    expectedMoveInDate: parsed.data.expectedMoveInDate,
  });

  res.status(201).json({
    referenceNumber: out.referenceNumber,
    status: out.status,
    propertyName: out.propertyName,
  });
}));

app.post('/api/public/applications/track', publicWriteLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.trackApplicationSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const result = await db.trackPublicApplication(parsed.data.referenceNumber, parsed.data.email);
  if (!result) return res.status(404).json({ error: 'No matching application found for that reference number and email.' });
  res.json(result);
}));

app.post('/api/public/reviews', publicWriteLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.reviewSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.createPublicReview(parsed.data);
  if (out.error === 'property_not_found') return res.status(404).json({ error: 'Property not found.' });
  if (out.error === 'duplicate') return res.status(409).json({ error: 'You have already submitted a review for this property.' });
  res.status(201).json({ message: 'Thanks! Your review has been submitted for approval.', status: 'Pending' });
}));

app.post('/api/public/testimonials', publicWriteLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.testimonialSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await db.createPublicTestimonial(parsed.data);
  res.status(201).json({ id: row.id, message: 'Thank you! Your testimonial is awaiting approval.' });
}));

app.post('/api/public/contact', publicWriteLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.contactSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (parsed.data.website && parsed.data.website.trim()) {
    // Honeypot triggered: silently succeed without saving spam.
    return res.status(201).json({ message: 'Message received. Our team will get back to you soon.' });
  }
  const msg = await db.createContactMessage(parsed.data);
  await db.logAudit({ action: 'CONTACT_SUBMIT', entityType: 'contact_message', entityId: msg.id, ipAddress: req.ip });
  res.status(201).json({ message: 'Message sent! Our Alangilan management office will reply soon.' });
}));

app.post('/api/public/viewings', publicWriteLimiter, attachOptionalUser, wrap(async (req, res) => {
  const parsed = V.validate(V.viewingRequestSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (parsed.data.website && parsed.data.website.trim()) {
    return res.status(201).json({ message: 'Viewing request received.' });
  }
  const row = await db.createViewingRequest(parsed.data, req.user?.id || null);
  if (!row) return res.status(404).json({ error: 'Property not found.' });
  await email.sendViewingConfirmation({
    to: parsed.data.email,
    fullName: parsed.data.fullName,
    propertyName: row.propertyName,
    preferredDate: parsed.data.preferredDate,
    preferredTime: parsed.data.preferredTime,
    status: 'Pending',
  });
  res.status(201).json({ message: 'Viewing request submitted! We will confirm your schedule shortly.', id: row.id });
}));

app.post('/api/public/waitlist', publicWriteLimiter, wrap(async (req, res) => {
  const parsed = V.validate(V.waitlistSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.joinWaitlist(parsed.data);
  if (!out) return res.status(404).json({ error: 'Property not found.' });
  if (out.alreadyWaiting) {
    return res.json({ message: `You are already on the waitlist for ${out.propertyName}.` });
  }
  res.status(201).json({ message: `Added to the waitlist for ${out.propertyName}. We'll email you when a bed opens!` });
}));

// ============================================================
// CUSTOMER ACCOUNT PORTAL ROUTES
// ============================================================
app.get('/api/customer/favorites', requireAuth, wrap(async (req, res) => {
  res.json(await db.listCustomerFavorites(req.user.id));
}));

app.post('/api/customer/favorites/:propertyId', requireAuth, wrap(async (req, res) => {
  const pid = Number(req.params.propertyId);
  if (!pid) return res.status(400).json({ error: 'Invalid property.' });
  res.json(await db.addFavorite(req.user.id, pid));
}));

app.delete('/api/customer/favorites/:propertyId', requireAuth, wrap(async (req, res) => {
  const pid = Number(req.params.propertyId);
  res.json(await db.removeFavorite(req.user.id, pid));
}));

app.get('/api/customer/applications', requireAuth, wrap(async (req, res) => {
  res.json(await db.listCustomerApplications(req.user.id, req.user.email));
}));

app.get('/api/customer/lease', requireAuth, wrap(async (req, res) => {
  res.json(await db.getCustomerLeaseAndPayments(req.user.id, req.user.email));
}));

app.get('/api/customer/maintenance', requireAuth, wrap(async (req, res) => {
  res.json(await db.listCustomerMaintenance(req.user.id));
}));

app.post('/api/customer/maintenance', requireAuth, wrap(async (req, res) => {
  const parsed = V.validate(V.maintenanceCreateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.createMaintenanceRequest(req.user.id, req.user.email, parsed.data);
  if (out.error === 'no_property') return res.status(400).json({ error: 'Please select a property or have an active lease.' });
  await db.logAudit({ userId: req.user.id, action: 'MAINTENANCE_CREATE', entityType: 'maintenance', entityId: out.request.id, ipAddress: req.ip });
  res.status(201).json(out.request);
}));

app.get('/api/customer/announcements', requireAuth, wrap(async (req, res) => {
  const leaseData = await db.getCustomerLeaseAndPayments(req.user.id, req.user.email);
  const activePropId = leaseData.tenants.find((t) => t.status === 'Active')?.propertyId || null;
  res.json(await db.listPublicAnnouncements(activePropId));
}));

// ============================================================
// IMAGE UPLOAD (VERCEL BLOB + MAGIC BYTES)
// ============================================================
app.post('/api/uploads/image', requireOwner, wrap(async (req, res) => {
  const { contentBase64 } = req.body || {};
  if (!contentBase64) return res.status(400).json({ error: 'Image payload is required.' });
  const buf = decodeBase64Payload(contentBase64);
  if (!buf.length || buf.length > MAX_UPLOAD_BYTES) {
    return res.status(400).json({ error: 'Image must be 2 MB or smaller.' });
  }
  const sig = detectFileSignature(buf, false);
  if (!sig) {
    return res.status(400).json({ error: 'Only valid JPG, PNG, or WEBP images are allowed.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({
      error: 'Vercel Blob upload is not configured (set BLOB_READ_WRITE_TOKEN) or enter an /images/... path.',
    });
  }
  const filename = `properties/${crypto.randomUUID()}.${sig.ext}`;
  const blob = await put(filename, buf, {
    access: 'public',
    contentType: sig.mime,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  await db.logAudit({ userId: req.user.id, action: 'IMAGE_UPLOAD', entityType: 'blob', details: { url: blob.url }, ipAddress: req.ip });
  res.status(201).json({ url: blob.url });
}));

// ============================================================
// OWNER / STAFF MANAGEMENT ROUTES (STRICT OWNER_ID SCOPING)
// ============================================================
app.get('/api/properties', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listOwnerProperties(req.ownerId));
}));

app.post('/api/properties', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.propertySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const ownerId = req.ownerId || 1;
  const p = await db.createProperty(ownerId, parsed.data);
  await db.logAudit({ userId: req.user.id, action: 'PROPERTY_CREATE', entityType: 'property', entityId: p.id, ipAddress: req.ip });
  res.status(201).json(p);
}));

app.put('/api/properties/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.propertySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const p = await db.updateProperty(req.ownerId, req.params.id, parsed.data);
  if (!p) return res.status(404).json({ error: 'Property not found.' });
  await db.logAudit({ userId: req.user.id, action: 'PROPERTY_UPDATE', entityType: 'property', entityId: p.id, ipAddress: req.ip });
  res.json(p);
}));

app.patch('/api/properties/:id/publish', requireAuth, requireOwner, wrap(async (req, res) => {
  const p = await db.togglePublishProperty(req.ownerId, req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found.' });
  await db.logAudit({ userId: req.user.id, action: 'PROPERTY_PUBLISH_TOGGLE', entityType: 'property', entityId: p.id, details: { isPublished: p.isPublished }, ipAddress: req.ip });
  res.json(p);
}));

app.delete('/api/properties/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const out = await db.archiveProperty(req.ownerId, req.params.id);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Property not found.' });
  if (out.error === 'active_tenants') return res.status(409).json({ error: 'Move out active tenants before archiving this property.' });
  await db.logAudit({ userId: req.user.id, action: 'PROPERTY_ARCHIVE', entityType: 'property', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Buildings ----------
app.get('/api/buildings', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listBuildings(req.ownerId));
}));

app.post('/api/buildings', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.buildingSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await db.createBuilding(req.ownerId, parsed.data);
  if (!row) return res.status(404).json({ error: 'Property not found.' });
  await db.logAudit({ userId: req.user.id, action: 'BUILDING_CREATE', entityType: 'building', entityId: row.id, ipAddress: req.ip });
  res.status(201).json(row);
}));

app.put('/api/buildings/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.buildingSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await db.updateBuilding(req.ownerId, req.params.id, parsed.data);
  if (!row) return res.status(404).json({ error: 'Building not found.' });
  await db.logAudit({ userId: req.user.id, action: 'BUILDING_UPDATE', entityType: 'building', entityId: row.id, ipAddress: req.ip });
  res.json(row);
}));

app.delete('/api/buildings/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const out = await db.deleteBuilding(req.ownerId, req.params.id);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Building not found.' });
  if (out.error === 'has_rooms') return res.status(409).json({ error: 'Archive rooms inside this building first.' });
  await db.logAudit({ userId: req.user.id, action: 'BUILDING_DELETE', entityType: 'building', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Rooms ----------
app.get('/api/rooms', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listRooms(req.ownerId));
}));

app.post('/api/rooms', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.roomSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.createRoom(req.ownerId, parsed.data);
  if (out.error === 'building_not_found') return res.status(404).json({ error: 'Building not found.' });
  if (out.error === 'duplicate') return res.status(409).json({ error: 'A room with this number already exists in the building.' });
  await db.logAudit({ userId: req.user.id, action: 'ROOM_CREATE', entityType: 'room', entityId: out.room.id, ipAddress: req.ip });
  res.status(201).json(out.room);
}));

app.put('/api/rooms/:id', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.roomSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.updateRoom(req.ownerId, req.params.id, parsed.data);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Room not found.' });
  if (out.error === 'capacity_low') return res.status(409).json({ error: 'Capacity cannot be less than currently occupied beds.' });
  await db.logAudit({ userId: req.user.id, action: 'ROOM_UPDATE', entityType: 'room', entityId: out.room.id, ipAddress: req.ip });
  if (out.bedOpened) await notifyWaitlistForProperty(out.propertyId, out.propertyName, out.room.roomNumber);
  res.json(out.room);
}));

app.delete('/api/rooms/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const out = await db.archiveRoom(req.ownerId, req.params.id);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Room not found.' });
  if (out.error === 'active_tenants') return res.status(409).json({ error: 'Move out active tenants before archiving this room.' });
  await db.logAudit({ userId: req.user.id, action: 'ROOM_ARCHIVE', entityType: 'room', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Tenants & Leases & Checklists ----------
app.get('/api/tenants', requireAuth, requireStaff, wrap(async (req, res) => {
  const list = await db.listTenants(req.ownerId);
  res.json(list.map((t) => formatTenantForRole(t, req.user.role)));
}));

app.post('/api/tenants/:id/reveal', requireAuth, requireStaff, wrap(async (req, res) => {
  const t = await db.getTenantById(req.ownerId, req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant not found.' });
  await db.logAudit({
    userId: req.user.id,
    action: 'PII_REVEAL',
    entityType: 'tenant',
    entityId: t.id,
    details: { fields: ['email', 'contactNumber'] },
    ipAddress: req.ip,
  });
  res.json({ id: t.id, email: t.email, contactNumber: t.contactNumber });
}));

app.post('/api/tenants', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.tenantSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.createTenant(req.ownerId, parsed.data);
  if (out.error === 'room_not_found') return res.status(404).json({ error: 'Room not found.' });
  if (out.error === 'maintenance') return res.status(409).json({ error: 'Room is under maintenance.' });
  if (out.error === 'room_full') return res.status(409).json({ error: 'Room has no available beds left.' });
  await db.logAudit({ userId: req.user.id, action: 'TENANT_CREATE', entityType: 'tenant', entityId: out.tenant.id, ipAddress: req.ip });
  res.status(201).json(formatTenantForRole(out.tenant, req.user.role));
}));

app.put('/api/tenants/:id', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.tenantSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const existing = await db.getTenantById(req.ownerId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tenant not found.' });
  // Staff cannot overwrite masked fields accidentally if left unchanged or blank.
  const payload = { ...parsed.data };
  if (req.user.role === 'staff') {
    payload.email = existing.email;
    payload.contactNumber = existing.contactNumber;
    payload.address = existing.address;
    payload.emergencyContact = existing.emergencyContact;
    payload.securityDeposit = existing.securityDeposit;
  }
  const out = await db.updateTenant(req.ownerId, req.params.id, payload);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Tenant not found.' });
  if (out.error === 'room_not_found') return res.status(404).json({ error: 'Room not found.' });
  if (out.error === 'maintenance') return res.status(409).json({ error: 'Room is under maintenance.' });
  if (out.error === 'room_full') return res.status(409).json({ error: 'Target room has no available beds.' });
  await db.logAudit({ userId: req.user.id, action: 'TENANT_UPDATE', entityType: 'tenant', entityId: out.tenant.id, ipAddress: req.ip });
  res.json(formatTenantForRole(out.tenant, req.user.role));
}));

app.post('/api/tenants/:id/move-out', requireAuth, requireStaff, wrap(async (req, res) => {
  const out = await db.moveOutTenant(req.ownerId, req.params.id);
  if (!out) return res.status(404).json({ error: 'Tenant not found.' });
  await db.logAudit({ userId: req.user.id, action: 'TENANT_MOVE_OUT', entityType: 'tenant', entityId: out.tenantId, ipAddress: req.ip });
  if (out.bedOpened) await notifyWaitlistForProperty(out.propertyId, out.propertyName, out.roomNumber);
  res.json(out);
}));

app.post('/api/tenants/:id/checklist', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.checklistSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const data = { ...parsed.data };
  if (req.user.role === 'staff') {
    delete data.depositDeductions;
    delete data.depositRefunded;
    delete data.depositRefundedAt;
  }
  const out = await db.saveTenantChecklist(req.ownerId, req.params.id, data);
  if (!out) return res.status(404).json({ error: 'Tenant not found.' });
  await db.logAudit({ userId: req.user.id, action: 'TENANT_CHECKLIST', entityType: 'tenant', entityId: Number(req.params.id), details: { type: data.type }, ipAddress: req.ip });
  res.json(out);
}));

app.delete('/api/tenants/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const out = await db.archiveTenant(req.ownerId, req.params.id);
  if (!out) return res.status(404).json({ error: 'Tenant not found.' });
  await db.logAudit({ userId: req.user.id, action: 'TENANT_ARCHIVE', entityType: 'tenant', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

app.get('/api/leases', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listLeases(req.ownerId));
}));

// ---------- Applications ----------
app.get('/api/applications', requireAuth, requireStaff, wrap(async (req, res) => {
  const list = await db.listApplications(req.ownerId);
  res.json(list.map((a) => formatAppForRole(a, req.user.role)));
}));

app.post('/api/applications/:id/reveal', requireAuth, requireStaff, wrap(async (req, res) => {
  const a = await db.getApplicationById(req.ownerId, req.params.id);
  if (!a) return res.status(404).json({ error: 'Application not found.' });
  await db.logAudit({
    userId: req.user.id,
    action: 'PII_REVEAL',
    entityType: 'application',
    entityId: a.id,
    details: { fields: ['email', 'contactNumber'] },
    ipAddress: req.ip,
  });
  res.json({ id: a.id, email: a.email, contactNumber: a.contactNumber });
}));

app.get('/api/applications/:id/document', requireAuth, requireOwner, wrap(async (req, res) => {
  const doc = await db.getApplicationDocument(req.ownerId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'No ID document attached to this application.' });
  await db.logAudit({ userId: req.user.id, action: 'APPLICATION_DOC_VIEW', entityType: 'application', entityId: Number(req.params.id), ipAddress: req.ip });
  const buf = Buffer.from(doc.contentBase64, 'base64');
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}));

app.delete('/api/applications/:id/document', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.deleteApplicationDocument(req.ownerId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Document not found.' });
  await db.logAudit({ userId: req.user.id, action: 'APPLICATION_DOC_DELETE', entityType: 'application', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

app.patch('/api/applications/:id/status', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.applicationStatusSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.updateApplicationStatus(req.ownerId, req.params.id, parsed.data);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Application not found.' });
  if (out.error === 'room_required') return res.status(400).json({ error: 'Assign a room before approving or reserving.' });
  if (out.error === 'room_not_found') return res.status(404).json({ error: 'Selected room does not belong to this property.' });
  if (out.error === 'room_unavailable') return res.status(409).json({ error: 'Room is under maintenance.' });
  if (out.error === 'insufficient_beds') return res.status(409).json({ error: out.detail || 'Not enough free beds in the assigned room.' });

  await db.logAudit({
    userId: req.user.id,
    action: 'APPLICATION_STATUS',
    entityType: 'application',
    entityId: Number(req.params.id),
    details: { status: parsed.data.status, assignedRoomId: parsed.data.assignedRoomId || null },
    ipAddress: req.ip,
  });

  await email.sendApplicationStatusEmail({
    to: out.application.email,
    fullName: out.application.fullName,
    referenceNumber: out.application.referenceNumber,
    propertyName: out.application.propertyName,
    status: out.application.status,
    roomNumber: out.application.roomNumber,
  });

  if (out.bedOpened) {
    await notifyWaitlistForProperty(out.application.propertyId, out.application.propertyName);
  }
  res.json(formatAppForRole(out.application, req.user.role));
}));

app.post('/api/applications/:id/convert', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.convertApplicationSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.convertApplicationToTenant(req.ownerId, req.params.id, parsed.data);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Application not found.' });
  if (out.error === 'already_converted') return res.status(409).json({ error: 'Application already converted to tenant.' });
  if (out.error === 'no_room') return res.status(400).json({ error: 'Assign an available room first.' });
  if (out.error === 'maintenance') return res.status(409).json({ error: 'Assigned room is under maintenance.' });
  if (out.error === 'room_full') return res.status(409).json({ error: 'Assigned room has no free beds.' });

  await db.logAudit({
    userId: req.user.id,
    action: 'APPLICATION_CONVERT',
    entityType: 'tenant',
    entityId: out.tenant.id,
    details: { applicationId: Number(req.params.id) },
    ipAddress: req.ip,
  });
  res.status(201).json(formatTenantForRole(out.tenant, req.user.role));
}));

app.delete('/api/applications/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const out = await db.archiveApplication(req.ownerId, req.params.id);
  if (!out) return res.status(404).json({ error: 'Application not found.' });
  await db.logAudit({ userId: req.user.id, action: 'APPLICATION_ARCHIVE', entityType: 'application', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Payments & Installment Transactions ----------
app.get('/api/payments', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listPayments(req.ownerId));
}));

app.post('/api/payments', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.paymentCreateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const out = await db.createPayment(req.ownerId, req.user.id, parsed.data);
  if (out.error === 'tenant_not_found') return res.status(404).json({ error: 'Tenant not found.' });
  if (out.error === 'duplicate') return res.status(409).json({ error: 'A payment bill already exists for this tenant and month.' });
  await db.logAudit({ userId: req.user.id, action: 'PAYMENT_CREATE', entityType: 'payment', entityId: out.payment.id, ipAddress: req.ip });
  res.status(201).json(out.payment);
}));

app.post('/api/payments/:id/transactions', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.transactionCreateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tx = await db.addPaymentTransaction(req.ownerId, req.params.id, req.user.id, parsed.data);
  if (!tx) return res.status(404).json({ error: 'Payment bill not found.' });
  await db.logAudit({
    userId: req.user.id,
    action: 'PAYMENT_TX_ADD',
    entityType: 'payment_transaction',
    entityId: tx.id,
    details: { paymentId: Number(req.params.id), amount: tx.amount, method: tx.paymentMethod },
    ipAddress: req.ip,
  });
  res.status(201).json(await db.getPaymentById(req.ownerId, req.params.id));
}));

app.put('/api/payment-transactions/:txId', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.transactionEditSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tx = await db.editPaymentTransaction(req.ownerId, req.params.txId, req.user.id, parsed.data);
  if (!tx) return res.status(404).json({ error: 'Transaction not found or already voided.' });
  await db.logAudit({
    userId: req.user.id,
    action: 'PAYMENT_TX_EDIT',
    entityType: 'payment_transaction',
    entityId: tx.id,
    details: { reason: parsed.data.reason, amount: parsed.data.amount },
    ipAddress: req.ip,
  });
  res.json(tx);
}));

app.post('/api/payment-transactions/:txId/void', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.transactionVoidSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tx = await db.voidPaymentTransaction(req.ownerId, req.params.txId, req.user.id, parsed.data.reason);
  if (!tx) return res.status(404).json({ error: 'Transaction not found or already voided.' });
  await db.logAudit({
    userId: req.user.id,
    action: 'PAYMENT_TX_VOID',
    entityType: 'payment_transaction',
    entityId: tx.id,
    details: { reason: parsed.data.reason },
    ipAddress: req.ip,
  });
  res.json(tx);
}));

app.delete('/api/payments/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.archivePayment(req.ownerId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Payment bill not found.' });
  await db.logAudit({ userId: req.user.id, action: 'PAYMENT_ARCHIVE', entityType: 'payment', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Expenses ----------
app.get('/api/expense-categories', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listExpenseCategories());
}));

app.get('/api/expenses', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listExpenses(req.ownerId));
}));

app.post('/api/expenses', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.expenseSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await db.createExpense(req.ownerId, parsed.data);
  if (!row) return res.status(404).json({ error: 'Property not found.' });
  await db.logAudit({ userId: req.user.id, action: 'EXPENSE_CREATE', entityType: 'expense', entityId: row.id, ipAddress: req.ip });
  res.status(201).json(row);
}));

app.put('/api/expenses/:id', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.expenseSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await db.updateExpense(req.ownerId, req.params.id, parsed.data);
  if (!row) return res.status(404).json({ error: 'Expense not found.' });
  await db.logAudit({ userId: req.user.id, action: 'EXPENSE_UPDATE', entityType: 'expense', entityId: row.id, ipAddress: req.ip });
  res.json(row);
}));

app.delete('/api/expenses/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.deleteExpense(req.ownerId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Expense not found.' });
  await db.logAudit({ userId: req.user.id, action: 'EXPENSE_DELETE', entityType: 'expense', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Reviews & Testimonials ----------
app.get('/api/reviews', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listReviews(req.ownerId));
}));

app.patch('/api/reviews/:id/status', requireAuth, requireStaff, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['Pending', 'Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const r = await db.updateReviewStatus(req.ownerId, req.params.id, status);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  await db.logAudit({ userId: req.user.id, action: 'REVIEW_STATUS', entityType: 'review', entityId: r.id, details: { status }, ipAddress: req.ip });
  res.json(r);
}));

app.post('/api/reviews/:id/reply', requireAuth, requireStaff, wrap(async (req, res) => {
  const reply = String(req.body?.ownerReply || '').trim();
  if (!reply || reply.length > 600) return res.status(400).json({ error: 'Reply (1–600 chars) is required.' });
  const r = await db.replyReview(req.ownerId, req.params.id, reply);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  await db.logAudit({ userId: req.user.id, action: 'REVIEW_REPLY', entityType: 'review', entityId: r.id, ipAddress: req.ip });
  res.json(r);
}));

app.delete('/api/reviews/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.deleteReview(req.ownerId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Review not found.' });
  await db.logAudit({ userId: req.user.id, action: 'REVIEW_DELETE', entityType: 'review', entityId: Number(req.params.id), ipAddress: req.ip });
  res.json({ ok: true });
}));

app.get('/api/testimonials', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listTestimonials(req.ownerId));
}));

app.patch('/api/testimonials/:id/status', requireAuth, requireOwner, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['Pending', 'Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const t = await db.updateTestimonialStatus(req.params.id, status);
  if (!t) return res.status(404).json({ error: 'Testimonial not found.' });
  res.json(t);
}));

app.delete('/api/testimonials/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.deleteTestimonial(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Testimonial not found.' });
  res.json({ ok: true });
}));

// ---------- Inbox: Messages, Viewings, Waitlist, Maintenance, Announcements ----------
app.get('/api/messages', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listMessages());
}));

app.patch('/api/messages/:id/status', requireAuth, requireStaff, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['New', 'Read', 'Replied'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const m = await db.updateMessageStatus(req.params.id, status);
  if (!m) return res.status(404).json({ error: 'Message not found.' });
  res.json(m);
}));

app.delete('/api/messages/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.deleteMessage(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
}));

app.get('/api/viewings', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listViewingRequests(req.ownerId));
}));

app.patch('/api/viewings/:id/status', requireAuth, requireStaff, wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['Pending', 'Confirmed', 'Completed', 'Cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const v = await db.updateViewingStatus(req.ownerId, req.params.id, status);
  if (!v) return res.status(404).json({ error: 'Viewing request not found.' });
  await email.sendViewingConfirmation({
    to: v.email,
    fullName: v.fullName,
    propertyName: v.propertyName,
    preferredDate: v.preferredDate,
    preferredTime: v.preferredTime,
    status,
  });
  res.json(v);
}));

app.get('/api/waitlist', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listWaitlist(req.ownerId));
}));

app.get('/api/maintenance', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listOwnerMaintenance(req.ownerId));
}));

app.patch('/api/maintenance/:id', requireAuth, requireStaff, wrap(async (req, res) => {
  const parsed = V.validate(V.maintenanceUpdateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const m = await db.updateMaintenanceRequest(req.ownerId, req.params.id, parsed.data);
  if (!m) return res.status(404).json({ error: 'Maintenance request not found.' });
  await db.logAudit({ userId: req.user.id, action: 'MAINTENANCE_UPDATE', entityType: 'maintenance', entityId: m.id, details: { status: m.status }, ipAddress: req.ip });
  res.json(m);
}));

app.get('/api/announcements', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.listOwnerAnnouncements(req.ownerId));
}));

app.post('/api/announcements', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.announcementSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await db.createAnnouncement(req.ownerId || 1, parsed.data);
  res.status(201).json(row);
}));

app.delete('/api/announcements/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const ok = await db.deleteAnnouncement(req.ownerId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Announcement not found.' });
  res.json({ ok: true });
}));

// ---------- Notifications, Settings, Audit Logs, Users ----------
app.get('/api/notifications', requireAuth, wrap(async (req, res) => {
  res.json(await db.listNotifications(req.user.id));
}));

app.patch('/api/notifications/:id/read', requireAuth, wrap(async (req, res) => {
  res.json(await db.markNotificationRead(req.user.id, req.params.id));
}));

app.get('/api/settings', requireAuth, requireOwner, wrap(async (req, res) => {
  res.json(await db.getSettings());
}));

app.put('/api/settings', requireAuth, requireOwner, wrap(async (req, res) => {
  const parsed = V.validate(V.settingsSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const updated = await db.updateSettings(parsed.data);
  await db.logAudit({ userId: req.user.id, action: 'SETTINGS_UPDATE', entityType: 'site_settings', ipAddress: req.ip });
  res.json(updated);
}));

app.get('/api/audit-logs', requireAuth, requireOwner, wrap(async (req, res) => {
  const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 100));
  res.json(await db.listAuditLogs(req.ownerId, limit));
}));

app.get('/api/users', requireAuth, requireAdmin, wrap(async (req, res) => {
  const users = await db.listUsers();
  res.json(users.map((u) => safeUserDto(u)));
}));

app.post('/api/users', requireAuth, requireAdmin, wrap(async (req, res) => {
  const parsed = V.validate(V.userCreateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (await db.findUserByEmail(parsed.data.email)) {
    return res.status(409).json({ error: 'Email already exists.' });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
  const created = await db.createUser({
    ...parsed.data,
    passwordHash,
    ownerId: parsed.data.role === 'staff' ? 1 : null,
  });
  await db.logAudit({ userId: req.user.id, action: 'USER_CREATE', entityType: 'user', entityId: created.id, details: { role: created.role }, ipAddress: req.ip });
  res.status(201).json(safeUserDto(created));
}));

// ---------- Dashboard & Financial Reports ----------
app.get('/api/dashboard/summary', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.getDashboardSummary(req.ownerId, getDateRange(req.query)));
}));

app.get('/api/reports/financial', requireAuth, requireStaff, wrap(async (req, res) => {
  res.json(await db.getFinancialReport(req.ownerId, getDateRange(req.query)));
}));

// ---------- Demo Reset (DISABLED IN PRODUCTION) ----------
app.post('/api/demo/reset', requireAuth, requireOwner, wrap(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Demo reset is disabled in production.' });
  }
  if (db.isPostgres()) {
    return res.status(400).json({ error: 'Postgres database should only be seeded via CLI scripts (npm run db:seed).' });
  }
  await db.resetDemo();
  await db.logAudit({ userId: req.user.id, action: 'DEMO_RESET', entityType: 'system', ipAddress: req.ip });
  res.json({ ok: true });
}));

// ---------- Daily Scheduled Job (Vercel Cron) ----------
app.get('/api/cron/daily', wrap(async (req, res) => {
  const expected = process.env.CRON_SECRET;
  const authHdr = req.get('authorization') || '';
  const provided = authHdr.startsWith('Bearer ') ? authHdr.slice(7).trim() : req.get('x-cron-secret') || '';
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized cron invocation.' });
  }

  const out = await db.runDailyCron();
  await Promise.all([
    ...out.upcomingReminders.map((r) => email.sendRentReminderEmail(r)),
    ...out.overdueReminders.map((r) => email.sendRentReminderEmail(r)),
    ...out.freedProperties.map((p) => notifyWaitlistForProperty(p.propertyId, p.propertyName)),
  ]);

  await db.logAudit({
    action: 'CRON_DAILY',
    entityType: 'system',
    details: {
      expiredReservations: out.expiredReservations,
      upcomingSent: out.upcomingReminders.length,
      overdueSent: out.overdueReminders.length,
      leaseAlertsCreated: out.leaseAlertsCreated,
    },
    ipAddress: req.ip,
  });

  res.json({
    ok: true,
    expiredReservations: out.expiredReservations,
    upcomingReminders: out.upcomingReminders.length,
    overdueReminders: out.overdueReminders.length,
    leaseAlertsCreated: out.leaseAlertsCreated,
  });
}));

// ============================================================
// STATIC FILES, 404 & ERROR HANDLER
// ============================================================
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).sendFile(path.join(publicDir, '404.html'));
  }
  res.status(404).json({ error: 'Not found.' });
});

app.use((err, req, res, _next) => {
  if (err && err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload is too large (max 4 MB).' });
  }
  console.error('[server error]', err?.message || err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

module.exports = app;
module.exports.getJwtSecret = getJwtSecret;
