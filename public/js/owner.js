/* owner.js - private dashboard: login, navigation, dashboard charts, CRUD tables, reports.
   Each management page is described by a small config object (CFG) so the same
   table/form code is reused. */
const app = $('#app');
let user = null, D = {}, section = 'dashboard', charts = [];
let rangeState = { range: 'year', start: '', end: '' };
const TYPES = ['Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room'];
const METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'];
const CATEGORIES = ['Electricity', 'Water', 'Internet', 'Maintenance', 'Repairs', 'Cleaning', 'Supplies', 'Employee Salary', 'Taxes', 'Other Expenses'];
const canDelete = () => user && user.role !== 'staff';

function onSessionExpired() { localStorage.removeItem(TOKEN_KEY); user = null; showLogin('Session expired. Please log in again.'); }

// ---------- lookups ----------
const find = (list, id) => (D[list] || []).find((x) => x.id === Number(id));
const propName = (id) => (find('properties', id) || {}).name || '—';
const tenantName = (id) => (find('tenants', id) || {}).fullName || '—';
const roomLabel = (id) => { const r = find('rooms', id); return r ? `${r.roomNumber} (${propName(r.propertyId)})` : '—'; };
const opts = (list, label) => () => D[list].map((x) => [x.id, label(x)]);

// ---------- login ----------
function showLogin(msg = '') {
  app.innerHTML = `<div class="login-wrap"><form class="login" id="loginForm">
    <a class="logo" href="/" style="display:block;margin-bottom:6px">Casa<span>Batangueño</span></a>
    <h2>Owner Portal</h2><p class="muted">${esc(msg) || 'Sign in to manage your properties.'}</p>
    <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username"></div>
    <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn" style="width:100%;justify-content:center">Log in</button>
    <p style="text-align:center;margin-bottom:0"><a href="/">← Back to public site</a></p></form></div>`;
  $$('[data-fill]').forEach((b) => (b.onclick = () => {
    const [e, p] = b.dataset.fill.split('|'); $('[name=email]').value = e; $('[name=password]').value = p;
  }));
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      localStorage.setItem(TOKEN_KEY, r.token); user = r.user; await startShell();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- shell ----------
const NAV = [
  ['dashboard', 'Dashboard'], ['properties', 'Properties', 'owner'], ['buildings', 'Buildings', 'owner'],
  ['rooms', 'Rooms'], ['tenants', 'Tenants'], ['applications', 'Applications'], ['reviews', 'Reviews'],
  ['messages', 'Messages'], ['payments', 'Payments'], ['expenses', 'Expenses'], ['reports', 'Reports'],
  ['users', 'Users', 'admin'],
];
const navAllowed = (n) => !n[2] || (n[2] === 'owner' ? user.role !== 'staff' : user.role === n[2]);

async function loadAll() {
  const keys = ['properties', 'buildings', 'rooms', 'tenants', 'applications', 'reviews', 'messages', 'payments', 'expenses'];
  const res = await Promise.all(keys.map((k) => api('/' + k)));
  keys.forEach((k, i) => (D[k] = res[i]));
  if (user.role === 'admin') D.users = await api('/users');
}

async function startShell() {
  await loadAll();
  app.innerHTML = `<div class="shell"><aside class="side" id="side"><a class="logo" href="/">Casa<span>Batangueño</span></a>
   ${NAV.filter(navAllowed).map((n) => `<button data-go="${n[0]}">${n[1]}</button>`).join('')}
    <button data-go="__site">Public site</button></aside>
    <div class="main"><div class="top no-print"><button class="btn ghost sm menu-btn" id="menu">☰</button>
      <strong id="title"></strong><div class="who"><span class="badge b-info">${esc(user.role)}</span><span>${esc(user.fullName)}</span>
      ${user.role !== 'staff' ? '<button class="btn ghost sm" id="reset">Reset demo data</button>' : ''}<button class="btn ghost sm" id="logout">Log out</button></div></div>
    <div id="view"></div></div></div>`;
  $('#side').onclick = (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === '__site') location.href = '/'; else go(b.dataset.go);
    $('#side').classList.remove('open');
  };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = () => { localStorage.removeItem(TOKEN_KEY); user = null; showLogin('You have been logged out.'); };
  const rs = $('#reset');
  if (rs) rs.onclick = async () => {
    if (!confirm('Restore the original demo data? Your changes will be lost.')) return;
    await api('/demo/reset', { method: 'POST' }); await loadAll(); go(section); toast('Demo data restored.');
  };
  go(section);
}

