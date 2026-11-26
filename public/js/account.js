/* account.js - Customer Portal: login, register, forgot/reset password, profile, favorites, applications, lease/payments + receipts, maintenance, announcements, RA 10173 data export/deletion */
const root = $('#accountRoot');
let me = null;
let activeTab = 'applications';

function printCustomerReceipt(p, t) {
  const m = openModal(`<div class="receipt-box">
    <div class="modal-head"><h2>Official Payment Receipt</h2><button class="x no-print" data-close aria-label="Close">×</button></div>
    <p class="muted" style="margin-top:0">CasaBatangueño — Alangilan, Batangas City</p>
    <table class="t">
      <tr><td>Receipt No.</td><td><b>${esc(p.receiptNumber)}</b></td></tr>
      <tr><td>Reference</td><td>${esc(p.referenceNumber)}</td></tr>
      <tr><td>Resident</td><td>${esc(t?.fullName || me.fullName)}</td></tr>
      <tr><td>Property / Room</td><td>${esc(t?.propertyName || '—')} / ${esc(t?.roomNumber || '—')}</td></tr>
      <tr><td>Billing Month</td><td>${esc(p.billingMonth)}</td></tr>
      <tr><td>Due Date</td><td>${esc(p.dueDate)}</td></tr>
      <tr><td>Amount Due</td><td>${money(p.amountDue)}</td></tr>
      <tr><td><b>Total Paid</b></td><td><b>${money(p.amountPaid)}</b></td></tr>
      <tr><td>Remaining Balance</td><td>${money(p.remainingBalance)}</td></tr>
      <tr><td>Status</td><td>${badge(p.status)}</td></tr>
    </table>
    <div style="margin-top:14px" class="no-print">
      <button class="btn" id="doPrintBtn">Print / Save PDF</button>
      <button class="btn ghost" data-close>Close</button>
    </div>
  </div>`);
  $('#doPrintBtn', m).onclick = () => {
    document.body.classList.add('printing-modal');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-modal'), 300);
  };
}

function renderAuthView() {
  const qs = new URLSearchParams(location.search);
  const resetToken = qs.get('resetToken') || '';
  if (resetToken) {
    root.innerHTML = `<div class="panel-card" style="max-width:480px;margin:0 auto">
      <h2>Set a New Password</h2>
      <p class="muted">Enter your new password below (minimum 8 characters).</p>
      <form id="resetPwForm">
        <input type="hidden" name="token" value="${esc(resetToken)}">
        <div class="field"><label for="npw">New password *</label><input id="npw" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
        <button class="btn" type="submit">Update password</button>
      </form>
    </div>`;
    $('#resetPwForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const res = await api('/auth/reset-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        toast(res.message);
        history.replaceState(null, '', '/account.html');
        renderAuthView();
      } catch (err) {
        toast(err.message, true);
      }
    };
    return;
  }

  root.innerHTML = `<div class="about-grid">
    <div class="panel-card">
      <h2>Sign In to Your Account</h2>
      <p class="muted">Access your saved rentals, track applications, view lease balances & receipts, and submit maintenance requests.</p>
      <form id="custLoginForm">
        <div class="field"><label for="clEmail">Email *</label><input id="clEmail" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="clPass">Password *</label><input id="clPass" name="password" type="password" required autocomplete="current-password"></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn" type="submit">Sign in</button>
          <button type="button" class="btn ghost sm" id="forgotBtn">Forgot password?</button>
        </div>
      </form>
      <p class="muted" style="margin-top:14px;margin-bottom:0">Property owner or staff? <a href="/owner.html">Go to Owner Portal →</a></p>
    </div>

    <div class="panel-card">
      <h2>Create Resident / Applicant Account</h2>
      <p class="muted">Register once to pre-fill applications and save favorite listings in Alangilan.</p>
      <form id="custRegForm">
        <div class="field"><label for="crName">Full name *</label><input id="crName" name="fullName" required minlength="2"></div>
        <div class="field"><label for="crEmail">Email *</label><input id="crEmail" name="email" type="email" required></div>
        <div class="field"><label for="crPhone">Mobile number</label><input id="crPhone" name="phone" placeholder="09XX XXX XXXX"></div>
        <div class="field"><label for="crPass">Password * (min 8 characters)</label><input id="crPass" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
        <label class="consent-row"><input type="checkbox" name="consentAccepted" required> <span>I accept the <a href="/privacy.html" target="_blank">Privacy Policy (RA 10173)</a> and <a href="/terms.html" target="_blank">Terms of Service</a>.</span></label>
        <button class="btn" type="submit">Create account</button>
      </form>
    </div>
  </div>`;

  $('#custLoginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      me = r.user;
      window.__currentUser = me;
      await renderPortal();
    } catch (err) {
      toast(err.message, true);
    }
  };

  $('#custRegForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.consentAccepted = e.target.elements.consentAccepted.checked;
    try {
      const r = await api('/auth/register', { method: 'POST', body });
      me = r.user;
      window.__currentUser = me;
      toast('Account created!');
      await renderPortal();
    } catch (err) {
      toast(err.message, true);
    }
  };

  $('#forgotBtn').onclick = () => {
    const m = openModal(`<div class="modal-head"><h2>Reset Password</h2><button class="x" data-close aria-label="Close">×</button></div>
      <p class="muted">Enter your registered email address and we will send a password reset link.</p>
      <form id="fpForm"><div class="field"><label for="fpEmail">Email *</label><input id="fpEmail" name="email" type="email" required></div>
      <button class="btn" type="submit">Send reset link</button></form>`, true);
    $('#fpForm', m).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const res = await api('/auth/forgot-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        m.remove();
        toast(res.message);
      } catch (err) {
        toast(err.message, true);
      }
    };
  };
}

