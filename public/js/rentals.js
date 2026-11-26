/* rentals.js - Find a Rental page: filters, numbered cards, MarkerCluster Leaflet map, and side-by-side comparison */
let map, markerLayer, current = [];
const ALANGILAN = [13.7845, 121.0735];

function initMap() {
  map = L.map('map').setView(ALANGILAN, 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  markerLayer = typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup({ spiderfyOnMaxZoom: true, showCoverageOnHover: false }) : L.layerGroup();
  markerLayer.addTo(map);
}

function drawMap(list) {
  markerLayer.clearLayers();
  list.forEach((p, idx) => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin-num">${idx + 1}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([p.latitude, p.longitude], { icon })
      .addTo(markerLayer)
      .bindPopup(`<strong>#${idx + 1} ${esc(p.name)}</strong><br>From ${money(p.monthlyPrice)}/mo<br>${p.availableBedsCount} bed(s) free<br><a href="#" data-details="${p.id}">View details</a>`);
  });
  if (list.length) map.fitBounds(list.map((p) => [p.latitude, p.longitude]), { padding: [40, 40], maxZoom: 15 });
  else map.setView(ALANGILAN, 15);
}

function updateCompareBar() {
  const bar = $('#compareBar');
  if (!bar) return;
  const items = [...compareMap.values()];
  if (!items.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $('#compareList').textContent = `${items.length} selected: ${items.map((p) => p.name).join(' vs. ')}`;
}

async function loadProperties() {
  const params = new URLSearchParams();
  ['q', 'type', 'minPrice', 'maxPrice', 'occupants', 'amenity'].forEach((id) => {
    const v = $('#' + id).value.trim();
    if (v) params.set(id, v);
  });
  if ($('#onlyAvailable').checked) params.set('onlyAvailable', 'true');
  try {
    current = await api('/public/properties?' + params);
    $('#count').textContent = `${current.length} propert${current.length === 1 ? 'y' : 'ies'} found`;
    $('#cards').innerHTML = current.length
      ? current.map((p, idx) => propertyCardHtml(p, idx, { showCompare: true })).join('')
      : '<div class="empty">No properties match your filters.</div>';
    drawMap(current);
    syncFavorites();
    updateCompareBar();
  } catch (e) {
    $('#cards').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

document.addEventListener('change', (e) => {
  const chk = e.target.closest('[data-cmp]');
  if (!chk) return;
  const pid = Number(chk.dataset.cmp);
  if (chk.checked) {
    if (compareMap.size >= 3) {
      chk.checked = false;
      return toast('You can compare up to 3 properties at once.', true);
    }
    const p = current.find((x) => x.id === pid);
    if (p) compareMap.set(pid, p);
  } else {
    compareMap.delete(pid);
  }
  updateCompareBar();
});

let timer;
$('#filters').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadProperties, 250); });
$('#onlyAvailable').onchange = $('#amenity').onchange = loadProperties;
$('#reset').onclick = () => {
  ['q', 'type', 'minPrice', 'maxPrice', 'occupants', 'amenity'].forEach((id) => ($('#' + id).value = ''));
  $('#onlyAvailable').checked = false;
  history.replaceState(null, '', '/rentals.html');
  loadProperties();
};

const cmpBtn = $('#compareBtn');
if (cmpBtn) cmpBtn.onclick = () => openCompareModal([...compareMap.values()]);
const cmpClear = $('#compareClear');
if (cmpClear) cmpClear.onclick = () => {
  compareMap.clear();
  $$('[data-cmp]').forEach((c) => (c.checked = false));
  updateCompareBar();
};

(async function start() {
  initMap();
  const initialAll = await api('/public/properties').catch(() => []);
  const allAmenities = [...new Set(initialAll.flatMap((p) => p.amenities || []))].sort();
  $('#amenity').innerHTML = '<option value="">Any amenity</option>' + allAmenities.map((a) => `<option>${esc(a)}</option>`).join('');

  const qs = new URLSearchParams(location.search);
  ['q', 'type', 'minPrice', 'maxPrice', 'occupants', 'amenity'].forEach((id) => {
    if (qs.get(id)) $('#' + id).value = qs.get(id);
  });
  if (qs.get('onlyAvailable') === 'true') $('#onlyAvailable').checked = true;

  await loadProperties();
  if (qs.get('property')) {
    openPropertyDetails(qs.get('property')).catch(() => {});
  }
})();
