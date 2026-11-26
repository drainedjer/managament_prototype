/* contact.js - Contact page: contact form submission and embedded Alangilan map */
const ALANGILAN = [13.7845, 121.0735];

const contactForm = $('#contactForm');
if (contactForm) {
  contactForm.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/public/contact', { method: 'POST', body });
      $('#contactFeedback').innerHTML = `<div class="badge b-ok" style="padding:10px 14px;border-radius:10px;font-size:14px">${esc(r.message)}</div>`;
      e.target.reset();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

(async function initContactMap() {
  const el = $('#contactMap');
  if (!el || typeof L === 'undefined') return;
  const map = L.map(el).setView(ALANGILAN, 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  L.marker([13.7851, 121.0721]).addTo(map).bindPopup('<strong>CasaBatangueño Office</strong><br>Neptune St., Golden Country Homes, Alangilan').openPopup();
  try {
    const props = await api('/public/properties');
    props.forEach((p) => {
      L.circleMarker([p.latitude, p.longitude], { radius: 7, color: '#0f766e', fillColor: '#0f766e', fillOpacity: 0.7 })
        .addTo(map)
        .bindPopup(`<strong>${esc(p.name)}</strong><br>${money(p.monthlyPrice)}/mo`);
    });
  } catch { /* map still works with main office marker */ }
})();