async function renderPortal() {
  const tabs = [
    ['applications', 'My Applications'],
    ['favorites', 'Favorites'],
    ['lease', 'My Lease & Payments'],
    ['maintenance', 'Maintenance'],
    ['announcements', 'Announcements'],
    ['profile', 'Profile & Privacy'],
  ];

  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <div><h2 style="margin:0">Welcome, ${esc(me.fullName)}</h2><div class="muted">${esc(me.email)} · ${badge(me.role)}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${['owner', 'staff', 'admin'].includes(me.role) ? '<a class="btn ghost sm" href="/owner.html">Open Owner Dashboard</a>' : ''}
      <button class="btn ghost sm" id="custLogout">Log out</button>
    </div>
  </div>
  <div class="acct-tabs" role="tablist">${tabs.map(([k, lbl]) => `<button class="acct-tab ${activeTab === k ? 'on' : ''}" data-tab="${k}" role="tab">${lbl}</button>`).join('')}</div>
  <div id="acctBody"><div class="empty">Loading…</div></div>`;

  $('#custLogout').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    me = null;
    window.__currentUser = null;
    renderAuthView();
  };

  $$('[data-tab]', root).forEach((b) => {
    b.onclick = () => {
      activeTab = b.dataset.tab;
      renderPortal();
    };
  });

  const body = $('#acctBody');
  try {
    if (activeTab === 'applications') {
      const apps = await api('/customer/applications');
      body.innerHTML = `<div class="panel-card"><h3>My Rental Applications</h3>
        ${apps.length ? `<div style="overflow:auto"><table class="t"><thead><tr><th>Reference</th><th>Property</th><th>Room</th><th>Move-in</th><th>Status</th></tr></thead>
          <tbody>${apps.map((a) => `<tr><td><b>${esc(a.referenceNumber)}</b></td><td>${esc(a.propertyName)}</td><td>${esc(a.roomNumber || a.preferredRoomType)}</td><td>${esc(a.expectedMoveInDate)}</td><td>${badge(a.status)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">You have not submitted any applications yet. <a href="/rentals.html">Browse rentals →</a></div>'}</div>`;
    } else if (activeTab === 'favorites') {
      const favs = await api('/customer/favorites');
      favoriteIds = new Set(favs.map((f) => Number(f.id)));
      body.innerHTML = favs.length
        ? `<div class="cards">${favs.map((p) => propertyCardHtml(p, null)).join('')}</div>`
        : '<div class="panel-card empty">No saved favorites yet. Tap the heart icon on any listing in <a href="/rentals.html">Find a Rental</a>.</div>';
    } else if (activeTab === 'lease') {
      const data = await api('/customer/lease');
      const primaryTenant = data.tenants[0] || null;
      body.innerHTML = `<div class="panel-card" style="margin-bottom:16px"><h3>Lease Summary</h3>
        ${data.leases.length ? `<div style="overflow:auto"><table class="t"><thead><tr><th>Property</th><th>Room</th><th>Start</th><th>End</th><th>Monthly Rate</th><th>Deposit</th><th>Status</th></tr></thead>
          <tbody>${data.leases.map((l) => `<tr><td>${esc(l.propertyName)}</td><td>${esc(l.roomNumber)}</td><td>${esc(l.startDate)}</td><td>${esc(l.endDate)}</td><td>${money(l.monthlyRate)}</td><td>${money(l.depositAmount)}</td><td>${badge(l.status)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">No active lease linked to your email yet.</div>'}</div>
        <div class="panel-card"><h3>Billing & Payment Receipts</h3>
          ${data.payments.length ? `<div style="overflow:auto"><table class="t"><thead><tr><th>Month</th><th>Due Date</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>${data.payments.map((p) => `<tr><td>${esc(p.billingMonth)}</td><td>${esc(p.dueDate)}</td><td>${money(p.amountDue)}</td><td>${money(p.amountPaid)}</td><td>${money(p.remainingBalance)}</td><td>${badge(p.status)}</td>
              <td><button class="btn sm ghost" data-rcpt="${p.id}">Receipt</button></td></tr>`).join('')}</tbody></table></div>`
            : '<div class="empty">No payment records found.</div>'}</div>`;
      $$('[data-rcpt]', body).forEach((btn) => {
        btn.onclick = () => {
          const p = data.payments.find((x) => x.id === Number(btn.dataset.rcpt));
          if (p) printCustomerReceipt(p, primaryTenant);
        };
      });
    } else if (activeTab === 'maintenance') {
      const [reqs, leaseData, props] = await Promise.all([
        api('/customer/maintenance'),
        api('/customer/lease'),
        api('/public/properties'),
      ]);
      const activeT = leaseData.tenants.find((t) => t.status === 'Active');
      body.innerHTML = `<div class="about-grid">
        <div class="panel-card"><h3>Submit Maintenance Request</h3>
          <form id="maintForm">
            <div class="field"><label for="mpProp">Property *</label><select id="mpProp" name="propertyId" required>
              ${props.map((p) => `<option value="${p.id}" ${activeT && activeT.propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select></div>
            <div class="field"><label for="mpTitle">Issue summary *</label><input id="mpTitle" name="title" required placeholder="e.g. Leaking faucet in bathroom"></div>
            <div class="field"><label for="mpPri">Priority</label><select id="mpPri" name="priority"><option>Low</option><option selected>Medium</option><option>High</option></select></div>
            <div class="field"><label for="mpDesc">Details *</label><textarea id="mpDesc" name="description" rows="3" required minlength="5"></textarea></div>
            <button class="btn" type="submit">Submit request</button>
          </form>
        </div>
        <div class="panel-card"><h3>My Maintenance Requests</h3>
          ${reqs.length ? reqs.map((r) => `<div class="review-item">
            <div class="review-head"><b>${esc(r.title)}</b>${badge(r.status)}</div>
            <div class="muted">${esc(r.propertyName)} · Room ${esc(r.roomNumber)} · Priority: ${esc(r.priority)}</div>
            <p style="margin:6px 0 0">${esc(r.description)}</p>
            ${r.ownerNotes ? `<div class="owner-reply"><b>Management note:</b> ${esc(r.ownerNotes)}</div>` : ''}
          </div>`).join('') : '<div class="empty">No maintenance requests yet.</div>'}
        </div>
      </div>`;
      $('#maintForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/customer/maintenance', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
          toast('Maintenance request submitted.');
          renderPortal();
        } catch (err) {
          toast(err.message, true);
        }
      };
    } else if (activeTab === 'announcements') {
      const list = await api('/customer/announcements');
      body.innerHTML = list.length
        ? `<div class="announce-list">${list.map((a) => `<article class="announce-card">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(a.title)}</b><span class="badge">${esc(a.propertyName)}</span></div>
            <p style="margin:8px 0 4px">${esc(a.body)}</p>
            <div class="muted">${esc(String(a.createdAt || '').slice(0, 10))}</div>
          </article>`).join('')}</div>`
        : '<div class="panel-card empty">No announcements at the moment.</div>';
    } else if (activeTab === 'profile') {
      body.innerHTML = `<div class="about-grid">
        <div class="panel-card"><h3>Profile Details</h3>
          <form id="profForm">
            <div class="field"><label for="pfName">Full name *</label><input id="pfName" name="fullName" required value="${esc(me.fullName)}"></div>
            <div class="field"><label for="pfPhone">Phone</label><input id="pfPhone" name="phone" value="${esc(me.phone || '')}"></div>
            <button class="btn" type="submit">Save profile</button>
          </form>
          <hr style="margin:18px 0;border:0;border-top:1px solid var(--line)">
          <h3>Change Password</h3>
          <form id="pwForm">
            <div class="field"><label for="pwCur">Current password *</label><input id="pwCur" name="currentPassword" type="password" required></div>
            <div class="field"><label for="pwNew">New password * (8+ chars)</label><input id="pwNew" name="newPassword" type="password" minlength="8" required></div>
            <button class="btn" type="submit">Update password</button>
          </form>
        </div>
        <div class="panel-card"><h3>Privacy &amp; Data Rights (RA 10173)</h3>
          <p class="muted">You may download a copy of all personal records stored in your account or permanently delete your customer account.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
            <a class="btn ghost" href="/api/auth/my-data" download="casabatangueno-my-data.json">Download my data (JSON)</a>
          </div>
          ${me.role === 'customer' ? `<hr style="margin:16px 0;border:0;border-top:1px solid var(--line)">
            <h4 style="color:var(--bad);margin-top:0">Delete My Account</h4>
            <p class="muted">This anonymizes your account and removes saved favorites and personal contact info.</p>
            <form id="delAcctForm">
              <div class="field"><label for="delPw">Confirm password *</label><input id="delPw" name="password" type="password" required></div>
              <button class="btn danger" type="submit">Delete my account</button>
            </form>` : ''}
        </div>
      </div>`;

      $('#profForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          me = await api('/auth/profile', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
          window.__currentUser = me;
          toast('Profile updated.');
          renderPortal();
        } catch (err) { toast(err.message, true); }
      };
      $('#pwForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
          e.target.reset();
          toast(r.message);
        } catch (err) { toast(err.message, true); }
      };
      const delF = $('#delAcctForm');
      if (delF) {
        delF.onsubmit = async (e) => {
          e.preventDefault();
          try {
            const r = await api('/auth/delete-account', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
            toast(r.message);
            me = null;
            window.__currentUser = null;
            renderAuthView();
          } catch (err) { toast(err.message, true); }
        };
      }
    }
  } catch (err) {
    body.innerHTML = `<div class="panel-card empty">${esc(err.message)}</div>`;
  }
}

(async function bootAccount() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (r.ok) {
      me = await r.json();
      window.__currentUser = me;
      await renderPortal();
      return;
    }
  } catch {
    // not logged in
  }
  renderAuthView();
})();
