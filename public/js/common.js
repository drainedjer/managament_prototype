/* common.js - shared helpers: httpOnly cookie + CSRF API calls, XSS escaping, safe URLs, accessible modals, image fallbacks */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function safeUrl(u, fallback = '/images/placeholder.svg') {
  const s = String(u || '').trim();
  if (!s) return fallback;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const parsed = new URL(s);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return s;
  } catch {
    return fallback;
  }
  return fallback;
}

function manilaTodayClient() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

let csrfCache = '';
async function ensureCsrfToken() {
  const fromCookie = getCookie('cb_csrf');
  if (fromCookie) {
    csrfCache = fromCookie;
    return fromCookie;
  }
  if (csrfCache) return csrfCache;
  const r = await fetch('/api/auth/csrf', { credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  csrfCache = data.csrfToken || getCookie('cb_csrf') || '';
  return csrfCache;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = await ensureCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const res = await fetch('/api' + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (data && data.csrfToken) csrfCache = data.csrfToken;
  if (res.status === 401 && typeof onSessionExpired === 'function') {
    onSessionExpired();
  }
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

/** Opens an accessible, Escape-closable, focus-trapped modal. */
function openModal(html, small = false) {
  const prevFocus = document.activeElement;
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${small ? 'sm' : ''}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;

  const origRemove = bg.remove.bind(bg);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('printing-modal');
    origRemove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
  };
  bg.remove = close;

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = [...bg.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close();
  });
  bg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);

  const firstInput = bg.querySelector('input,select,textarea,button:not(.x)');
  (firstInput || bg.querySelector('.modal')).focus();
  return bg;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 2 * 1024 * 1024) return reject(new Error('File must be 2 MB or smaller.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

// Global CSP-safe image fallback for any broken <img>
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && !img.dataset.fbApplied) {
      img.dataset.fbApplied = '1';
      img.src = '/images/placeholder.svg';
    }
  },
  true
);

const STATUS_CLASS = {
  Paid: 'b-ok', Active: 'b-ok', Available: 'b-ok', Approved: 'b-ok', Completed: 'b-ok', Replied: 'b-ok', Done: 'b-ok', Confirmed: 'b-ok', Notified: 'b-ok',
  Partial: 'b-warn', Pending: 'b-warn', New: 'b-warn', Expiring: 'b-warn', 'In Progress': 'b-warn', Waiting: 'b-warn', Open: 'b-warn',
  Reserved: 'b-info', Read: 'b-info', Occupied: 'b-info',
  Overdue: 'b-bad', Rejected: 'b-bad', Maintenance: 'b-bad', Cancelled: 'b-bad', 'Former Tenant': 'b-bad', Inactive: 'b-bad',
};
const badge = (s) => `<span class="badge ${STATUS_CLASS[s] || ''}">${esc(s)}</span>`;
