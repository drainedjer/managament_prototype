/* owner.js - private management portal: httpOnly cookie auth, masked staff views + Reveal,
   installment payments, convert-to-tenant, checklists, Blob uploads, inbox, analytics, CSV/Excel/PDF reports */
const app = $('#app');
let user = null;
let D = {};
let section = 'dashboard';
let inboxTab = 'messages';
let charts = [];
let rangeState = { range: 'year', start: '', end: '' };
let reportBasis = 'due'; // 'due' | 'payment'

const TYPES = ['Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room'];
const METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'];
const PAGE_SIZE = 15;
const isOwnerOrAdmin = () => user && (user.role === 'owner' || user.role === 'admin');

function onSessionExpired() {
  if (user) {
    user = null;
    showLogin('Session expired. Please sign in again.');
  }
}

function confirmModal(message, title = 'Confirm Action') {
  return new Promise((resolve) => {
    let settled = false;
    const m = openModal(`<div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></div>
      <p>${esc(message)}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="button" class="btn danger" id="cfmOk">Confirm</button>
      </div>`, true);
    const origClose = m.remove;
    m.remove = () => {
      origClose();
      if (!settled) { settled = true; resolve(false); }
    };
    $('#cfmOk', m).onclick = () => {
      settled = true;
      origClose();
      resolve(true);
    };
  });
}

// ---------- lookups ----------
const find = (list, id) => (D[list] || []).find((x) => x.id === Number(id));
const propName = (id) => (find('properties', id) || {}).name || '—';
const tenantName = (id) => (find('tenants', id) || {}).fullName || '—';
const roomLabel = (id) => {
  const r = find('rooms', id);
  return r ? `${r.roomNumber} (${propName(r.propertyId)})` : '—';
};
const opts = (list, label) => () => (D[list] || []).map((x) => [x.id, label(x)]);

