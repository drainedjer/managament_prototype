/* rentals.js - Find a Rental page: search filters, property cards, and Leaflet map */
let map, markerLayer, current = [];
const ALANGILAN = [13.7845, 121.0735];

function initMap() {
  map = L.map('map').setView(ALANGILAN, 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function drawMap(list) {
  markerLayer.clearLayers();
  list.forEach((p) => {
    L.marker([p.latitude, p.longitude]).addTo(markerLayer).bindPopup(
      `<strong>${esc(p.name)}</strong><br>${money(p.monthlyPrice)}/mo<br><a href="#" data-details="${p.id}">View details</a>`);
  });
  if (list.length) map.fitBounds(list.map((p) => [p.latitude, p.longitude]), { padding: [40, 40], maxZoom: 15 });
  else map.setView(ALANGILAN, 15);
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
    $('#cards').innerHTML = current.length ? current.map(propertyCardHtml).join('') : '<div class="empty">No properties match your filters.</div>';
    drawMap(current);
  } catch (e) {
    $('#cards').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

let timer;
$('#filters').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadProperties, 250); });
$('#onlyAvailable').onchange = $('#amenity').onchange = loadProperties;
$('#reset').onclick = () => {
  ['q', 'type', 'minPrice', 'maxPrice', 'occupants', 'amenity'].forEach((id) => ($('#' + id).value = ''));
  $('#onlyAvailable').checked = false;
  history.replaceState(null, '', '/rentals.html');
  loadProperties();
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
})();
