/* common.js - helpers shared by both portals (API calls, escaping, formatting, toasts) */
const TOKEN_KEY = 'CasaBatangueño_token';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && typeof onSessionExpired === 'function') onSessionExpired();
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/** Opens a modal with the given inner HTML; returns the backdrop element. */
function openModal(html, small = false) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${small ? 'sm' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.remove(); });
  bg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}
const statusClass = (s) => ({ Paid: 'b-ok', Active: 'b-ok', Available: 'b-ok', Approved: 'b-ok', Completed: 'b-ok', Replied: 'b-ok', Partial: 'b-warn', Pending: 'b-warn', New: 'b-warn', Reserved: 'b-info', Read: 'b-info', Overdue: 'b-bad', Rejected: 'b-bad', Maintenance: 'b-bad', Cancelled: 'b-bad', Occupied: 'b-info' }[s] || '');
const badge = (s) => `<span class="badge ${statusClass(s)}">${esc(s)}</span>`;
