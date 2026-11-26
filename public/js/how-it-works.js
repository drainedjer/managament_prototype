/* how-it-works.js - Track my application form and FAQ accordion */
const trackForm = $('#trackForm');
if (trackForm) {
  trackForm.onsubmit = async (e) => {
    e.preventDefault();
    const out = $('#trackResult');
    out.innerHTML = '<div class="muted">Checking…</div>';
    try {
      const r = await api('/public/applications/track', {
        method: 'POST',
        body: Object.fromEntries(new FormData(e.target)),
      });
      out.innerHTML = `<div class="panel-card" style="border:1px solid var(--line);margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong>${esc(r.referenceNumber)}</strong>
          ${badge(r.status)}
        </div>
        <p class="muted" style="margin:8px 0 0">
          Property: <b>${esc(r.propertyName)}</b> · Type: ${esc(r.preferredRoomType)} · Target move-in: ${esc(r.expectedMoveInDate)}<br>
          Last updated: ${esc(String(r.updatedAt || '').slice(0, 10))}
        </p>
      </div>`;
    } catch (err) {
      out.innerHTML = `<div class="badge b-bad" style="margin-top:10px">${esc(err.message)}</div>`;
    }
  };
}

$$('.faq-q').forEach((btn) => {
  btn.onclick = () => {
    const item = btn.closest('.faq-item');
    const ans = $('.faq-a', item);
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    ans.hidden = expanded;
    const icon = $('span', btn);
    if (icon) icon.textContent = expanded ? '+' : '−';
  };
});
