const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret-value';

const app = require('../server/app');
const db = require('../server/db');

function extractCookie(res, name) {
  const cookies = res.headers['set-cookie'] || [];
  for (const c of cookies) {
    if (c.startsWith(name + '=')) {
      return c.split(';')[0].slice(name.length + 1);
    }
  }
  return '';
}

test.describe('CasaBatangueño API & Security Suite', async () => {
  const pass = 'Str0ngT3st!Pass';
  const passHash = await bcrypt.hash(pass, 10);

  let ownerUser, owner2User, staffUser;

  test.before(async () => {
    await db.resetDemo();
    ownerUser = await db.createUser({
      fullName: 'Test Owner One',
      email: 'test-owner1@casa-bat.local',
      passwordHash: passHash,
      role: 'owner',
      ownerId: 1,
      phone: '+63 917 000 0001',
    });
    // Ensure owner1 has access to seeded ownerId=1 properties for test assertions
    ownerUser.ownerId = 1;

    owner2User = await db.createUser({
      fullName: 'Test Owner Two',
      email: 'test-owner2@casa-bat.local',
      passwordHash: passHash,
      role: 'owner',
      phone: '+63 917 000 0002',
    });

    staffUser = await db.createUser({
      fullName: 'Test Staff One',
      email: 'test-staff1@casa-bat.local',
      passwordHash: passHash,
      role: 'staff',
      ownerId: 1,
      phone: '+63 917 000 0003',
    });
  });

  test('Health check and public properties never leak PII or passwords', async () => {
    const h = await request(app).get('/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.ok, true);

    const res = await request(app).get('/api/public/properties');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body) && res.body.length > 0);
    for (const p of res.body) {
      assert.equal(p.passwordHash, undefined);
      assert.ok(typeof p.monthlyPrice === 'number');
    }
  });

  test('Customer registration, httpOnly cookie + CSRF enforcement, data export, and account deletion', async () => {
    const agent = request.agent(app);
    const email = `resident-${Date.now()}@example.edu`;

    const reg = await agent.post('/api/auth/register').send({
      fullName: 'Maria Test Resident',
      email,
      password: pass,
      phone: '09171234567',
      consentAccepted: true,
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.token, undefined, 'JWT should not be returned for localStorage');
    const csrf = reg.body.csrfToken || extractCookie(reg, 'cb_csrf');
    assert.ok(csrf);

    // State-changing call with session cookie but missing X-CSRF-Token must fail with 403
    const badFav = await agent.post('/api/customer/favorites/1').send({});
    assert.equal(badFav.status, 403);

    // With X-CSRF-Token succeeds
    const goodFav = await agent.post('/api/customer/favorites/1').set('X-CSRF-Token', csrf).send({});
    assert.equal(goodFav.status, 200);

    const exp = await agent.get('/api/auth/my-data');
    assert.equal(exp.status, 200);
    assert.equal(exp.body.profile.email, email);
    assert.equal(exp.body.favorites.length, 1);

    const del = await agent
      .post('/api/auth/delete-account')
      .set('X-CSRF-Token', csrf)
      .send({ password: pass });
    assert.equal(del.status, 200);

    const after = await agent.get('/api/auth/me');
    assert.equal(after.status, 401);
  });

  test('Account lockout triggers 423 after 5 failed login attempts', async () => {
    const lockEmail = `lock-${Date.now()}@example.com`;
    await db.createUser({
      fullName: 'Lock Target',
      email: lockEmail,
      passwordHash: passHash,
      role: 'customer',
    });

    for (let i = 0; i < 4; i++) {
      const r = await request(app).post('/api/auth/login').send({ email: lockEmail, password: 'WrongPassword123' });
      assert.equal(r.status, 401);
    }
    const fifth = await request(app).post('/api/auth/login').send({ email: lockEmail, password: 'WrongPassword123' });
    assert.equal(fifth.status, 423);

    // Even correct password is blocked while locked
    const blocked = await request(app).post('/api/auth/login').send({ email: lockEmail, password: pass });
    assert.equal(blocked.status, 423);
  });

  test('Owner isolation prevents Owner #2 from seeing Owner #1 properties or tenants', async () => {
    const agent2 = request.agent(app);
    const login2 = await agent2.post('/api/auth/login').send({ email: owner2User.email, password: pass });
    assert.equal(login2.status, 200);

    const props2 = await agent2.get('/api/properties');
    assert.equal(props2.status, 200);
    assert.equal(props2.body.length, 0);

    const tenants2 = await agent2.get('/api/tenants');
    assert.equal(tenants2.status, 200);
    assert.equal(tenants2.body.length, 0);
  });

  test('Staff sees masked tenant PII and Reveal logs an audit event', async () => {
    const staffAgent = request.agent(app);
    const loginS = await staffAgent.post('/api/auth/login').send({ email: staffUser.email, password: pass });
    assert.equal(loginS.status, 200);
    const csrfS = loginS.body.csrfToken;

    const tenants = await staffAgent.get('/api/tenants');
    assert.equal(tenants.status, 200);
    assert.ok(tenants.body.length > 0);
    const t0 = tenants.body[0];
    assert.equal(t0.masked, true);
    assert.ok(t0.email.includes('***'));
    assert.ok(t0.contactNumber.includes('***'));
    assert.equal(t0.address, undefined);
    assert.equal(t0.emergencyContact, undefined);
    assert.equal(t0.securityDeposit, undefined);

    // Staff cannot access audit logs or settings
    const forbiddenAudit = await staffAgent.get('/api/audit-logs');
    assert.equal(forbiddenAudit.status, 403);

    // Reveal contact PII
    const rev = await staffAgent.post(`/api/tenants/${t0.id}/reveal`).set('X-CSRF-Token', csrfS).send({});
    assert.equal(rev.status, 200);
    assert.ok(!rev.body.email.includes('***'));

    // Verify Owner can inspect PII_REVEAL in audit logs
    const ownerAgent = request.agent(app);
    const loginO = await ownerAgent.post('/api/auth/login').send({ email: 'owner@casa-bat.com', password: 'WrongPasswordIgnored' });
    assert.equal(loginO.status, 401);

    const adminAgent = request.agent(app);
    const adminUser = await db.createUser({
      fullName: 'Audit Checker Admin',
      email: `audit-admin-${Date.now()}@casa-bat.local`,
      passwordHash: passHash,
      role: 'admin',
    });
    const loginA = await adminAgent.post('/api/auth/login').send({ email: adminUser.email, password: pass });
    assert.equal(loginA.status, 200);
    const logs = await adminAgent.get('/api/audit-logs');
    assert.equal(logs.status, 200);
    assert.ok(logs.body.some((l) => l.action === 'PII_REVEAL' && l.entityId === t0.id));
  });

  test('Public application blocks duplicates, holds dorm beds on reserve, converts with required fields, and releases on reject', async () => {
    const adminAgent = request.agent(app);
    const adminUser = await db.createUser({
      fullName: 'Ops Admin',
      email: `ops-admin-${Date.now()}@casa-bat.local`,
      passwordHash: passHash,
      role: 'admin',
    });
    const l = await adminAgent.post('/api/auth/login').send({ email: adminUser.email, password: pass });
    const csrf = l.body.csrfToken;

    // Pick a 4-bed dorm room with free beds
    const roomsRes = await adminAgent.get('/api/rooms');
    const dormRoom = roomsRes.body.find((r) => r.capacity >= 4 && r.availableBeds >= 2);
    assert.ok(dormRoom, 'Expected a dorm room with >= 2 free beds');
    const initialFree = dormRoom.availableBeds;

    const appEmail = `applicant-${Date.now()}@example.edu`;
    const sub1 = await request(app).post('/api/public/applications').send({
      propertyId: dormRoom.propertyId,
      fullName: 'Dorm Applicant',
      email: appEmail,
      contactNumber: '09178889999',
      preferredRoomType: 'Dormitory',
      expectedMoveInDate: '2026-12-01',
      occupants: 2,
      consentAccepted: true,
    });
    assert.equal(sub1.status, 201);
    assert.ok(sub1.body.referenceNumber.startsWith('APP-'));

    // Duplicate active application for same property & email must be rejected
    const dup = await request(app).post('/api/public/applications').send({
      propertyId: dormRoom.propertyId,
      fullName: 'Dorm Applicant',
      email: appEmail,
      contactNumber: '09178889999',
      expectedMoveInDate: '2026-12-01',
      occupants: 1,
      consentAccepted: true,
    });
    assert.equal(dup.status, 409);

    // Tracking endpoint returns status without leaking personal data
    const trk = await request(app).post('/api/public/applications/track').send({
      referenceNumber: sub1.body.referenceNumber,
      email: appEmail,
    });
    assert.equal(trk.status, 200);
    assert.equal(trk.body.status, 'Pending');
    assert.equal(trk.body.contactNumber, undefined);

    // Reserve holds 2 beds
    const appsList = await adminAgent.get('/api/applications');
    const appRow = appsList.body.find((a) => a.referenceNumber === sub1.body.referenceNumber);
    const resv = await adminAgent
      .patch(`/api/applications/${appRow.id}/status`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'Reserved', assignedRoomId: dormRoom.id });
    assert.equal(resv.status, 200);

    const roomsAfterHold = await adminAgent.get('/api/rooms');
    const updatedRoom = roomsAfterHold.body.find((r) => r.id === dormRoom.id);
    assert.equal(updatedRoom.availableBeds, initialFree - 2);

    // Rejecting releases the 2 held beds
    const rej = await adminAgent
      .patch(`/api/applications/${appRow.id}/status`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'Rejected' });
    assert.equal(rej.status, 200);

    const roomsAfterRelease = await adminAgent.get('/api/rooms');
    assert.equal(roomsAfterRelease.body.find((r) => r.id === dormRoom.id).availableBeds, initialFree);
  });

  test('Installment payments, staff add-only vs owner void with reason, and dual financial reporting', async () => {
    const adminUser = await db.createUser({
      fullName: 'Finance Admin',
      email: `fin-admin-${Date.now()}@casa-bat.local`,
      passwordHash: passHash,
      role: 'admin',
    });
    const adminAgent = request.agent(app);
    const l = await adminAgent.post('/api/auth/login').send({ email: adminUser.email, password: pass });
    const csrf = l.body.csrfToken;

    const staffAgent = request.agent(app);
    const ls = await staffAgent.post('/api/auth/login').send({ email: staffUser.email, password: pass });
    const csrfS = ls.body.csrfToken;

    // Create a bill for an active tenant
    const tenantsRes = await adminAgent.get('/api/tenants');
    const activeT = tenantsRes.body.find((t) => t.status === 'Active');
    const bill = await adminAgent
      .post('/api/payments')
      .set('X-CSRF-Token', csrf)
      .send({ tenantId: activeT.id, billingMonth: '2026-12', amountDue: 5000, initialAmountPaid: 0 });
    assert.equal(bill.status, 201);
    assert.equal(bill.body.remainingBalance, 5000);

    // Staff adds a partial installment of 2000
    const txRes = await staffAgent
      .post(`/api/payments/${bill.body.id}/transactions`)
      .set('X-CSRF-Token', csrfS)
      .send({ amount: 2000, paymentMethod: 'GCash', paymentDate: '2026-11-25' });
    assert.equal(txRes.status, 201);
    assert.equal(txRes.body.amountPaid, 2000);
    assert.equal(txRes.body.remainingBalance, 3000);
    assert.equal(txRes.body.status, 'Partial');

    const txId = txRes.body.transactions[0].id;
    // Staff CANNOT void transactions
    const staffVoid = await staffAgent
      .post(`/api/payment-transactions/${txId}/void`)
      .set('X-CSRF-Token', csrfS)
      .send({ reason: 'Should not succeed' });
    assert.equal(staffVoid.status, 403);

    // Admin/Owner CAN void with reason
    const ownerVoid = await adminAgent
      .post(`/api/payment-transactions/${txId}/void`)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'Entered wrong bill' });
    assert.equal(ownerVoid.status, 200);

    const rep = await adminAgent.get('/api/reports/financial?range=all');
    assert.equal(rep.status, 200);
    assert.ok(Array.isArray(rep.body.byDueMonth));
    assert.ok(Array.isArray(rep.body.byPaymentDate));
  });

  test('Daily cron requires CRON_SECRET and executes cleanly', async () => {
    const unauth = await request(app).get('/api/cron/daily');
    assert.equal(unauth.status, 401);

    const ok = await request(app)
      .get('/api/cron/daily')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
  });
});
