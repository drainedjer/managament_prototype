/* contact.js - Contact office form, Book a viewing form, settings hydration, and OSM map */
(async function initContact() {
  // Hydrate office details
  try {
    const s = await api('/public/settings');
    const infoEl = $('#officeInfo');
    if (infoEl) {
      infoEl.innerHTML = `
        <li><b>Office:</b> ${esc(s.office_address)}</li>
        <li><b>Phone:</b> <a href="tel:${esc(String(s.contact_phone || '').replace(/\s+/g, ''))}">${esc(s.contact_phone)}</a></li>
        <li><b>Email:</b> <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></li>
        <li><b>Hours:</b> ${esc(s.office_hours)}</li>`;
    }
  } catch {
    // keep static fallback
  }

  // Office Leaflet map in Alangilan
  const mapEl = $('#contactMap');
  if (mapEl && typeof L !== 'undefined') {
    const m = L.map(mapEl).setView([13.7845, 121.0735], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(m);
    L.marker([13.7845, 121.0735]).addTo(m).bindPopup('<strong>CasaBatangueño Management Office</strong><br>Neptune St., Alangilan, Batangas City').openPopup();
  }

  // Populate property dropdown for viewing requests
  const viewProp = $('#viewProperty');
  if (viewProp) {
    try {
      const props = await api('/public/properties');
      const qs = new URLSearchParams(location.search);
      const preId = qs.get('propertyId');
      viewProp.innerHTML = '<option value="">Select a property…</option>' +
        props.map((p) => `<option value="${p.id}" ${String(p.id) === String(preId) ? 'selected' : ''}>${esc(p.name)} (${esc(p.propertyType)})</option>`).join('');
    } catch {
      viewProp.innerHTML = '<option value="">Unable to load properties</option>';
    }
  }

  // Prefill logged-in user if available
  document.addEventListener('cb:auth-loaded', (ev) => {
    const u = ev.detail;
    if (!u) return;
    $$('input[name=fullName]').forEach((i) => { if (!i.value) i.value = u.fullName; });
    $$('input[name=email]').forEach((i) => { if (!i.value) i.value = u.email; });
    $$('input[name=phone]').forEach((i) => { if (!i.value && u.phone) i.value = u.phone; });
  });

  // Min date for viewing picker
  const vd = $('#viewDate');
  if (vd) vd.min = manilaTodayClient();

  const cForm = $('#contactForm');
  if (cForm) {
    cForm.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.consentAccepted = e.target.elements.consentAccepted.checked;
      try {
        const res = await api('/public/contact', { method: 'POST', body });
        e.target.reset();
        $('#contactStatus').innerHTML = `<div class="badge b-ok" style="padding:8px 12px;border-radius:10px;font-size:14px">${esc(res.message)}</div>`;
      } catch (err) {
        toast(err.message, true);
      }
    };
  }

  const vForm = $('#viewingForm');
  if (vForm) {
    vForm.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.consentAccepted = e.target.elements.consentAccepted.checked;
      try {
        const res = await api('/public/viewings', { method: 'POST', body });
        e.target.reset();
        $('#viewingStatus').innerHTML = `<div class="badge b-ok" style="padding:8px 12px;border-radius:10px;font-size:14px">${esc(res.message)}</div>`;
      } catch (err) {
        toast(err.message, true);
      }
    };
  }
})();