// ---------- login ----------
function showLogin(msg = '') {
  app.innerHTML = `<div class="login-wrap"><form class="login" id="loginForm">
    <a class="logo" href="/" style="display:block;margin-bottom:6px">Casa<span>Batangueño</span></a>
    <h2>Owner &amp; Staff Portal</h2>
    <p class="muted">${esc(msg) || 'Sign in with your management account.'}</p>
    <div class="field"><label for="lgEmail">Email</label><input id="lgEmail" name="email" type="email" required autocomplete="username"></div>
    <div class="field"><label for="lgPass">Password</label><input id="lgPass" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn" style="width:100%;justify-content:center" type="submit">Log in</button>
    <p style="text-align:center;margin-bottom:0;margin-top:14px;font-size:13.5px">
      <a href="/account.html">Customer / Resident Login</a> · <a href="/">← Back to public site</a>
    </p></form></div>`;

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      if (r.user.role === 'customer') {
        location.href = '/account.html';
        return;
      }
      user = await api('/auth/me');
      await startShell();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

// ---------- shell & navigation ----------
const NAV = [
  ['dashboard', 'Dashboard'],
  ['properties', 'Properties', 'owner'],
  ['buildings', 'Buildings', 'owner'],
  ['rooms', 'Rooms'],
  ['tenants', 'Tenants'],
  ['leases', 'Leases'],
  ['applications', 'Applications'],
  ['payments', 'Payments'],
  ['expenses', 'Expenses'],
  ['inbox', 'Inbox & Operations'],
  ['reviews', 'Reviews'],
  ['reports', 'Reports & Analytics'],
  ['settings', 'Settings', 'owner'],
  ['audit', 'Audit Logs', 'owner'],
  ['users', 'Users', 'admin'],
];
const navAllowed = (n) => !n[2] || (n[2] === 'owner' ? isOwnerOrAdmin() : user.role === n[2]);

async function loadAll() {
  const keys = [
    'properties', 'buildings', 'rooms', 'tenants', 'leases', 'applications',
    'reviews', 'payments', 'expenses', 'expense-categories', 'messages',
    'viewings', 'maintenance', 'waitlist', 'announcements', 'testimonials', 'notifications',
  ];
  const res = await Promise.all(keys.map((k) => api('/' + k)));
  keys.forEach((k, i) => (D[k] = res[i]));
  D.expenseCategories = D['expense-categories'];
  if (isOwnerOrAdmin()) {
    D.settings = await api('/settings');
    D.auditLogs = await api('/audit-logs?limit=150');
  }
  if (user.role === 'admin') D.users = await api('/users');
}

function navBadge(key) {
  if (key === 'applications') {
    const n = (D.applications || []).filter((a) => a.status === 'Pending').length;
    return n ? `<span class="side-badge">${n}</span>` : '';
  }
  if (key === 'leases') {
    const n = (D.leases || []).filter((l) => l.expiringSoon).length;
    return n ? `<span class="side-badge">${n}</span>` : '';
  }
  if (key === 'inbox') {
    const n = (D.messages || []).filter((m) => m.status === 'New').length +
      (D.viewings || []).filter((v) => v.status === 'Pending').length +
      (D.maintenance || []).filter((m) => m.status !== 'Done').length;
    return n ? `<span class="side-badge">${n}</span>` : '';
  }
  if (key === 'reviews') {
    const n = (D.reviews || []).filter((r) => r.status === 'Pending').length;
    return n ? `<span class="side-badge">${n}</span>` : '';
  }
  return '';
}

async function startShell() {
  await loadAll();
  const unreadNotifs = (D.notifications || []).filter((n) => !n.isRead).length;
  app.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <a class="logo" href="/">Casa<span>Batangueño</span></a>
      ${NAV.filter(navAllowed).map((n) => `<button data-go="${n[0]}"><span>${n[1]}</span>${navBadge(n[0])}</button>`).join('')}
      <button data-go="__site"><span>Public site</span></button>
    </aside>
    <div class="main">
      <div class="top no-print">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn ghost sm menu-btn" id="menu" aria-label="Menu">☰</button>
          <strong id="title"></strong>
        </div>
        <div class="who">
          <div class="notif-wrap">
            <button class="btn ghost sm" id="notifBtn" aria-label="Notifications">🔔 ${unreadNotifs ? `<b>(${unreadNotifs})</b>` : ''}</button>
            <div class="notif-pop" id="notifPop" hidden></div>
          </div>
          <span class="badge b-info">${esc(user.role)}</span>
          <span>${esc(user.fullName)}</span>
          ${user.demoResetEnabled && isOwnerOrAdmin() ? '<button class="btn ghost sm" id="reset">Reset demo</button>' : ''}
          <button class="btn ghost sm" id="logout">Log out</button>
        </div>
      </div>
      <div id="view"></div>
    </div>
  </div>`;

  $('#side').onclick = (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.dataset.go === '__site') location.href = '/';
    else go(b.dataset.go);
    $('#side').classList.remove('open');
  };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    user = null;
    showLogin('You have been logged out.');
  };

  const notifBtn = $('#notifBtn');
  const notifPop = $('#notifPop');
  notifBtn.onclick = (e) => {
    e.stopPropagation();
    notifPop.hidden = !notifPop.hidden;
    if (!notifPop.hidden) renderNotifPopover();
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrap') && !notifPop.hidden) notifPop.hidden = true;
  });

  const rs = $('#reset');
  if (rs) {
    rs.onclick = async () => {
      if (!(await confirmModal('Restore the original preview dataset? Your unsaved changes will be lost.', 'Reset Preview Data'))) return;
      await api('/demo/reset', { method: 'POST' });
      await loadAll();
      go(section);
      toast('Preview data restored.');
    };
  }
  go(section);
}

function renderNotifPopover() {
  const pop = $('#notifPop');
  const list = D.notifications || [];
  pop.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <b>Notifications</b>
    ${list.some((n) => !n.isRead) ? '<button class="btn sm ghost" id="readAllNotif">Mark all read</button>' : ''}
  </div>
  ${list.slice(0, 12).map((n) => `<div class="notif-item ${n.isRead ? '' : 'unread'}" data-nid="${n.id}" data-nlink="${esc(n.link || '')}">
    <b>${esc(n.title)}</b><div>${esc(n.body)}</div>
    <div class="muted">${esc(String(n.createdAt || '').slice(0, 10))}</div>
  </div>`).join('') || '<div class="muted">No notifications.</div>'}`;

  const ra = $('#readAllNotif', pop);
  if (ra) {
    ra.onclick = async () => {
      await api('/notifications/all/read', { method: 'PATCH' });
      D.notifications.forEach((n) => (n.isRead = true));
      renderNotifPopover();
      $('#notifBtn').innerHTML = '🔔';
    };
  }
  $$('[data-nid]', pop).forEach((el) => {
    el.onclick = async () => {
      await api(`/notifications/${el.dataset.nid}/read`, { method: 'PATCH' }).catch(() => {});
      const item = D.notifications.find((x) => x.id === Number(el.dataset.nid));
      if (item) item.isRead = true;
      pop.hidden = true;
      if (el.dataset.nlink && NAV.some((n) => n[0] === el.dataset.nlink && navAllowed(n))) go(el.dataset.nlink);
    };
  });
}

function go(name) {
  section = name;
  charts.forEach((c) => c.destroy());
  charts = [];
  $$('[data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  $('#title').textContent = (NAV.find((n) => n[0] === name) || [])[1] || '';
  const view = $('#view');
  if (name === 'dashboard') return renderDashboard(view);
  if (name === 'reports') return renderReports(view);
  if (name === 'inbox') return renderInbox(view);
  if (name === 'settings') return renderSettings(view);
  if (name === 'audit') return renderAuditLogs(view);
  renderTable(view, CFG[name]);
}

async function refresh() {
  await loadAll();
  go(section);
}

// ---------- generic paginated table + form ----------
const tableState = {};
function renderTable(view, cfg) {
  const st = (tableState[cfg.key] ||= { q: '', f: {}, page: 1 });
  const rows = (D[cfg.key] || []).filter((r) => {
    if (st.q) {
      const hay = (JSON.stringify(Object.values(r)) + ' ' + (cfg.search ? cfg.search(r) : '')).toLowerCase();
      if (!hay.includes(st.q.toLowerCase())) return false;
    }
    return (cfg.filters || []).every((f) => !st.f[f.key] || String(f.get ? f.get(r) : r[f.key]) === st.f[f.key]);
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (st.page > totalPages) st.page = totalPages;
  const startIdx = (st.page - 1) * PAGE_SIZE;
  const paged = rows.slice(startIdx, startIdx + PAGE_SIZE);

  const filters = (cfg.filters || [])
    .map((f) => `<select data-filter="${f.key}"><option value="">${esc(f.label)}</option>${f.options().map(([v, l]) =>
      `<option value="${esc(v)}" ${String(st.f[f.key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)
    .join('');

  const showAdd = cfg.add && (!cfg.addOwnerOnly || isOwnerOrAdmin());
  view.innerHTML = `<div class="head"><h2>${cfg.title}</h2><div class="tools">
    <input type="search" id="q" placeholder="Search…" value="${esc(st.q)}">${filters}
    ${showAdd ? `<button class="btn" id="add">+ Add ${cfg.single}</button>` : ''}</div></div>
    <div class="panel scroll"><table class="dt"><thead><tr>${cfg.cols.map((c) => `<th>${c[0]}</th>`).join('')}<th></th></tr></thead><tbody>
    ${paged.map((r) => `<tr>${cfg.cols.map((c) => `<td>${c[1](r)}</td>`).join('')}<td>${(cfg.actions || []).filter((a) => !a.show || a.show(r))
      .map((a) => `<button class="btn sm ${a.cls || 'ghost'}" data-act="${a.key}" data-id="${r.id}">${a.label}</button>`).join('')}</td></tr>`).join('')
      || `<tr><td colspan="${cfg.cols.length + 1}" class="empty">Nothing here yet.</td></tr>`}</tbody></table>
    ${rows.length > PAGE_SIZE ? `<div class="pager">
      <span>Showing ${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, rows.length)} of ${rows.length}</span>
      <div class="pager-btns">
        <button class="btn sm ghost" id="pgPrev" ${st.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span>Page ${st.page} / ${totalPages}</span>
        <button class="btn sm ghost" id="pgNext" ${st.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>` : ''}</div>`;

  const q = $('#q', view);
  q.oninput = () => {
    st.q = q.value;
    st.page = 1;
    const pos = q.selectionStart;
    renderTable(view, cfg);
    const n = $('#q');
    n.focus();
    n.setSelectionRange(pos, pos);
  };
  $$('[data-filter]', view).forEach((s) => (s.onchange = () => { st.f[s.dataset.filter] = s.value; st.page = 1; renderTable(view, cfg); }));
  if ($('#pgPrev', view)) $('#pgPrev', view).onclick = () => { st.page--; renderTable(view, cfg); };
  if ($('#pgNext', view)) $('#pgNext', view).onclick = () => { st.page++; renderTable(view, cfg); };
  if (showAdd) $('#add', view).onclick = () => openForm(cfg);
  view.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const row = find(cfg.key, b.dataset.id);
    cfg.actions.find((a) => a.key === b.dataset.act).run(row).catch((x) => toast(x.message, true));
  };
}

function openForm(cfg, row = null) {
  const fields = cfg.fields.filter((f) => !(row && f.createOnly) && !(row && f.staffSkip && !isOwnerOrAdmin()));
  const val = (f) => { const v = row ? (f.get ? f.get(row) : row[f.name]) : f.def; return v ?? ''; };
  const input = (f) => {
    const v = val(f), req = f.required ? 'required' : '';
    if (f.type === 'select') return `<select name="${f.name}" ${req}><option value="">Select…</option>${(f.options ? f.options() : f.list.map((x) => [x, x])).map(([o, l]) =>
      `<option value="${esc(o)}" ${String(o) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') {
      const uploader = f.imageUpload && isOwnerOrAdmin()
        ? `<div class="upload-row"><input type="file" accept=".jpg,.jpeg,.png,.webp" data-upload-target="${f.name}" style="max-width:250px"><span class="muted">Upload JPG/PNG/WEBP (≤2MB) to Vercel Blob</span></div>`
        : '';
      return `<textarea name="${f.name}" rows="3">${esc(v)}</textarea>${uploader}`;
    }
    if (f.type === 'checkbox') return `<input type="checkbox" name="${f.name}" style="width:auto" ${v === '' ? 'checked' : v ? 'checked' : ''}>`;
    return `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req} ${f.step ? `step="${f.step}"` : ''} ${f.type === 'number' ? 'min="0"' : ''}>`;
  };

  const m = openModal(`<div class="modal-head"><h2>${row ? 'Edit' : 'Add'} ${cfg.single}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <form id="crud"><div class="grid2">${fields.map((f) => `<div class="field" ${f.full ? 'style="grid-column:1/-1"' : ''}><label>${f.label}${f.required ? ' *' : ''}</label>${input(f)}</div>`).join('')}</div>
    <button class="btn" type="submit">Save</button> <button type="button" class="btn ghost" data-close>Cancel</button></form>`);

  $$('[data-upload-target]', m).forEach((inp) => {
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const contentBase64 = await readFileAsBase64(file);
        const r = await api('/uploads/image', { method: 'POST', body: { fileName: file.name, contentBase64 } });
        const ta = m.querySelector(`textarea[name="${inp.dataset.uploadTarget}"]`);
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + r.url;
        toast('Image uploaded!');
      } catch (err) {
        toast(err.message, true);
      } finally {
        inp.value = '';
      }
    };
  });

  $('#crud', m).onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    fields.forEach((f) => {
      const el = e.target.elements[f.name];
      if (!el) return;
      body[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    });
    try {
      await api(`/${cfg.key}${row ? '/' + row.id : ''}`, { method: row ? 'PUT' : 'POST', body });
      m.remove();
      toast(cfg.single + ' saved.');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

const editAct = (cfg, ownerOnly = false) => ({ key: 'edit', label: 'Edit', show: () => !ownerOnly || isOwnerOrAdmin(), run: async (r) => openForm(CFG[cfg], r) });
const deleteAct = (key, label) => ({
  key: 'del', label: 'Archive', cls: 'danger', show: isOwnerOrAdmin,
  run: async (r) => {
    if (!(await confirmModal(`Archive/delete this ${label}? Financial history is preserved.`, `Archive ${label}`))) return;
    await api(`/${key}/${r.id}`, { method: 'DELETE' });
    toast('Removed.');
    await refresh();
  },
});

// ---------- module configs ----------
const CFG = {
  properties: {
    key: 'properties', title: 'Properties', single: 'Property', add: true, addOwnerOnly: true,
    filters: [{ key: 'propertyType', label: 'All types', options: () => TYPES.map((t) => [t, t]) }],
    cols: [
      ['Name', (r) => `<b>${esc(r.name)}</b>`],
      ['Type', (r) => esc(r.propertyType)],
      ['From Price', (r) => money(r.monthlyPrice)],
      ['Rooms free', (r) => `${r.availableRoomsCount}/${r.totalRoomsCount} (${r.availableBedsCount} beds)`],
      ['BatStateU', (r) => (r.walkingMinutesBsu != null ? `${r.walkingMinutesBsu}m walk` : r.tricycleMinutesBsu != null ? `${r.tricycleMinutesBsu}m ride` : '—')],
      ['Public', (r) => badge(r.isPublished ? 'Active' : 'Cancelled').replace('Active', 'Published').replace('Cancelled', 'Hidden')],
    ],
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'propertyType', label: 'Type', type: 'select', list: TYPES, required: true },
      { name: 'address', label: 'Address', required: true },
      { name: 'city', label: 'City', def: 'Batangas City' },
      { name: 'latitude', label: 'Latitude', type: 'number', step: 'any', def: 13.7845 },
      { name: 'longitude', label: 'Longitude', type: 'number', step: 'any', def: 121.0735 },
      { name: 'walkingMinutesBsu', label: 'Walk mins to BatStateU Alangilan', type: 'number' },
      { name: 'tricycleMinutesBsu', label: 'Tricycle mins to BatStateU Alangilan', type: 'number' },
      { name: 'minLeaseMonths', label: 'Min lease (months)', type: 'number', def: 6 },
      { name: 'contactPhone', label: 'Contact phone' },
      { name: 'contactEmail', label: 'Contact email', type: 'email' },
      { name: 'isPublished', label: 'Published on public site', type: 'checkbox' },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'locationAccess', label: 'Location & transit access', full: true },
      { name: 'landmarks', label: 'Nearby landmarks', full: true },
      { name: 'nearbyPlaces', label: 'Nearby places (Alfamart, eateries, jeepneys)', type: 'textarea', full: true },
      { name: 'depositPolicy', label: 'Deposit & advance payment policy', type: 'textarea', full: true },
      { name: 'utilitiesPolicy', label: 'Utilities included / excluded', type: 'textarea', full: true },
      { name: 'inclusions', label: 'Room & unit inclusions', type: 'textarea', full: true },
      { name: 'curfewPolicy', label: 'Curfew & visitor policy', type: 'textarea', full: true },
      { name: 'amenities', label: 'Amenities (one per line)', type: 'textarea', full: true, get: (r) => (r.amenities || []).join('\n') },
      { name: 'houseRules', label: 'House rules (one per line)', type: 'textarea', full: true, get: (r) => (r.houseRules || []).join('\n') },
      { name: 'images', label: 'Image URLs (one per line)', type: 'textarea', full: true, imageUpload: true, get: (r) => (r.images || []).join('\n') },
    ],
    actions: [
      editAct('properties', true),
      { key: 'pub', label: 'Publish/Hide', show: isOwnerOrAdmin, run: async (r) => { await api(`/properties/${r.id}/publish`, { method: 'PATCH' }); await refresh(); } },
      deleteAct('properties', 'property'),
    ],
  },

  buildings: {
    key: 'buildings', title: 'Buildings', single: 'Building', add: true, addOwnerOnly: true,
    filters: [{ key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) }],
    cols: [['Building', (r) => `<b>${esc(r.name)}</b>`], ['Property', (r) => esc(propName(r.propertyId))], ['Floors', (r) => r.floors], ['Description', (r) => esc(r.description)]],
    fields: [
      { name: 'propertyId', label: 'Property', type: 'select', options: opts('properties', (p) => p.name), required: true, createOnly: true },
      { name: 'name', label: 'Name', required: true },
      { name: 'floors', label: 'Floors', type: 'number', def: 1 },
      { name: 'description', label: 'Description', full: true },
    ],
    actions: [editAct('buildings', true), deleteAct('buildings', 'building')],
  },

  rooms: {
    key: 'rooms', title: 'Rooms', single: 'Room', add: true, addOwnerOnly: true,
    filters: [
      { key: 'status', label: 'All statuses', options: () => ['Available', 'Occupied', 'Reserved', 'Maintenance'].map((s) => [s, s]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) },
    ],
    cols: [
      ['Room', (r) => `<b>${esc(r.roomNumber)}</b>`],
      ['Property', (r) => esc(propName(r.propertyId))],
      ['Building', (r) => esc(r.buildingName)],
      ['Type', (r) => esc(r.roomType)],
      ['Beds (Occ / Held / Free)', (r) => `${r.occupiedBeds} occ · ${r.heldBeds || 0} held · <b>${r.availableBeds}</b> free / ${r.capacity}`],
      ['Price', (r) => money(r.monthlyPrice)],
      ['Status', (r) => badge(r.status)],
    ],
    fields: [
      { name: 'buildingId', label: 'Building', type: 'select', options: opts('buildings', (b) => `${propName(b.propertyId)} — ${b.name}`), required: true },
      { name: 'roomNumber', label: 'Room number', required: true },
      { name: 'floorNumber', label: 'Floor', type: 'number', def: 1 },
      { name: 'roomType', label: 'Room type', type: 'select', list: TYPES, required: true },
      { name: 'capacity', label: 'Capacity (beds)', type: 'number', def: 1, required: true },
      { name: 'monthlyPrice', label: 'Monthly price (₱)', type: 'number', required: true },
      { name: 'status', label: 'Status', type: 'select', list: ['Available', 'Maintenance'], def: 'Available' },
      { name: 'description', label: 'Description', full: true },
      { name: 'images', label: 'Room Photo URLs (one per line)', type: 'textarea', full: true, imageUpload: true, get: (r) => (r.images || []).join('\n') },
    ],
    actions: [editAct('rooms'), deleteAct('rooms', 'room')],
  },

  tenants: {
    key: 'tenants', title: 'Tenants', single: 'Tenant', add: true,
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Active', 'Pending', 'Inactive', 'Former Tenant'].map((s) => [s, s]) }],
    cols: [
      ['Name', (r) => `<b>${esc(r.fullName)}</b>`],
      ['Contact', (r) => `${esc(r.contactNumber)}<br><span class="muted">${esc(r.email)}</span>`],
      ['Property / Room', (r) => `${esc(propName(r.propertyId))} · <b>${esc((find('rooms', r.roomId) || {}).roomNumber || '—')}</b>`],
      ['Move-in / Lease End', (r) => `${esc(r.moveInDate)}${r.leaseEndDate ? `<br><span class="muted">Ends ${esc(r.leaseEndDate)}</span>` : ''}`],
      ['Rent', (r) => money(r.monthlyRent)],
      ['Status', (r) => badge(r.status)],
    ],
    fields: [
      { name: 'fullName', label: 'Full name', required: true },
      { name: 'email', label: 'Email', type: 'email', staffSkip: true },
      { name: 'contactNumber', label: 'Contact number', required: true, staffSkip: true },
      { name: 'address', label: 'Home address', staffSkip: true },
      { name: 'emergencyContact', label: 'Emergency contact', full: true, staffSkip: true },
      { name: 'roomId', label: 'Room', type: 'select', options: opts('rooms', (r) => `${r.roomNumber} — ${propName(r.propertyId)} (${r.availableBeds} free)`), required: true },
      { name: 'moveInDate', label: 'Move-in date', type: 'date', required: true, def: manilaTodayClient() },
      { name: 'leaseEndDate', label: 'Lease end date', type: 'date', createOnly: true },
      { name: 'monthlyRent', label: 'Monthly rent (₱)', type: 'number' },
      { name: 'securityDeposit', label: 'Security deposit (₱)', type: 'number', staffSkip: true },
      { name: 'status', label: 'Status', type: 'select', list: ['Active', 'Pending', 'Inactive', 'Former Tenant'], def: 'Active' },
    ],
    actions: [
      { key: 'reveal', label: 'Reveal PII', show: (r) => !!r.masked, run: async (r) => revealTenantPii(r) },
      editAct('tenants'),
      { key: 'chk', label: 'Checklist', run: async (r) => openChecklistModal(r) },
      { key: 'hist', label: 'Bills', run: async (r) => openTenantPaymentsModal(r) },
      { key: 'out', label: 'Move out', show: (r) => r.status === 'Active', run: async (r) => {
        if (!(await confirmModal(`Record move-out for ${r.fullName}? This frees their bed and closes active lease.`, 'Confirm Move-out'))) return;
        await api(`/tenants/${r.id}/move-out`, { method: 'POST' });
        toast('Move-out recorded.');
        await refresh();
      } },
      deleteAct('tenants', 'tenant'),
    ],
  },

  leases: {
    key: 'leases', title: 'Leases & 30-Day Renewals', single: 'Lease',
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Active', 'Expiring', 'Completed', 'Terminated'].map((s) => [s, s]) }],
    cols: [
      ['Tenant', (r) => `<b>${esc(r.tenantName)}</b>`],
      ['Property / Room', (r) => `${esc(r.propertyName)} · ${esc(r.roomNumber)}`],
      ['Start', (r) => esc(r.startDate)],
      ['End Date', (r) => `${esc(r.endDate)} ${r.expiringSoon ? `<span class="badge b-warn">${r.daysLeft}d left</span>` : ''}`],
      ['Rate / Deposit', (r) => `${money(r.monthlyRate)} / ${money(r.depositAmount)}`],
      ['Status', (r) => badge(r.status)],
    ],
    actions: [],
  },

  applications: {
    key: 'applications', title: 'Rental Applications', single: 'Application',
    filters: [{ key: 'status', label: 'All statuses', options: () => ['Pending', 'Approved', 'Reserved', 'Rejected', 'Completed', 'Cancelled'].map((s) => [s, s]) }],
    cols: [
      ['Reference', (r) => `<b>${esc(r.referenceNumber)}</b>`],
      ['Applicant', (r) => `${esc(r.fullName)}<br><span class="muted">${esc(r.email)} · ${esc(r.contactNumber)}</span>`],
      ['Property', (r) => esc(propName(r.propertyId))],
      ['Room', (r) => (r.assignedRoomId ? esc(roomLabel(r.assignedRoomId)) : '—')],
      ['Move-in', (r) => esc(r.expectedMoveInDate)],
      ['Beds', (r) => r.occupants],
      ['Status', (r) => badge(r.status)],
    ],
    actions: [
      { key: 'reveal', label: 'Reveal PII', show: (r) => !!r.masked, run: async (r) => revealAppPii(r) },
      { key: 'doc', label: 'ID Doc', show: (r) => isOwnerOrAdmin() && r.hasDocument, run: async (r) => openAppDocModal(r) },
      { key: 'review', label: 'Review', show: (r) => !['Completed'].includes(r.status), run: async (r) => reviewApplication(r) },
      { key: 'conv', label: 'Convert', cls: '', show: (r) => ['Approved', 'Reserved'].includes(r.status) && r.assignedRoomId, run: async (r) => openConvertModal(r) },
      deleteAct('applications', 'application'),
    ],
  },

  payments: {
    key: 'payments', title: 'Payments & Installments', single: 'Bill', add: true,
    filters: [
      { key: 'status', label: 'All statuses', options: () => ['Paid', 'Partial', 'Pending', 'Overdue'].map((s) => [s, s]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) },
    ],
    search: (r) => tenantName(r.tenantId) + ' ' + propName(r.propertyId) + ' ' + r.billingMonth,
    cols: [
      ['Receipt', (r) => esc(r.receiptNumber)],
      ['Tenant', (r) => esc(tenantName(r.tenantId))],
      ['Property', (r) => esc(propName(r.propertyId))],
      ['Month / Due', (r) => `${esc(r.billingMonth)}<br><span class="muted">Due ${esc(r.dueDate)}</span>`],
      ['Due', (r) => money(r.amountDue)],
      ['Paid', (r) => money(r.amountPaid)],
      ['Balance', (r) => money(r.remainingBalance)],
      ['Txns', (r) => (r.transactions || []).filter((t) => !t.voidedAt).length],
      ['Status', (r) => badge(r.status)],
    ],
    fields: [
      { name: 'tenantId', label: 'Tenant', type: 'select', options: () => (D.tenants || []).filter((t) => t.status === 'Active').map((t) => [t.id, `${t.fullName} (${money(t.monthlyRent)})`]), required: true, createOnly: true },
      { name: 'billingMonth', label: 'Billing month', type: 'month', required: true, createOnly: true, def: manilaTodayClient().slice(0, 7) },
      { name: 'dueDate', label: 'Due date', type: 'date' },
      { name: 'amountDue', label: 'Amount due (₱, blank = rent)', type: 'number' },
      { name: 'initialAmountPaid', label: 'Initial payment (₱)', type: 'number', def: 0 },
      { name: 'paymentDate', label: 'Payment date', type: 'date', def: manilaTodayClient() },
      { name: 'paymentMethod', label: 'Method', type: 'select', list: METHODS, def: 'Cash' },
      { name: 'notes', label: 'Notes' },
    ],
    actions: [
      { key: 'tx', label: 'Installments', run: async (r) => openTransactionsModal(r) },
      { key: 'rcpt', label: 'Receipt', run: async (r) => printReceipt(r) },
      deleteAct('payments', 'payment bill'),
    ],
  },

  expenses: {
    key: 'expenses', title: 'Expenses', single: 'Expense', add: true,
    filters: [
      { key: 'category', label: 'All categories', options: () => (D.expenseCategories || []).map((c) => [c.name, c.name]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) },
    ],
    cols: [
      ['Date', (r) => esc(r.expenseDate)],
      ['Property', (r) => esc(propName(r.propertyId))],
      ['Category', (r) => esc(r.category)],
      ['Description', (r) => esc(r.description)],
      ['Amount', (r) => money(r.amount)],
      ['Receipt Ref', (r) => esc(r.receiptReference)],
    ],
    fields: [
      { name: 'propertyId', label: 'Property', type: 'select', options: opts('properties', (p) => p.name), required: true },
      { name: 'categoryId', label: 'Category', type: 'select', options: () => (D.expenseCategories || []).map((c) => [c.id, c.name]), required: true, get: (r) => r.categoryId },
      { name: 'description', label: 'Description', required: true, full: true },
      { name: 'amount', label: 'Amount (₱)', type: 'number', required: true },
      { name: 'expenseDate', label: 'Date', type: 'date', def: manilaTodayClient() },
      { name: 'paymentMethod', label: 'Method', type: 'select', list: METHODS, def: 'Cash' },
      { name: 'receiptReference', label: 'Receipt reference' },
    ],
    actions: [editAct('expenses'), deleteAct('expenses', 'expense')],
  },

  reviews: {
    key: 'reviews', title: 'Property Reviews', single: 'Review',
    filters: [
      { key: 'status', label: 'All statuses', options: () => ['Pending', 'Approved', 'Rejected'].map((s) => [s, s]) },
      { key: 'propertyId', label: 'All properties', options: opts('properties', (p) => p.name) },
    ],
    search: (r) => propName(r.propertyId) + ' ' + r.reviewerName + ' ' + (r.title || '') + ' ' + r.comment,
    cols: [
      ['Property', (r) => esc(propName(r.propertyId))],
      ['Reviewer', (r) => `<b>${esc(r.reviewerName)}</b>`],
      ['Rating', (r) => `<span style="color:#d97706">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>`],
      ['Comment', (r) => `${r.title ? `<b>${esc(r.title)}</b><br>` : ''}<span class="muted">${esc(r.comment.slice(0, 60))}…</span>`],
      ['Status', (r) => badge(r.status)],
    ],
    actions: [
      { key: 'approve', label: 'Approve', show: (r) => r.status !== 'Approved', run: async (r) => { await api(`/reviews/${r.id}/status`, { method: 'PATCH', body: { status: 'Approved' } }); toast('Approved.'); await refresh(); } },
      { key: 'reject', label: 'Reject', cls: 'ghost', show: (r) => r.status !== 'Rejected', run: async (r) => { await api(`/reviews/${r.id}/status`, { method: 'PATCH', body: { status: 'Rejected' } }); toast('Rejected.'); await refresh(); } },
      { key: 'reply', label: 'Reply', cls: 'ghost', run: async (r) => replyReview(r) },
      deleteAct('reviews', 'review'),
    ],
  },

  users: {
    key: 'users', title: 'System Users', single: 'User', add: true,
    cols: [['Name', (r) => esc(r.fullName)], ['Email', (r) => esc(r.email)], ['Role', (r) => badge(r.role)], ['Phone', (r) => esc(r.phone)]],
    fields: [
      { name: 'fullName', label: 'Full name', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'password', label: 'Password (8+ chars)', type: 'password', required: true },
      { name: 'role', label: 'Role', type: 'select', list: ['staff', 'owner', 'admin'], def: 'staff' },
      { name: 'phone', label: 'Phone' },
    ],
    actions: [],
  },
};

// ---------- PII Reveal & Applicant ID Doc ----------
async function revealTenantPii(t) {
  const r = await api(`/tenants/${t.id}/reveal`, { method: 'POST' });
  openModal(`<div class="modal-head"><h2>${esc(t.fullName)} — Contact Details</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="muted">This reveal event has been recorded in the audit log.</p>
    <p><b>Email:</b> ${esc(r.email || '—')}<br><b>Phone:</b> ${esc(r.contactNumber || '—')}</p>
    <button class="btn" data-close>Close</button>`, true);
}

async function revealAppPii(a) {
  const r = await api(`/applications/${a.id}/reveal`, { method: 'POST' });
  openModal(`<div class="modal-head"><h2>${esc(a.referenceNumber)} — Applicant Contact</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="muted">This reveal event has been recorded in the audit log.</p>
    <p><b>Email:</b> ${esc(r.email || '—')}<br><b>Phone:</b> ${esc(r.contactNumber || '—')}</p>
    <button class="btn" data-close>Close</button>`, true);
}

function openAppDocModal(a) {
  const url = `/api/applications/${a.id}/document`;
  const m = openModal(`<div class="modal-head"><h2>${esc(a.referenceNumber)} — Applicant ID Document</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="muted">Private document (owner/admin access only; access is audited).</p>
    <div style="margin:12px 0"><a class="btn ghost sm" href="${url}" target="_blank" rel="noopener">Open Document in New Tab</a>
    <button class="btn danger sm" id="delDocBtn">Delete ID Document</button></div>`);
  $('#delDocBtn', m).onclick = async () => {
    if (!(await confirmModal('Permanently delete the uploaded ID document for this application?', 'Delete ID Document'))) return;
    await api(`/applications/${a.id}/document`, { method: 'DELETE' });
    m.remove();
    toast('Document deleted.');
    await refresh();
  };
}

// ---------- Applications Review & Convert-to-Tenant ----------
function reviewApplication(a) {
  const rooms = (D.rooms || []).filter((r) => r.propertyId === a.propertyId && (r.availableBeds > 0 || r.id === a.assignedRoomId) && r.status !== 'Maintenance');
  const m = openModal(`<div class="modal-head"><h2>${esc(a.referenceNumber)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p><b>${esc(a.fullName)}</b> · ${esc(a.email)} · ${esc(a.contactNumber)}<br>
    <span class="muted">${esc(propName(a.propertyId))} · wants ${esc(a.preferredRoomType)} · move-in ${esc(a.expectedMoveInDate)} · ${a.occupants} bed(s)</span></p>
    <p>${esc(a.message) || '<i class="muted">No message.</i>'}</p>
    <form id="rev"><div class="grid2">
      <div class="field"><label>Status</label><select name="status">${['Pending', 'Approved', 'Reserved', 'Rejected', 'Cancelled'].map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Assign room (holds ${a.occupants} bed)</label><select name="assignedRoomId"><option value="">— none —</option>${rooms.map((r) => `<option value="${r.id}" ${r.id === a.assignedRoomId ? 'selected' : ''}>${esc(r.roomNumber)} · ${esc(r.roomType)} · ${r.availableBeds} free · ${money(r.monthlyPrice)}</option>`).join('')}</select></div>
      <div class="field"><label>Reservation date</label><input type="date" name="reservationDate" value="${esc(a.reservationDate || '')}"></div>
    </div><button class="btn" type="submit">Save</button></form>`);

  $('#rev', m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/applications/${a.id}/status`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
      m.remove();
      toast('Application updated.');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function openConvertModal(a) {
  const prop = find('properties', a.propertyId);
  const moveIn = a.expectedMoveInDate || manilaTodayClient();
  const m = openModal(`<div class="modal-head"><h2>Convert to Active Tenant: ${esc(a.fullName)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="muted">Assigning to ${esc(roomLabel(a.assignedRoomId))} · ${esc(a.referenceNumber)}</p>
    <form id="convForm">
      <div class="field"><label>Home Address *</label><input name="address" required minlength="3" placeholder="Brgy. / City / Province"></div>
      <div class="field"><label>Emergency Contact (Name & Phone) *</label><input name="emergencyContact" required minlength="3" placeholder="Juan Dela Cruz - 0917 000 0000"></div>
      <div class="grid2">
        <div class="field"><label>Security Deposit (₱) *</label><input name="securityDeposit" type="number" min="0" required value="${esc((find('rooms', a.assignedRoomId) || {}).monthlyPrice || 0)}"></div>
        <div class="field"><label>Move-in Date *</label><input name="moveInDate" type="date" required value="${esc(moveIn)}"></div>
        <div class="field"><label>Lease End Date</label><input name="leaseEndDate" type="date"></div>
        <div class="field"><label>Notes (${prop?.minLeaseMonths || 6} mo min)</label><input name="notes" placeholder="Optional lease notes"></div>
      </div>
      <button class="btn" type="submit">Confirm Move-In & Create Lease</button>
    </form>`);

  $('#convForm', m).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (!body.leaseEndDate) delete body.leaseEndDate;
    try {
      await api(`/applications/${a.id}/convert`, { method: 'POST', body });
      m.remove();
      toast('Tenant & lease created!');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

// ---------- Tenant Checklists & Deposit Refund ----------
function openChecklistModal(t) {
  const m = openModal(`<div class="modal-head"><h2>Move-in / Move-out Checklist: ${esc(t.fullName)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <form id="chkForm">
      <div class="grid2">
        <div class="field"><label>Checklist Type</label><select name="type"><option value="move_in">Move-in Inspection</option><option value="move_out">Move-out & Deposit Refund</option></select></div>
        <div class="field"><label>Electric / Water Meter Reading</label><input name="meterReading" placeholder="e.g. 1420 kWh"></div>
      </div>
      <div class="chk-grid">
        <label class="chk-item"><input type="checkbox" name="keys"> Keys / Keycard Handover</label>
        <label class="chk-item"><input type="checkbox" name="bed"> Bedframe & Mattress OK</label>
        <label class="chk-item"><input type="checkbox" name="ac"> Fan / Aircon Working</label>
        <label class="chk-item"><input type="checkbox" name="plumbing"> Plumbing & Lights OK</label>
      </div>
      <div class="field"><label>Inspection Notes</label><textarea name="notes" rows="2"></textarea></div>
      ${isOwnerOrAdmin() ? `<div class="grid2" style="background:#f8fbfb;padding:10px;border-radius:10px;margin-bottom:10px">
        <div class="field"><label>Security Deposit Held</label><input disabled value="${money(t.securityDeposit || 0)}"></div>
        <div class="field"><label>Deductions (₱)</label><input name="depositDeductions" type="number" min="0" value="${esc(t.depositDeductions || 0)}"></div>
        <div class="field"><label>Amount Refunded (₱)</label><input name="depositRefunded" type="number" min="0" value="${esc(t.depositRefunded || 0)}"></div>
        <div class="field"><label>Refund Date</label><input name="depositRefundedAt" type="date" value="${esc(t.depositRefundedAt || '')}"></div>
      </div>` : ''}
      <button class="btn" type="submit">Save Checklist</button>
    </form>`);

  $('#chkForm', m).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      type: f.elements.type.value,
      meterReading: f.elements.meterReading.value,
      notes: f.elements.notes.value,
      items: {
        keys: f.elements.keys.checked,
        bed: f.elements.bed.checked,
        ac: f.elements.ac.checked,
        plumbing: f.elements.plumbing.checked,
      },
    };
    if (isOwnerOrAdmin()) {
      body.depositDeductions = Number(f.elements.depositDeductions.value || 0);
      body.depositRefunded = Number(f.elements.depositRefunded.value || 0);
      if (f.elements.depositRefundedAt.value) body.depositRefundedAt = f.elements.depositRefundedAt.value;
    }
    try {
      await api(`/tenants/${t.id}/checklist`, { method: 'POST', body });
      m.remove();
      toast('Checklist saved.');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function openTenantPaymentsModal(r) {
  const p = (D.payments || []).filter((x) => x.tenantId === r.id);
  openModal(`<div class="modal-head"><h2>${esc(r.fullName)} — Bills & Payments</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="muted">Move-in ${esc(r.moveInDate)}${r.moveOutDate ? ' · Move-out ' + esc(r.moveOutDate) : ''}</p>
    <div class="scroll"><table class="dt"><tr><th>Month</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr>
    ${p.map((x) => `<tr><td>${esc(x.billingMonth)}</td><td>${money(x.amountDue)}</td><td>${money(x.amountPaid)}</td><td>${money(x.remainingBalance)}</td><td>${badge(x.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No payments yet.</td></tr>'}</table></div>`);
}

// ---------- Installment Transactions Modal ----------
function openTransactionsModal(p) {
  const txs = p.transactions || [];
  const m = openModal(`<div class="modal-head"><h2>Installments: ${esc(tenantName(p.tenantId))} (${esc(p.billingMonth)})</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p>Due: <b>${money(p.amountDue)}</b> · Paid: <b>${money(p.amountPaid)}</b> · Remaining: <b>${money(p.remainingBalance)}</b> · ${badge(p.status)}</p>
    <div style="margin:12px 0">
      ${txs.map((t) => `<div class="tx-row ${t.voidedAt ? 'voided' : ''}">
        <div><b>${money(t.amount)}</b> via ${esc(t.paymentMethod)} on ${esc(t.paymentDate)} <span class="muted">(${esc(t.receiptNumber)})</span>
        ${t.notes ? `<div class="muted">${esc(t.notes)}</div>` : ''}
        ${t.voidReason ? `<div class="muted">Voided: ${esc(t.voidReason)}</div>` : ''}</div>
        ${!t.voidedAt && isOwnerOrAdmin() ? `<div style="display:flex;gap:6px">
          <button class="btn sm ghost" data-edit-tx="${t.id}">Edit</button>
          <button class="btn sm danger" data-void-tx="${t.id}">Void</button>
        </div>` : ''}
      </div>`).join('') || '<div class="muted">No installment transactions recorded yet.</div>'}
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
    <h4>Record New Payment Installment</h4>
    <form id="addTxForm" class="grid2">
      <div class="field"><label>Amount (₱) *</label><input name="amount" type="number" min="1" step="0.01" required value="${p.remainingBalance > 0 ? p.remainingBalance : ''}"></div>
      <div class="field"><label>Payment Date</label><input name="paymentDate" type="date" value="${manilaTodayClient()}"></div>
      <div class="field"><label>Method</label><select name="paymentMethod">${METHODS.map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Notes</label><input name="notes" placeholder="GCash ref / notes"></div>
      <div style="grid-column:1/-1"><button class="btn" type="submit">Add Payment</button></div>
    </form>`);

  $('#addTxForm', m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const updated = await api(`/payments/${p.id}/transactions`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      m.remove();
      toast('Payment recorded!');
      await loadAll();
      go('payments');
      openTransactionsModal(updated);
    } catch (err) {
      toast(err.message, true);
    }
  };

  $$('[data-void-tx]', m).forEach((btn) => {
    btn.onclick = () => {
      const vm = openModal(`<div class="modal-head"><h2>Void Transaction</h2><button class="x" data-close aria-label="Close">×</button></div>
        <form id="voidForm"><div class="field"><label>Reason for voiding *</label><input name="reason" required minlength="3" placeholder="e.g. Duplicate entry"></div>
        <button class="btn danger" type="submit">Confirm Void</button></form>`, true);
      $('#voidForm', vm).onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api(`/payment-transactions/${btn.dataset.voidTx}/void`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
          vm.remove();
          m.remove();
          toast('Transaction voided.');
          await refresh();
        } catch (err) { toast(err.message, true); }
      };
    };
  });

  $$('[data-edit-tx]', m).forEach((btn) => {
    btn.onclick = () => {
      const tx = txs.find((x) => x.id === Number(btn.dataset.editTx));
      const em = openModal(`<div class="modal-head"><h2>Edit Transaction</h2><button class="x" data-close aria-label="Close">×</button></div>
        <form id="editTxForm">
          <div class="field"><label>Amount (₱) *</label><input name="amount" type="number" min="1" step="0.01" required value="${tx.amount}"></div>
          <div class="field"><label>Date *</label><input name="paymentDate" type="date" required value="${esc(tx.paymentDate)}"></div>
          <div class="field"><label>Method</label><select name="paymentMethod">${METHODS.map((x) => `<option ${x === tx.paymentMethod ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label>Notes</label><input name="notes" value="${esc(tx.notes || '')}"></div>
          <div class="field"><label>Audit Reason for Edit *</label><input name="reason" required minlength="3" placeholder="Reason logged to audit trail"></div>
          <button class="btn" type="submit">Save Edit</button>
        </form>`, true);
      $('#editTxForm', em).onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api(`/payment-transactions/${tx.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
          em.remove();
          m.remove();
          toast('Transaction updated.');
          await refresh();
        } catch (err) { toast(err.message, true); }
      };
    };
  });
}

function replyReview(r) {
  const m = openModal(`<div class="modal-head"><h2>Reply to review</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p><b>${esc(r.reviewerName)}</b> · ${esc(propName(r.propertyId))}</p><p>${esc(r.comment)}</p>
    <form id="repForm"><div class="field"><label>Owner reply *</label><textarea name="ownerReply" rows="3" maxlength="600" required>${esc(r.ownerReply || '')}</textarea></div>
      <button class="btn" type="submit">Save reply</button></form>`);
  $('#repForm', m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/reviews/${r.id}/reply`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      m.remove();
      toast('Reply saved.');
      await refresh();
    } catch (err) { toast(err.message, true); }
  };
}

function printReceipt(p) {
  const t = find('tenants', p.tenantId) || {};
  const m = openModal(`<div class="receipt-box">
    <div class="modal-head"><h2>Official Payment Receipt</h2><button class="x no-print" data-close aria-label="Close">×</button></div>
    <p class="muted" style="margin-top:0">CasaBatangueño — Alangilan, Batangas City</p>
    <table class="t">
      <tr><td>Receipt No.</td><td><b>${esc(p.receiptNumber)}</b></td></tr>
      <tr><td>Reference</td><td>${esc(p.referenceNumber)}</td></tr>
      <tr><td>Tenant</td><td>${esc(t.fullName || '—')}</td></tr>
      <tr><td>Property / Room</td><td>${esc(propName(p.propertyId))} / ${esc((find('rooms', p.roomId) || {}).roomNumber || '—')}</td></tr>
      <tr><td>Billing Month</td><td>${esc(p.billingMonth)}</td></tr>
      <tr><td>Last Payment Date</td><td>${esc(p.paymentDate || '—')}</td></tr>
      <tr><td>Amount Due</td><td>${money(p.amountDue)}</td></tr>
      <tr><td><b>Amount Paid</b></td><td><b>${money(p.amountPaid)}</b></td></tr>
      <tr><td>Remaining Balance</td><td>${money(p.remainingBalance)}</td></tr>
      <tr><td>Status</td><td>${badge(p.status)}</td></tr>
    </table>
    <div style="margin-top:14px" class="no-print">
      <button class="btn" id="printNowBtn">Print / Save PDF</button>
      <button class="btn ghost" data-close>Close</button>
    </div>
  </div>`);
  $('#printNowBtn', m).onclick = () => {
    document.body.classList.add('printing-modal');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-modal'), 300);
  };
}

// ---------- Inbox & Operations ----------
function renderInbox(view) {
  const tabs = [
    ['messages', `Messages (${(D.messages || []).filter((x) => x.status === 'New').length})`],
    ['viewings', `Viewings (${(D.viewings || []).filter((x) => x.status === 'Pending').length})`],
    ['maintenance', `Maintenance (${(D.maintenance || []).filter((x) => x.status !== 'Done').length})`],
    ['waitlist', `Waitlist (${(D.waitlist || []).filter((x) => x.status === 'Waiting').length})`],
    ['announcements', 'Announcements'],
    ['testimonials', 'Testimonials'],
  ];

  view.innerHTML = `<div class="head"><h2>Inbox &amp; Operations</h2></div>
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="subtab ${inboxTab === k ? 'on' : ''}" data-itab="${k}">${l}</button>`).join('')}</div>
    <div id="inboxMount"></div>`;

  $$('[data-itab]', view).forEach((b) => {
    b.onclick = () => { inboxTab = b.dataset.itab; renderInbox(view); };
  });

  const mount = $('#inboxMount', view);
  if (inboxTab === 'messages') {
    const list = D.messages || [];
    mount.innerHTML = `<div class="panel scroll"><table class="dt"><thead><tr><th>Date</th><th>From</th><th>Subject</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((m) => `<tr><td>${esc(String(m.createdAt || '').slice(0, 10))}</td><td><b>${esc(m.fullName)}</b><br><span class="muted">${esc(m.email)}</span></td>
        <td>${esc(m.subject)}</td><td style="white-space:normal;min-width:220px">${esc(m.message)}</td><td>${badge(m.status)}</td>
        <td><button class="btn sm ghost" data-mstat="${m.id}:Read">Read</button><button class="btn sm" data-mstat="${m.id}:Replied">Replied</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No contact messages.</td></tr>'}</tbody></table></div>`;
    $$('[data-mstat]', mount).forEach((b) => {
      b.onclick = async () => {
        const [id, status] = b.dataset.mstat.split(':');
        await api(`/messages/${id}/status`, { method: 'PATCH', body: { status } });
        await refresh();
      };
    });
  } else if (inboxTab === 'viewings') {
    const list = D.viewings || [];
    mount.innerHTML = `<div class="panel scroll"><table class="dt"><thead><tr><th>Property</th><th>Visitor</th><th>Schedule</th><th>Notes</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((v) => `<tr><td>${esc(v.propertyName)}</td><td><b>${esc(v.fullName)}</b><br><span class="muted">${esc(v.email)} · ${esc(v.phone)}</span></td>
        <td>${esc(v.preferredDate)} · ${esc(v.preferredTime)}</td><td>${esc(v.notes || '—')}</td><td>${badge(v.status)}</td>
        <td><button class="btn sm" data-vstat="${v.id}:Confirmed">Confirm</button><button class="btn sm ghost" data-vstat="${v.id}:Completed">Done</button><button class="btn sm danger" data-vstat="${v.id}:Cancelled">Cancel</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No viewing requests.</td></tr>'}</tbody></table></div>`;
    $$('[data-vstat]', mount).forEach((b) => {
      b.onclick = async () => {
        const [id, status] = b.dataset.vstat.split(':');
        await api(`/viewings/${id}/status`, { method: 'PATCH', body: { status } });
        toast(`Viewing ${status}.`);
        await refresh();
      };
    });
  } else if (inboxTab === 'maintenance') {
    const list = D.maintenance || [];
    mount.innerHTML = `<div class="panel scroll"><table class="dt"><thead><tr><th>Property / Room</th><th>Resident</th><th>Issue</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td>${esc(x.propertyName)} · ${esc(x.roomNumber)}</td><td>${esc(x.tenantName)}</td>
        <td style="white-space:normal;min-width:220px"><b>${esc(x.title)}</b><br><span class="muted">${esc(x.description)}</span></td>
        <td>${badge(x.priority === 'High' ? 'Overdue' : x.priority)}</td><td>${badge(x.status)}</td>
        <td><button class="btn sm ghost" data-maint="${x.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No maintenance requests.</td></tr>'}</tbody></table></div>`;
    $$('[data-maint]', mount).forEach((b) => {
      b.onclick = () => {
        const item = list.find((x) => x.id === Number(b.dataset.maint));
        const mm = openModal(`<div class="modal-head"><h2>Update Maintenance</h2><button class="x" data-close aria-label="Close">×</button></div>
          <p><b>${esc(item.title)}</b> — ${esc(item.description)}</p>
          <form id="mUpForm">
            <div class="field"><label>Status</label><select name="status">${['Open', 'In Progress', 'Done'].map((s) => `<option ${s === item.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div class="field"><label>Owner Notes</label><textarea name="ownerNotes" rows="3">${esc(item.ownerNotes || '')}</textarea></div>
            <button class="btn" type="submit">Save</button>
          </form>`, true);
        $('#mUpForm', mm).onsubmit = async (e) => {
          e.preventDefault();
          await api(`/maintenance/${item.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
          mm.remove();
          toast('Maintenance updated.');
          await refresh();
        };
      };
    });
  } else if (inboxTab === 'waitlist') {
    const list = D.waitlist || [];
    mount.innerHTML = `<div class="panel scroll"><table class="dt"><thead><tr><th>Property</th><th>Name</th><th>Email</th><th>Preferred Type</th><th>Status</th><th>Notified</th></tr></thead><tbody>
      ${list.map((w) => `<tr><td>${esc(w.propertyName)}</td><td>${esc(w.fullName)}</td><td>${esc(w.email)}</td><td>${esc(w.preferredRoomType)}</td><td>${badge(w.status)}</td><td>${esc(String(w.notifiedAt || '—').slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No waitlist entries.</td></tr>'}</tbody></table></div>`;
  } else if (inboxTab === 'announcements') {
    const list = D.announcements || [];
    mount.innerHTML = `<div class="panel">
      ${isOwnerOrAdmin() ? `<form id="annForm" style="margin-bottom:16px"><h4>Post Resident Announcement</h4>
        <div class="grid2">
          <div class="field"><label>Title *</label><input name="title" required></div>
          <div class="field"><label>Property (blank = all)</label><select name="propertyId"><option value="">All Properties</option>${(D.properties || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Announcement Body *</label><textarea name="body" rows="2" required></textarea></div>
        <button class="btn" type="submit">Publish Announcement</button>
      </form><hr style="border:0;border-top:1px solid var(--line);margin:14px 0">` : ''}
      ${list.map((a) => `<div class="tx-row"><div><b>${esc(a.title)}</b> <span class="badge">${esc(a.propertyName)}</span><div>${esc(a.body)}</div></div>
        ${isOwnerOrAdmin() ? `<button class="btn sm danger" data-del-ann="${a.id}">Delete</button>` : ''}</div>`).join('') || '<div class="empty">No announcements yet.</div>'}
    </div>`;
    const af = $('#annForm', mount);
    if (af) {
      af.onsubmit = async (e) => {
        e.preventDefault();
        await api('/announcements', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        toast('Announcement published.');
        await refresh();
      };
    }
    $$('[data-del-ann]', mount).forEach((b) => {
      b.onclick = async () => { await api(`/announcements/${b.dataset.delAnn}`, { method: 'DELETE' }); await refresh(); };
    });
  } else if (inboxTab === 'testimonials') {
    const list = D.testimonials || [];
    mount.innerHTML = `<div class="panel scroll"><table class="dt"><thead><tr><th>Author</th><th>Property</th><th>Quote</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((t) => `<tr><td><b>${esc(t.authorName)}</b><br><span class="muted">${esc(t.roleLabel)}</span></td><td>${esc(t.propertyName || 'General')}</td>
        <td style="white-space:normal;min-width:220px">"${esc(t.quote)}"</td><td>${badge(t.status)}</td>
        <td>${isOwnerOrAdmin() ? `<button class="btn sm" data-tstat="${t.id}:Approved">Approve</button><button class="btn sm ghost" data-tstat="${t.id}:Rejected">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No testimonials.</td></tr>'}</tbody></table></div>`;
    $$('[data-tstat]', mount).forEach((b) => {
      b.onclick = async () => {
        const [id, status] = b.dataset.tstat.split(':');
        await api(`/testimonials/${id}/status`, { method: 'PATCH', body: { status } });
        await refresh();
      };
    });
  }
}

// ---------- Settings & Audit Logs ----------
function renderSettings(view) {
  const s = D.settings || {};
  view.innerHTML = `<div class="head"><h2>Site Settings</h2></div>
    <div class="panel" style="max-width:680px">
      <form id="settingsForm">
        <div class="field"><label>Business Name *</label><input name="business_name" required value="${esc(s.business_name || '')}"></div>
        <div class="field"><label>Tagline</label><input name="tagline" value="${esc(s.tagline || '')}"></div>
        <div class="grid2">
          <div class="field"><label>Contact Phone *</label><input name="contact_phone" required value="${esc(s.contact_phone || '')}"></div>
          <div class="field"><label>Contact Email *</label><input name="contact_email" type="email" required value="${esc(s.contact_email || '')}"></div>
        </div>
        <div class="field"><label>Office Address *</label><input name="office_address" required value="${esc(s.office_address || '')}"></div>
        <div class="field"><label>Office Hours *</label><input name="office_hours" required value="${esc(s.office_hours || '')}"></div>
        <button class="btn" type="submit">Save Settings</button>
      </form>
    </div>`;
  $('#settingsForm', view).onsubmit = async (e) => {
    e.preventDefault();
    try {
      D.settings = await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      toast('Site settings saved.');
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function renderAuditLogs(view) {
  const logs = D.auditLogs || [];
  view.innerHTML = `<div class="head"><h2>Security &amp; Activity Audit Logs</h2></div>
    <div class="panel scroll"><table class="dt"><thead><tr><th>Timestamp</th><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td>${esc(String(l.createdAt || '').slice(0, 19).replace('T', ' '))}</td><td>${esc(l.actorName)}</td><td>${badge(l.actorRole)}</td>
        <td><b>${esc(l.action)}</b></td><td>${esc(l.entityType)}${l.entityId ? ` #${l.entityId}` : ''}</td>
        <td style="white-space:normal">${esc(l.details ? JSON.stringify(l.details) : '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No audit events recorded yet.</td></tr>'}</tbody></table></div>`;
}

// ---------- date range bar ----------
function rangeBar() {
  const r = rangeState;
  return `<div class="range no-print"><select id="rg">${[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom range']]
    .map(([v, l]) => `<option value="${v}" ${r.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input type="date" id="rs" value="${r.start}" ${r.range === 'custom' ? '' : 'hidden'}><input type="date" id="re" value="${r.end}" ${r.range === 'custom' ? '' : 'hidden'}></div>`;
}
function bindRange(onChange) {
  const apply = () => {
    rangeState = { range: $('#rg').value, start: $('#rs').value, end: $('#re').value };
    if (rangeState.range !== 'custom' || (rangeState.start && rangeState.end)) onChange();
    else $('#rs').hidden = $('#re').hidden = false;
  };
  $('#rg').onchange = apply;
  $('#rs').onchange = apply;
  $('#re').onchange = apply;
}
const rangeQuery = () => `range=${rangeState.range}&start=${rangeState.start}&end=${rangeState.end}`;

// ---------- dashboard ----------
async function renderDashboard(view) {
  view.innerHTML = `<div class="head"><h2>Overview</h2>${rangeBar()}</div><div id="dash"><div class="empty">Loading…</div></div>`;
  bindRange(() => renderDashboard(view));
  let data;
  try {
    data = await api('/dashboard/summary?' + rangeQuery());
  } catch (e) {
    return ($('#dash').innerHTML = `<div class="empty">${esc(e.message)}</div>`);
  }
  const k = data.kpis, c = data.charts;
  const cards = [
    ['Properties', k.totalProperties], ['Buildings', k.totalBuildings], ['Rooms', k.totalRooms],
    ['Available', k.availableRooms, 'good'], ['Occupied', k.occupiedRooms], ['Reserved', k.reservedRooms],
    ['Active Tenants', k.totalTenants], ['Expiring Leases (≤30d)', k.expiringLeases ?? 0, k.expiringLeases ? 'warn' : ''],
    ['Collected (Due Month)', money(k.totalCollected), 'good'], ['Collected (Pay Date)', money(k.collectedByPaymentDate ?? k.totalCollected), 'good'],
    ['Pending Balances', money(k.pendingPayments), 'warn'], ['Overdue', money(k.overduePayments), 'bad'],
    ['Expenses', money(k.monthlyExpenses), 'warn'], ['Net Income', money(k.netIncome), k.netIncome >= 0 ? 'good' : 'bad'],
  ];
  $('#dash').innerHTML = `<div class="kpis">${cards.map(([l, v, cl]) => `<div class="kpi ${cl || ''}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
    <div class="charts">${['Income (Due Month vs Payment Date)', 'Monthly Expenses', 'Income vs. Expenses', 'Room Occupancy', 'Payment Status', 'Property Performance']
      .map((t, i) => `<div class="panel"><h3>${t}</h3><div class="chart-box"><canvas id="c${i}"></canvas></div></div>`).join('')}</div>`;
  const colors = ['#0f766e', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6'];
  const mk = (i, type, labels, datasets, extra = {}) => charts.push(new Chart($('#c' + i), { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, ...extra } }));
  const scale = { scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₱' + v.toLocaleString() } } } };
  mk(0, 'bar', c.months, [
    { label: 'By Due Month', data: c.incomeByDueMonth || c.incomeByMonth, backgroundColor: '#0f766e' },
    { label: 'By Payment Date', data: c.incomeByPaymentDate || c.incomeByMonth, backgroundColor: '#3b82f6' },
  ], scale);
  mk(1, 'bar', c.months, [{ label: 'Expenses', data: c.expenseByMonth, backgroundColor: '#f59e0b' }], scale);
  mk(2, 'line', c.months, [
    { label: 'Income', data: c.incomeByDueMonth || c.incomeByMonth, borderColor: '#0f766e', tension: 0.3 },
    { label: 'Expenses', data: c.expenseByMonth, borderColor: '#ef4444', tension: 0.3 },
  ], scale);
  mk(3, 'doughnut', c.occupancy.labels, [{ data: c.occupancy.values, backgroundColor: ['#16a34a', '#3b82f6', '#f59e0b', '#ef4444'] }]);
  mk(4, 'pie', c.paymentStatus.labels, [{ data: c.paymentStatus.values, backgroundColor: ['#16a34a', '#f59e0b', '#3b82f6', '#ef4444'] }]);
  mk(5, 'bar', c.propertyPerformance.labels, [{ label: 'Collected', data: c.propertyPerformance.values, backgroundColor: colors }], { ...scale, indexAxis: 'y', scales: { x: { beginAtZero: true } } });
}

// ---------- reports & analytics ----------
async function renderReports(view) {
  view.innerHTML = `<div class="head"><h2>Financial Reports &amp; Analytics</h2>${rangeBar()}</div><div id="rep"><div class="empty">Loading…</div></div>`;
  bindRange(() => renderReports(view));
  let r;
  try {
    r = await api('/reports/financial?' + rangeQuery());
  } catch (e) {
    return ($('#rep').innerHTML = `<div class="empty">${esc(e.message)}</div>`);
  }
  const s = r.summary, o = r.occupancy, an = r.analytics || {};
  const isPayBasis = reportBasis === 'payment';
  const collectedVal = isPayBasis ? s.collectedByPaymentDate : s.collected;
  const netVal = isPayBasis ? s.netIncomeByPaymentDate : s.netIncome;

  const table = (head, rows) => `<div class="scroll"><table class="dt"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="empty">No data</td></tr>`}</table></div>`;
  $('#rep').innerHTML = `<div class="tools no-print" style="margin-bottom:14px;justify-content:space-between;width:100%">
      <div class="subtabs" style="margin:0">
        <button class="subtab ${!isPayBasis ? 'on' : ''}" id="basisDue">By Due Month</button>
        <button class="subtab ${isPayBasis ? 'on' : ''}" id="basisPay">By Payment Date</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ghost" id="print">🖨 Print</button>
        <button class="btn ghost" id="csv">CSV</button>
        <button class="btn ghost" id="pdf">PDF</button>
        <button class="btn ghost" id="xls">Excel</button>
      </div>
    </div>
    <div class="kpis">${[
      ['Expected income', money(s.expectedIncome)],
      [isPayBasis ? 'Collected (Payment Date)' : 'Collected (Due Month)', money(collectedVal), 'good'],
      ['Outstanding', money(s.outstanding), 'warn'],
      ['Expenses', money(s.expenses), 'warn'],
      ['Net income', money(netVal), netVal >= 0 ? 'good' : 'bad'],
      ['Collection Rate', (an.collectionRate ?? 0) + '%', 'good'],
      ['Occupancy Rate', o.percent + '%'],
      ['Avg Vacancy Days', (an.avgVacancyDays ?? 0) + 'd'],
    ].map(([l, v, cl]) => `<div class="kpi ${cl || ''}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
    <div class="panel"><h3>Monthly Comparison: Due Month vs. Payment Date</h3>${table(['Month', 'Expected (Due)', 'Collected (Due Month)', 'Collected (Payment Date)'], (r.byDueMonth || []).map((m, i) => [esc(m.month), money(m.expected), money(m.collected), money((r.byPaymentDate[i] || {}).collected || 0)]))}</div>
    <div class="panel"><h3>Per Property (${isPayBasis ? 'Payment Date' : 'Due Month'})</h3>${table(['Property', 'Income', 'Expenses', 'Net'], r.byProperty.map((p) => { const inc = isPayBasis ? p.incomeByPayDate : p.income; return [esc(p.name), money(inc), money(p.expenses), money(inc - p.expenses)]; }))}</div>
    <div class="panel"><h3>Listing Views vs. Applications</h3>${table(['Property', 'Listing Views', 'Applications'], (an.viewsVsApplications || []).map((v) => [esc(v.propertyName), v.views, v.applications]))}</div>
    <div class="panel"><h3>Expenses by Category</h3>${table(['Category', 'Amount'], r.byCategory.map((c) => [esc(c.category), money(c.amount)]))}</div>
    <div class="panel"><h3>Per Tenant</h3>${table(['Tenant', 'Paid', 'Balance'], r.byTenant.map((t) => [esc(t.name), money(t.paid), money(t.balance)]))}</div>`;

  $('#basisDue').onclick = () => { reportBasis = 'due'; renderReports(view); };
  $('#basisPay').onclick = () => { reportBasis = 'payment'; renderReports(view); };
  $('#print').onclick = () => window.print();
  $('#csv').onclick = () => exportCsv(r);
  $('#pdf').onclick = () => exportPdf(r);
  $('#xls').onclick = () => exportExcel(r);
}

function exportCsv(r) {
  const s = r.summary;
  const lines = [
    ['Section', 'Item', 'Value 1', 'Value 2', 'Value 3'],
    ['Summary', 'Period', r.range.start, r.range.end, ''],
    ['Summary', 'Expected Income', s.expectedIncome, '', ''],
    ['Summary', 'Collected (Due Month)', s.collected, '', ''],
    ['Summary', 'Collected (Payment Date)', s.collectedByPaymentDate, '', ''],
    ['Summary', 'Outstanding', s.outstanding, '', ''],
    ['Summary', 'Expenses', s.expenses, '', ''],
    ['Summary', 'Net Income (Due)', s.netIncome, '', ''],
    ...r.byProperty.map((p) => ['Property', p.name, p.income, p.incomeByPayDate, p.expenses]),
    ...r.byCategory.map((c) => ['Expense Category', c.category, c.amount, '', '']),
    ...r.byTenant.map((t) => ['Tenant', t.name, t.paid, t.balance, '']),
  ];
  const csv = lines.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CasaBatangueno-report-${r.range.start}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPdf(r) {
  const doc = new jspdf.jsPDF();
  const peso = (n) => 'PHP ' + Number(n || 0).toLocaleString('en-PH');
  doc.setFontSize(16);
  doc.text('CasaBatangueño - Financial Report', 14, 16);
  doc.setFontSize(10);
  doc.text(`Period: ${r.range.start} to ${r.range.end}`, 14, 23);
  const s = r.summary;
  doc.autoTable({
    startY: 28,
    head: [['Metric', 'Amount']],
    body: [
      ['Expected income', peso(s.expectedIncome)],
      ['Collected (by due month)', peso(s.collected)],
      ['Collected (by payment date)', peso(s.collectedByPaymentDate)],
      ['Outstanding', peso(s.outstanding)],
      ['Expenses', peso(s.expenses)],
      ['Net income', peso(s.netIncome)],
      ['Occupancy', r.occupancy.percent + '%'],
    ],
  });
  doc.autoTable({ head: [['Property', 'Due Income', 'Pay-Date Income', 'Expenses']], body: r.byProperty.map((p) => [p.name, peso(p.income), peso(p.incomeByPayDate), peso(p.expenses)]) });
  doc.autoTable({ head: [['Expense category', 'Amount']], body: r.byCategory.map((c) => [c.category, peso(c.amount)]) });
  doc.save('CasaBatangueño-report.pdf');
}

function exportExcel(r) {
  const wb = XLSX.utils.book_new(), s = r.summary;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Metric', 'Amount'], ['Period', `${r.range.start} to ${r.range.end}`],
    ['Expected income', s.expectedIncome], ['Collected (Due Month)', s.collected],
    ['Collected (Payment Date)', s.collectedByPaymentDate], ['Outstanding', s.outstanding],
    ['Expenses', s.expenses], ['Net income', s.netIncome], ['Occupancy %', r.occupancy.percent],
  ]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.byProperty), 'Per property');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.byCategory), 'Expenses');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.byTenant), 'Per tenant');
  XLSX.writeFile(wb, 'CasaBatangueño-report.xlsx');
}

// ---------- boot ----------
(async function boot() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return showLogin();
    user = await res.json();
    if (user.role === 'customer') {
      return showLogin('Customer accounts use My Account (/account.html). Please sign in with a management account.');
    }
    await startShell();
  } catch {
    showLogin();
  }
})();