function go(name) {
  section = name;
  charts.forEach((c) => c.destroy()); charts = [];
  $$('[data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
 $('#title').textContent = (NAV.find((n) => n[0] === name) || [])[1] || '';
  const view = $('#view');
  if (name === 'dashboard') return renderDashboard(view);
  if (name === 'reports') return renderReports(view);
  renderTable(view, CFG[name]);
}
async function refresh() { await loadAll(); go(section); }

// ---------- generic table + form ----------
const tableState = {};
function renderTable(view, cfg) {
  const st = (tableState[cfg.key] ||= { q: '', f: {} });
  const rows = D[cfg.key].filter((r) => {
    if (st.q && !JSON.stringify(Object.values(r)).toLowerCase().includes(st.q.toLowerCase()) && !(cfg.search && cfg.search(r).toLowerCase().includes(st.q.toLowerCase()))) return false;
    return (cfg.filters || []).every((f) => !st.f[f.key] || String(f.get ? f.get(r) : r[f.key]) === st.f[f.key]);
  });
  const filters = (cfg.filters || []).map((f) => `<select data-filter="${f.key}"><option value="">${esc(f.label)}</option>${f.options().map(([v, l]) =>
    `<option value="${esc(v)}" ${String(st.f[f.key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`).join('');
  view.innerHTML = `<div class="head"><h2>${cfg.title}</h2><div class="tools">
    <input type="search" id="q" placeholder="Search…" value="${esc(st.q)}">${filters}
    ${cfg.add ? `<button class="btn" id="add">+ Add ${cfg.single}</button>` : ''}</div></div>
    <div class="panel scroll"><table class="dt"><thead><tr>${cfg.cols.map((c) => `<th>${c[0]}</th>`).join('')}<th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>${cfg.cols.map((c) => `<td>${c[1](r)}</td>`).join('')}<td>${(cfg.actions || []).filter((a) => !a.show || a.show(r))
      .map((a) => `<button class="btn sm ${a.cls || 'ghost'}" data-act="${a.key}" data-id="${r.id}">${a.label}</button>`).join('')}</td></tr>`).join('')
      || `<tr><td colspan="${cfg.cols.length + 1}" class="empty">Nothing here yet.</td></tr>`}</tbody></table></div>`;
  const q = $('#q', view);
  q.oninput = () => { st.q = q.value; const pos = q.selectionStart; renderTable(view, cfg); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('[data-filter]', view).forEach((s) => (s.onchange = () => { st.f[s.dataset.filter] = s.value; renderTable(view, cfg); }));
  if (cfg.add) $('#add', view).onclick = () => openForm(cfg);
  view.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const row = find(cfg.key, b.dataset.id);
    cfg.actions.find((a) => a.key === b.dataset.act).run(row).catch((x) => toast(x.message, true));
  };
}

function openForm(cfg, row = null) {
  const fields = cfg.fields.filter((f) => !(row && f.createOnly));
  const val = (f) => { const v = row ? (f.get ? f.get(row) : row[f.name]) : f.def; return v ?? ''; };
  const input = (f) => {
    const v = val(f), req = f.required ? 'required' : '';
    if (f.type === 'select') return `<select name="${f.name}" ${req}><option value="">Select…</option>${(f.options ? f.options() : f.list.map((x) => [x, x])).map(([o, l]) =>
      `<option value="${esc(o)}" ${String(o) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<textarea name="${f.name}" rows="3">${esc(v)}</textarea>`;
    if (f.type === 'checkbox') return `<input type="checkbox" name="${f.name}" style="width:auto" ${v === '' ? 'checked' : v ? 'checked' : ''}>`;
    return `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req} ${f.step ? `step="${f.step}"` : ''} ${f.type === 'number' ? 'min="0"' : ''}>`;
  };
  const m = openModal(`<div class="modal-head"><h2>${row ? 'Edit' : 'Add'} ${cfg.single}</h2><button class="x" data-close>×</button></div>
    <form id="crud"><div class="grid2">${fields.map((f) => `<div class="field" ${f.full ? 'style="grid-column:1/-1"' : ''}><label>${f.label}${f.required ? ' *' : ''}</label>${input(f)}</div>`).join('')}</div>
    <button class="btn">Save</button> <button type="button" class="btn ghost" data-close>Cancel</button></form>`);
  $('#crud', m).onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    fields.forEach((f) => { const el = e.target.elements[f.name]; body[f.name] = f.type === 'checkbox' ? el.checked : el.value; });
    try {
      await api(`/${cfg.key}${row ? '/' + row.id : ''}`, { method: row ? 'PUT' : 'POST', body });
      m.remove(); toast(cfg.single + ' saved.'); await refresh();
    } catch (err) { toast(err.message, true); }
  };
}
const editAct = (cfg) => ({ key: 'edit', label: 'Edit', run: async (r) => openForm(CFG[cfg], r) });
const deleteAct = (key, label) => ({
  key: 'del', label: 'Delete', cls: 'danger', show: canDelete,
  run: async (r) => { if (!confirm(`Delete this ${label}? This cannot be undone.`)) return; await api(`/${key}/${r.id}`, { method: 'DELETE' }); toast('Deleted.'); await refresh(); },
});

// ---------- module configs ----------
const CFG = {
  properties: {
    key: 'properties', title: 'Properties', single: 'Property', add: true,
    filters: [{ key: 'propertyType', label: 'All types', options: () => TYPES.map((t) => [t, t]) }],
    cols: [['Name', (r) => `<b>${esc(r.name)}</b>`], ['Type', (r) => esc(r.propertyType)], ['City', (r) => esc(r.city)], ['Price', (r) => money(r.monthlyPrice)],
      ['Rooms free', (r) => `${r.availableRoomsCount}/${r.totalRoomsCount}`], ['Public', (r) => badge(r.isPublished ? 'Active' : 'Cancelled').replace('Active', 'Published').replace('Cancelled', 'Hidden')]],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'propertyType', label: 'Type', type: 'select', list: TYPES, required: true },
      { name: 'address', label: 'Address', required: true }, { name: 'city', label: 'City', def: 'Batangas City' },
      { name: 'latitude', label: 'Latitude', type: 'number', step: 'any', def: 13.7845 }, { name: 'longitude', label: 'Longitude', type: 'number', step: 'any', def: 121.0735 },
      { name: 'monthlyPrice', label: 'Starting monthly price (₱)', type: 'number', required: true }, { name: 'contactPhone', label: 'Contact phone' },
      { name: 'contactEmail', label: 'Contact email', type: 'email' }, { name: 'isPublished', label: 'Published on public site', type: 'checkbox' },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'locationAccess', label: 'Location & transit access (walk time to highway / shops)', full: true },
      { name: 'nearbyPlaces', label: 'Nearby places (Alfamart, eateries, jeepneys)', type: 'textarea', full: true },
      { name: 'depositPolicy', label: 'Deposit & advance payment policy', type: 'textarea', full: true },
      { name: 'utilitiesPolicy', label: 'Utilities included / excluded', type: 'textarea', full: true },
      { name: 'inclusions', label: 'Room & unit inclusions (furniture, appliances)', type: 'textarea', full: true },
      { name: 'curfewPolicy', label: 'Curfew & visitor policy', type: 'textarea', full: true },
      { name: 'amenities', label: 'Amenities (one per line)', type: 'textarea', full: true, get: (r) => r.amenities.join('\n') },
      { name: 'houseRules', label: 'House rules (one per line)', type: 'textarea', full: true, get: (r) => r.houseRules.join('\n') },
      { name: 'images', label: 'Image URLs (one per line, e.g. /images/…png)', type: 'textarea', full: true, get: (r) => r.images.join('\n') },
    ],
    actions: [editAct('properties'),
      { key: 'pub', label: 'Publish/Hide', run: async (r) => { await api(`/properties/${r.id}/publish`, { method: 'PATCH' }); await refresh(); } },
      deleteAct('properties', 'property')],
  },
  buildings: {
    key: 'buildings', title: 'Buildings', single: 'Building', add: true,
    filters: [{ key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) }],
    cols: [['Building', (r) => `<b>${esc(r.name)}</b>`], ['Property', (r) => esc(propName(r.propertyId))], ['Floors', (r) => r.floors], ['Description', (r) => esc(r.description)]],
    fields: [{ name: 'propertyId', label: 'Property', type: 'select', options: opts('properties', (p) => p.name), required: true, createOnly: true },
      { name: 'name', label: 'Name', required: true }, { name: 'floors', label: 'Floors', type: 'number', def: 1 }, { name: 'description', label: 'Description', full: true }],
    actions: [editAct('buildings'), deleteAct('buildings', 'building')],
  },
  rooms: {
    key: 'rooms', title: 'Rooms', single: 'Room', add: true,
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Available', 'Occupied', 'Reserved', 'Maintenance'].map((s) => [s, s]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) }],
    cols: [['Room', (r) => `<b>${esc(r.roomNumber)}</b>`], ['Property', (r) => esc(propName(r.propertyId))], ['Building', (r) => esc(r.buildingName)], ['Floor', (r) => r.floorNumber],
      ['Type', (r) => esc(r.roomType)], ['Beds', (r) => `${r.occupiedBeds}/${r.capacity}`], ['Price', (r) => money(r.monthlyPrice)], ['Status', (r) => badge(r.status)]],
    fields: [{ name: 'buildingId', label: 'Building', type: 'select', options: opts('buildings', (b) => `${propName(b.propertyId)} — ${b.name}`), required: true },
      { name: 'roomNumber', label: 'Room number', required: true }, { name: 'floorNumber', label: 'Floor', type: 'number', def: 1 },
      { name: 'roomType', label: 'Room type', type: 'select', list: TYPES, required: true }, { name: 'capacity', label: 'Capacity (beds)', type: 'number', def: 1, required: true },
      { name: 'monthlyPrice', label: 'Monthly price (₱)', type: 'number', required: true },
      { name: 'status', label: 'Status', type: 'select', list: ['Available', 'Maintenance'], def: 'Available' }, { name: 'description', label: 'Description', full: true }],
    actions: [editAct('rooms'), deleteAct('rooms', 'room')],
  },
  tenants: {
    key: 'tenants', title: 'Tenants', single: 'Tenant', add: true,
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Active', 'Pending', 'Inactive', 'Former Tenant'].map((s) => [s, s]) }],
    cols: [['Name', (r) => `<b>${esc(r.fullName)}</b>`], ['Contact', (r) => esc(r.contactNumber)], ['Property', (r) => esc(propName(r.propertyId))], ['Room', (r) => esc((find('rooms', r.roomId) || {}).roomNumber || '—')],
      ['Move-in', (r) => esc(r.moveInDate)], ['Rent', (r) => money(r.monthlyRent)], ['Status', (r) => badge(r.status)]],
    fields: [{ name: 'fullName', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'contactNumber', label: 'Contact number', required: true },
      { name: 'address', label: 'Home address' }, { name: 'emergencyContact', label: 'Emergency contact', full: true },
      { name: 'roomId', label: 'Room', type: 'select', options: opts('rooms', (r) => `${r.roomNumber} — ${propName(r.propertyId)} (${r.availableBeds} free)`), required: true },
      { name: 'moveInDate', label: 'Move-in date', type: 'date', required: true, def: new Date().toISOString().slice(0, 10) },
      { name: 'monthlyRent', label: 'Monthly rent (₱)', type: 'number' }, { name: 'securityDeposit', label: 'Security deposit (₱)', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', list: ['Active', 'Pending', 'Inactive', 'Former Tenant'], def: 'Active' }],
    actions: [editAct('tenants'),
      { key: 'hist', label: 'Payments', run: async (r) => {
        const p = D.payments.filter((x) => x.tenantId === r.id);
        openModal(`<div class="modal-head"><h2>${esc(r.fullName)} — payment history</h2><button class="x" data-close>×</button></div>
          <p class="muted">Move-in ${esc(r.moveInDate)}${r.moveOutDate ? ' · Move-out ' + esc(r.moveOutDate) : ''}</p><div class="scroll"><table class="dt"><tr><th>Month</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr>
          ${p.map((x) => `<tr><td>${x.billingMonth}</td><td>${money(x.amountDue)}</td><td>${money(x.amountPaid)}</td><td>${money(x.remainingBalance)}</td><td>${badge(x.status)}</td></tr>`).join('') || '<tr><td colspan=5 class="empty">No payments yet.</td></tr>'}</table></div>`);
      } },
      { key: 'out', label: 'Move out', show: (r) => r.status === 'Active', run: async (r) => { if (!confirm('Record move-out for ' + r.fullName + '?')) return; await api(`/tenants/${r.id}/move-out`, { method: 'POST' }); toast('Move-out recorded.'); await refresh(); } },
      deleteAct('tenants', 'tenant')],
  },
  applications: {
    key: 'applications', title: 'Rental applications', single: 'Application',
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Pending', 'Approved', 'Reserved', 'Rejected', 'Completed', 'Cancelled'].map((s) => [s, s]) }],
    cols: [['Reference', (r) => `<b>${esc(r.referenceNumber)}</b>`], ['Applicant', (r) => `${esc(r.fullName)}<br><span class="muted">${esc(r.email)}</span>`], ['Property', (r) => esc(propName(r.propertyId))],
      ['Room', (r) => (r.assignedRoomId ? esc(roomLabel(r.assignedRoomId)) : '—')], ['Move-in', (r) => esc(r.expectedMoveInDate)], ['Guests', (r) => r.occupants], ['Status', (r) => badge(r.status)]],
    actions: [
      { key: 'review', label: 'Review', show: (r) => !['Completed'].includes(r.status), run: async (r) => reviewApplication(r) },
      { key: 'conv', label: 'Convert to tenant', cls: '', show: (r) => ['Approved', 'Reserved'].includes(r.status) && r.assignedRoomId,
        run: async (r) => { await api(`/applications/${r.id}/convert`, { method: 'POST' }); toast('Tenant created.'); await refresh(); } }],
  },
  reviews: {
    key: 'reviews', title: 'Property reviews', single: 'Review',
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Pending', 'Approved', 'Rejected'].map((s) => [s, s]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) }],
    search: (r) => propName(r.propertyId) + ' ' + r.reviewerName + ' ' + (r.title || '') + ' ' + r.comment,
    cols: [['Property', (r) => esc(propName(r.propertyId))],
      ['Reviewer', (r) => `<b>${esc(r.reviewerName)}</b><br><span class="muted">${esc(r.email)}</span>`],
      ['Rating', (r) => `<span style="color:#d97706">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> (${r.rating}/5)`],
      ['Review', (r) => `${r.title ? `<b>${esc(r.title)}</b><br>` : ''}<span class="muted">${esc(r.comment.slice(0, 60))}${r.comment.length > 60 ? '…' : ''}</span>${r.ownerReply ? '<br><span class="badge b-ok">Replied</span>' : ''}`],
      ['Date', (r) => esc((r.createdAt || '').slice(0, 10))],
      ['Status', (r) => badge(r.status)]],
    actions: [
      { key: 'approve', label: 'Approve', show: (r) => r.status !== 'Approved',
        run: async (r) => { await api(`/reviews/${r.id}/status`, { method: 'PATCH', body: { status: 'Approved' } }); toast('Review approved.'); await refresh(); } },
      { key: 'reject', label: 'Reject', cls: 'ghost', show: (r) => r.status !== 'Rejected',
        run: async (r) => { await api(`/reviews/${r.id}/status`, { method: 'PATCH', body: { status: 'Rejected' } }); toast('Review rejected.'); await refresh(); } },
      { key: 'reply', label: 'Reply', cls: 'ghost', run: async (r) => replyReview(r) },
      deleteAct('reviews', 'review'),
    ],
  },
  messages: {
    key: 'messages', title: 'Contact messages', single: 'Message',
    filters: [{ key: 'status', label: 'All statuses', options: () => ['New', 'Read', 'Replied'].map((s) => [s, s]) }],
    cols: [['Date', (r) => esc((r.createdAt || '').slice(0, 10))],
      ['Sender', (r) => `<b>${esc(r.fullName)}</b><br><span class="muted">${esc(r.email)}${r.phone ? ' · ' + esc(r.phone) : ''}</span>`],
      ['Subject', (r) => esc(r.subject)],
      ['Message', (r) => `<span class="muted">${esc(r.message.slice(0, 65))}${r.message.length > 65 ? '…' : ''}</span>`],
      ['Status', (r) => badge(r.status)]],
    actions: [
      { key: 'view', label: 'View', run: async (r) => viewMessage(r) },
      deleteAct('messages', 'message'),
    ],
  },
  payments: {
    key: 'payments', title: 'Payments', single: 'Payment', add: true,
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Paid', 'Partial', 'Pending', 'Overdue'].map((s) => [s, s]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) }, { key: 'tenantId', label: 'All tenants', options: opts('tenants', (t) => t.fullName) }],
    search: (r) => tenantName(r.tenantId) + ' ' + propName(r.propertyId),
    cols: [['Receipt', (r) => esc(r.receiptNumber)], ['Tenant', (r) => esc(tenantName(r.tenantId))], ['Property', (r) => esc(propName(r.propertyId))], ['Month', (r) => r.billingMonth],
      ['Due', (r) => money(r.amountDue)], ['Paid', (r) => money(r.amountPaid)], ['Balance', (r) => money(r.remainingBalance)], ['Method', (r) => esc(r.paymentMethod)], ['Status', (r) => badge(r.status)]],
    fields: [{ name: 'tenantId', label: 'Tenant', type: 'select', options: () => D.tenants.filter((t) => t.status === 'Active').map((t) => [t.id, `${t.fullName} (${money(t.monthlyRent)})`]), required: true, createOnly: true },
      { name: 'billingMonth', label: 'Billing month', type: 'month', required: true, createOnly: true, def: new Date().toISOString().slice(0, 7) },
      { name: 'dueDate', label: 'Due date', type: 'date' }, { name: 'paymentDate', label: 'Payment date', type: 'date' },
      { name: 'amountDue', label: 'Amount due (₱, blank = rent)', type: 'number' }, { name: 'amountPaid', label: 'Amount paid (₱)', type: 'number', def: 0 },
      { name: 'paymentMethod', label: 'Method', type: 'select', list: METHODS, def: 'Cash' }, { name: 'notes', label: 'Notes' }],
    actions: [editAct('payments'), { key: 'rcpt', label: 'Receipt', run: async (r) => printReceipt(r) }],
  },
  expenses: {
    key: 'expenses', title: 'Expenses', single: 'Expense', add: true,
    filters: [{ key: 'category', label: 'All categories', options: () => CATEGORIES.map((c) => [c, c]) }, { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) }],
    cols: [['Date', (r) => r.expenseDate], ['Property', (r) => esc(propName(r.propertyId))], ['Category', (r) => esc(r.category)], ['Description', (r) => esc(r.description)], ['Amount', (r) => money(r.amount)], ['Receipt', (r) => esc(r.receiptReference)]],
    fields: [{ name: 'propertyId', label: 'Property', type: 'select', options: opts('properties', (p) => p.name), required: true }, { name: 'category', label: 'Category', type: 'select', list: CATEGORIES, required: true },
      { name: 'description', label: 'Description', required: true, full: true }, { name: 'amount', label: 'Amount (₱)', type: 'number', required: true },
      { name: 'expenseDate', label: 'Date', type: 'date', def: new Date().toISOString().slice(0, 10) }, { name: 'paymentMethod', label: 'Method', type: 'select', list: METHODS, def: 'Cash' }, { name: 'receiptReference', label: 'Receipt reference' }],
    actions: [editAct('expenses'), deleteAct('expenses', 'expense')],
  },
  users: {
    key: 'users', title: 'System users', single: 'User', add: true,
    cols: [['Name', (r) => esc(r.fullName)], ['Email', (r) => esc(r.email)], ['Role', (r) => badge(r.role)], ['Phone', (r) => esc(r.phone)]],
    fields: [{ name: 'fullName', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'password', label: 'Password (8+ chars)', type: 'password', required: true },
      { name: 'role', label: 'Role', type: 'select', list: ['staff', 'owner', 'admin'], def: 'staff' }, { name: 'phone', label: 'Phone' }],
    actions: [],
  },
};

// ---------- applications review ----------
function reviewApplication(a) {
  const rooms = D.rooms.filter((r) => r.propertyId === a.propertyId && (r.availableBeds > 0 || r.id === a.assignedRoomId) && r.status !== 'Maintenance');
  const m = openModal(`<div class="modal-head"><h2>${esc(a.referenceNumber)}</h2><button class="x" data-close>×</button></div>
    <p><b>${esc(a.fullName)}</b> · ${esc(a.email)} · ${esc(a.contactNumber)}<br><span class="muted">${esc(propName(a.propertyId))} · wants ${esc(a.preferredRoomType)} · move-in ${esc(a.expectedMoveInDate)} · ${a.occupants} occupant(s)</span></p>
    <p>${esc(a.message) || '<i class="muted">No message.</i>'}</p>
    <form id="rev"><div class="grid2"><div class="field"><label>Status</label><select name="status">${['Pending', 'Approved', 'Reserved', 'Rejected', 'Cancelled'].map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Assign room</label><select name="assignedRoomId"><option value="">— none —</option>${rooms.map((r) => `<option value="${r.id}" ${r.id === a.assignedRoomId ? 'selected' : ''}>${esc(r.roomNumber)} · ${esc(r.roomType)} · ${r.availableBeds} free · ${money(r.monthlyPrice)}</option>`).join('')}</select></div>
    <div class="field"><label>Reservation date</label><input type="date" name="reservationDate" value="${esc(a.reservationDate || '')}"></div></div>
    <button class="btn">Save</button></form>`);
  $('#rev', m).onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/applications/${a.id}/status`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); m.remove(); toast('Application updated.'); await refresh(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- reviews reply & contact messages ----------
function replyReview(r) {
  const m = openModal(`<div class="modal-head"><h2>Reply to review</h2><button class="x" data-close>×</button></div>
    <p><b>${esc(r.reviewerName)}</b> · ${esc(propName(r.propertyId))} · <span style="color:#d97706">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span></p>
    ${r.title ? `<p><b>${esc(r.title)}</b></p>` : ''}
    <p>${esc(r.comment)}</p>
    <form id="repForm"><div class="field"><label>Owner reply *</label>
      <textarea name="ownerReply" rows="3" maxlength="600" required>${esc(r.ownerReply || '')}</textarea></div>
      <button class="btn">Save reply</button> <button type="button" class="btn ghost" data-close>Cancel</button></form>`);
  $('#repForm', m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/reviews/${r.id}/reply`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      m.remove(); toast('Reply saved.'); await refresh();
    } catch (err) { toast(err.message, true); }
  };
}

function viewMessage(msg) {
  const m = openModal(`<div class="modal-head"><h2>${esc(msg.subject || 'Contact message')}</h2><button class="x" data-close>×</button></div>
    <p><b>${esc(msg.fullName)}</b> · ${esc(msg.email)}${msg.phone ? ' · ' + esc(msg.phone) : ''}<br><span class="muted">Sent ${esc((msg.createdAt || '').slice(0, 10))}</span></p>
    <p style="white-space:pre-wrap;background:#f8fbfb;padding:12px;border-radius:10px;border:1px solid var(--line)">${esc(msg.message)}</p>
    <form id="msgStatus"><div class="field"><label>Status</label><select name="status">${['New', 'Read', 'Replied'].map((s) => `<option ${s === msg.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <button class="btn">Update status</button> <button type="button" class="btn ghost" data-close>Close</button></form>`, true);
  $('#msgStatus', m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/messages/${msg.id}/status`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
      m.remove(); toast('Message updated.'); await refresh();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- receipt ----------
function printReceipt(p) {
  const t = find('tenants', p.tenantId) || {};
  const w = window.open('', '_blank', 'width=560,height=720');
  if (!w) return toast('Allow pop-ups to print the receipt.', true);
  w.document.write(`<html><head><title>${esc(p.receiptNumber)}</title><style>body{font-family:Arial,sans-serif;max-width:460px;margin:30px auto;color:#111}
    h2{margin:0}table{width:100%;border-collapse:collapse;margin-top:14px}td{padding:7px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right}.big{font-size:20px;font-weight:700}</style></head>
    <body><h2>CasaBatangueño</h2><p>Official payment receipt (class-project demo)</p><table>
    <tr><td>Receipt no.</td><td>${esc(p.receiptNumber)}</td></tr><tr><td>Reference</td><td>${esc(p.referenceNumber)}</td></tr>
    <tr><td>Tenant</td><td>${esc(t.fullName)}</td></tr><tr><td>Property / Room</td><td>${esc(propName(p.propertyId))} / ${esc((find('rooms', p.roomId) || {}).roomNumber || '—')}</td></tr>
    <tr><td>Billing month</td><td>${esc(p.billingMonth)}</td></tr><tr><td>Payment date</td><td>${esc(p.paymentDate || '—')}</td></tr><tr><td>Method</td><td>${esc(p.paymentMethod)}</td></tr>
    <tr><td>Amount due</td><td>${money(p.amountDue)}</td></tr><tr><td class="big">Amount paid</td><td class="big">${money(p.amountPaid)}</td></tr>
    <tr><td>Remaining balance</td><td>${money(p.remainingBalance)}</td></tr><tr><td>Status</td><td>${esc(p.status)}</td></tr></table>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ---------- date range bar (dashboard + reports) ----------
function rangeBar() {
  const r = rangeState;
  return `<div class="range no-print"><select id="rg">${[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom range']]
    .map(([v, l]) => `<option value="${v}" ${r.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input type="date" id="rs" value="${r.start}" ${r.range === 'custom' ? '' : 'hidden'}><input type="date" id="re" value="${r.end}" ${r.range === 'custom' ? '' : 'hidden'}></div>`;
}
function bindRange(onChange) {
  const apply = () => { rangeState = { range: $('#rg').value, start: $('#rs').value, end: $('#re').value }; if (rangeState.range !== 'custom' || (rangeState.start && rangeState.end)) onChange(); else { $('#rs').hidden = $('#re').hidden = false; } };
  $('#rg').onchange = apply; $('#rs').onchange = apply; $('#re').onchange = apply;
}
const rangeQuery = () => `range=${rangeState.range}&start=${rangeState.start}&end=${rangeState.end}`;

// ---------- dashboard ----------
async function renderDashboard(view) {
  view.innerHTML = `<div class="head"><h2>Overview</h2>${rangeBar()}</div><div id="dash"><div class="empty">Loading…</div></div>`;
  bindRange(() => renderDashboard(view));
  let data;
  try { data = await api('/dashboard/summary?' + rangeQuery()); } catch (e) { return ($('#dash').innerHTML = `<div class="empty">${esc(e.message)}</div>`); }
  const k = data.kpis, c = data.charts;
  const cards = [['Properties', k.totalProperties], ['Buildings', k.totalBuildings], ['Total rooms', k.totalRooms], ['Available rooms', k.availableRooms, 'good'], ['Occupied rooms', k.occupiedRooms],
    ['Reserved rooms', k.reservedRooms], ['Active tenants', k.totalTenants], ['Pending reviews', k.pendingReviews ?? 0, (k.pendingReviews || 0) > 0 ? 'warn' : ''], ['New messages', k.unreadMessages ?? 0, (k.unreadMessages || 0) > 0 ? 'warn' : ''],
    ['Expected monthly income', money(k.monthlyExpectedIncome)], ['Collected', money(k.totalCollected), 'good'],
    ['Pending balances', money(k.pendingPayments), 'warn'], ['Overdue', money(k.overduePayments), 'bad'], ['Expenses', money(k.monthlyExpenses), 'warn'], ['Net income', money(k.netIncome), k.netIncome >= 0 ? 'good' : 'bad']];
  $('#dash').innerHTML = `<div class="kpis">${cards.map(([l, v, cl]) => `<div class="kpi ${cl || ''}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
    <div class="charts">${['Monthly rental income', 'Monthly expenses', 'Income vs. expenses', 'Room occupancy', 'Payment status', 'Property performance']
      .map((t, i) => `<div class="panel"><h3>${t}</h3><div class="chart-box"><canvas id="c${i}"></canvas></div></div>`).join('')}</div>`;
  const colors = ['#0f766e', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6'];
  const mk = (i, type, labels, datasets, extra = {}) => charts.push(new Chart($('#c' + i), { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, ...extra } }));
  const scale = { scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₱' + v.toLocaleString() } } } };
  mk(0, 'bar', c.months, [{ label: 'Income', data: c.incomeByMonth, backgroundColor: '#0f766e' }], scale);
  mk(1, 'bar', c.months, [{ label: 'Expenses', data: c.expenseByMonth, backgroundColor: '#f59e0b' }], scale);
  mk(2, 'line', c.months, [{ label: 'Income', data: c.incomeByMonth, borderColor: '#0f766e', tension: .3 }, { label: 'Expenses', data: c.expenseByMonth, borderColor: '#ef4444', tension: .3 }], scale);
  mk(3, 'doughnut', c.occupancy.labels, [{ data: c.occupancy.values, backgroundColor: ['#16a34a', '#3b82f6', '#f59e0b', '#ef4444'] }]);
  mk(4, 'pie', c.paymentStatus.labels, [{ data: c.paymentStatus.values, backgroundColor: ['#16a34a', '#f59e0b', '#3b82f6', '#ef4444'] }]);
  mk(5, 'bar', c.propertyPerformance.labels, [{ label: 'Collected', data: c.propertyPerformance.values, backgroundColor: colors }], { ...scale, indexAxis: 'y', scales: { x: { beginAtZero: true } } });
}

// ---------- reports ----------
async function renderReports(view) {
  view.innerHTML = `<div class="head"><h2>Financial reports</h2>${rangeBar()}</div><div id="rep"><div class="empty">Loading…</div></div>`;
  bindRange(() => renderReports(view));
  let r;
  try { r = await api('/reports/financial?' + rangeQuery()); } catch (e) { return ($('#rep').innerHTML = `<div class="empty">${esc(e.message)}</div>`); }
  const s = r.summary, o = r.occupancy;
  const table = (head, rows) => `<div class="scroll"><table class="dt"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="empty">No data</td></tr>`}</table></div>`;
  $('#rep').innerHTML = `<div class="tools no-print" style="margin-bottom:14px"><button class="btn ghost" id="print">🖨 Print</button><button class="btn ghost" id="pdf">PDF</button><button class="btn ghost" id="xls">Excel</button></div>
    <div class="kpis">${[['Expected income', money(s.expectedIncome)], ['Collected', money(s.collected), 'good'], ['Outstanding', money(s.outstanding), 'warn'], ['Expenses', money(s.expenses), 'warn'], ['Net income', money(s.netIncome), s.netIncome >= 0 ? 'good' : 'bad'], ['Occupancy', o.percent + '%']]
      .map(([l, v, cl]) => `<div class="kpi ${cl || ''}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
    <div class="panel"><h3>Per property</h3>${table(['Property', 'Income', 'Expenses', 'Net'], r.byProperty.map((p) => [esc(p.name), money(p.income), money(p.expenses), money(p.income - p.expenses)]))}</div>
    <div class="panel"><h3>Expenses by category</h3>${table(['Category', 'Amount'], r.byCategory.map((c) => [esc(c.category), money(c.amount)]))}</div>
    <div class="panel"><h3>Per tenant</h3>${table(['Tenant', 'Paid', 'Balance'], r.byTenant.map((t) => [esc(t.name), money(t.paid), money(t.balance)]))}</div>
    <div class="panel"><h3>Occupancy</h3>${table(['Total rooms', 'Occupied', 'Available', 'Reserved', 'Occupancy'], [[o.totalRooms, o.occupied, o.available, o.reserved, o.percent + '%']])}</div>`;
  $('#print').onclick = () => window.print();
  $('#pdf').onclick = () => exportPdf(r);
  $('#xls').onclick = () => exportExcel(r);
}
function exportPdf(r) {
  const doc = new jspdf.jsPDF();
  const peso = (n) => 'PHP ' + Number(n).toLocaleString('en-PH');
  doc.setFontSize(16); doc.text('CasaBatangueño - Financial Report', 14, 16);
  doc.setFontSize(10); doc.text(`Period: ${r.range.start} to ${r.range.end}`, 14, 23);
  const s = r.summary;
  doc.autoTable({ startY: 28, head: [['Metric', 'Amount']], body: [['Expected income', peso(s.expectedIncome)], ['Collected', peso(s.collected)], ['Outstanding', peso(s.outstanding)], ['Expenses', peso(s.expenses)], ['Net income', peso(s.netIncome)], ['Occupancy', r.occupancy.percent + '%']] });
  doc.autoTable({ head: [['Property', 'Income', 'Expenses']], body: r.byProperty.map((p) => [p.name, peso(p.income), peso(p.expenses)]) });
  doc.autoTable({ head: [['Expense category', 'Amount']], body: r.byCategory.map((c) => [c.category, peso(c.amount)]) });
  doc.save('CasaBatangueño-report.pdf');
}
function exportExcel(r) {
  const wb = XLSX.utils.book_new(), s = r.summary;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Metric', 'Amount'], ['Period', `${r.range.start} to ${r.range.end}`], ['Expected income', s.expectedIncome], ['Collected', s.collected], ['Outstanding', s.outstanding], ['Expenses', s.expenses], ['Net income', s.netIncome], ['Occupancy %', r.occupancy.percent]]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.byProperty), 'Per property');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.byCategory), 'Expenses');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.byTenant), 'Per tenant');
  XLSX.writeFile(wb, 'CasaBatangueño-report.xlsx');
}

// ---------- boot ----------
(async function boot() {
  if (!localStorage.getItem(TOKEN_KEY)) return showLogin();
  try { user = await api('/auth/me'); await startShell(); } catch { showLogin(); }
})();
