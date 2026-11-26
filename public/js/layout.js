/* layout.js - shared header, dynamic settings footer, and navigation state across public pages */
(function initLayout() {
  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  const links = [
    ['/', 'Home'],
    ['/rentals.html', 'Find a Rental'],
    ['/how-it-works.html', 'How it Works'],
    ['/about.html', 'About / FAQ'],
  ];

  const headerHtml = `<header class="nav"><div class="container">
    <a class="logo" href="/">Casa<span>Batangueño</span></a>
    <button class="burger btn ghost sm" id="burger" aria-label="Toggle menu" aria-expanded="false" aria-controls="navLinks">☰</button>
    <nav class="nav-links" id="navLinks" aria-label="Primary">
      ${links.map(([href, label]) => `<a href="${href}" class="${path === href ? 'active' : ''}">${label}</a>`).join('')}
      <a class="btn ghost sm ${path === '/account.html' ? 'active' : ''}" href="/account.html" id="navAccount">My Account</a>
      <a class="btn sm" href="/owner.html" id="navOwner">Owner Portal</a>
    </nav>
  </div></header>`;

  const year = new Date().getFullYear();
  const footerHtml = `<footer><div class="container">
    <div class="footer-grid">
      <div>
        <h3 id="ftName">CasaBatangueño</h3>
        <p id="ftTagline">Verified apartments, dormitories, boarding houses, and private rooms in Alangilan, Batangas City—built for students and young professionals.</p>
      </div>
      <div>
        <h4>Quick Links</h4>
        <div class="footer-links">
          ${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}
          <a href="/account.html">Customer Account</a>
          <a href="/owner.html">Owner Portal</a>
          <a href="/privacy.html">Privacy Policy (RA 10173)</a>
          <a href="/terms.html">Terms of Service</a>
        </div>
      </div>
      <div>
        <h4>Management Office</h4>
        <div class="footer-links" id="ftOffice">
          <span>Alangilan, Batangas City</span>
          <a href="mailto:owner@casa-bat.com">owner@casa-bat.com</a>
          <a href="tel:+639175550101">+63 917 555 0101</a>
          <span>Mon – Sat, 8:00 AM – 6:00 PM</span>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} <span id="ftCopyName">CasaBatangueño</span>. All rights reserved.</span>
      <span>Alangilan, Batangas City Rental Management</span>
    </div>
  </div></footer>`;

  const hSlot = document.getElementById('site-header');
  if (hSlot) hSlot.outerHTML = headerHtml;
  else document.body.insertAdjacentHTML('afterbegin', headerHtml);

  const fSlot = document.getElementById('site-footer');
  if (fSlot) fSlot.outerHTML = footerHtml;
  else document.body.insertAdjacentHTML('beforeend', footerHtml);

  const burger = document.getElementById('burger');
  const navLinks = document.getElementById('navLinks');
  if (burger && navLinks) {
    burger.onclick = () => {
      const open = navLinks.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    };
    navLinks.onclick = (e) => {
      if (e.target.tagName === 'A') {
        navLinks.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    };
  }

  // Hydrate footer office info from settings
  fetch('/api/public/settings')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s) return;
      if (s.business_name) {
        $('#ftName').textContent = s.business_name;
        $('#ftCopyName').textContent = s.business_name;
      }
      if (s.tagline) $('#ftTagline').textContent = s.tagline;
      const office = $('#ftOffice');
      if (office) {
        office.innerHTML = `
          <span>${esc(s.office_address || 'Alangilan, Batangas City')}</span>
          <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>
          <a href="tel:${esc(String(s.contact_phone || '').replace(/\s+/g, ''))}">${esc(s.contact_phone)}</a>
          <span>${esc(s.office_hours || 'Mon – Sat, 8:00 AM – 6:00 PM')}</span>`;
      }
    })
    .catch(() => {});

  // Highlight logged-in user gently in header without throwing 401 errors
  fetch('/api/auth/me', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((u) => {
      if (!u) return;
      window.__currentUser = u;
      const acct = $('#navAccount');
      if (acct && u.role === 'customer') acct.textContent = u.fullName.split(' ')[0] + "'s Account";
      const own = $('#navOwner');
      if (own && ['owner', 'staff', 'admin'].includes(u.role)) own.textContent = 'Dashboard';
      document.dispatchEvent(new CustomEvent('cb:auth-loaded', { detail: u }));
    })
    .catch(() => {});
})();
