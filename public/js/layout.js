/* layout.js - injects shared public header (with active link) and footer on every public page */
(function initLayout() {
  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  const links = [
    ['/', 'Home'],
    ['/rentals.html', 'Find a Rental'],
    ['/how-it-works.html', 'How it Works'],
    ['/about.html', 'About / FAQ'],
    ['/contact.html', 'Contact'],
  ];

  const headerHtml = `<header class="nav"><div class="container">
    <a class="logo" href="/">Casa<span>Batangueño</span></a>
    <button class="burger btn ghost sm" id="burger" aria-label="Menu">☰</button>
    <nav class="nav-links" id="navLinks">
      ${links.map(([href, label]) => `<a href="${href}" class="${path === href ? 'active' : ''}">${label}</a>`).join('')}
      <a class="btn sm" href="/owner.html">Login</a>
    </nav>
  </div></header>`;

  const year = new Date().getFullYear();
  const footerHtml = `<footer id="contact"><div class="container">
    <div class="footer-grid">
      <div>
        <h3>CasaBatangueño</h3>
        <p>Verified apartments, dormitories, boarding houses, and private rooms in Alangilan, Batangas City—built for students and young professionals.</p>
      </div>
      <div>
        <h4>Quick Links</h4>
        <div class="footer-links">
          ${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}
          <a href="/owner.html">Owner Portal</a>
        </div>
      </div>
      <div>
        <h4>Contact Us</h4>
        <div class="footer-links">
          <span>Alangilan, Batangas City</span>
          <a href="mailto:owner@casa-bat.com">owner@casa-bat.com</a>
          <a href="tel:+639175550101">+63 917 555 0101</a>
          <span>Mon – Sat, 8:00 AM – 6:00 PM</span>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} CasaBatangueño. All rights reserved.</span>
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
    burger.onclick = () => navLinks.classList.toggle('open');
    navLinks.onclick = (e) => { if (e.target.tagName === 'A') navLinks.classList.remove('open'); };
  }
})();
