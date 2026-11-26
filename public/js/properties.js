/* properties.js - shared property cards, details modal (with info grid & reviews), and application form */
function starsText(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function ratingSummaryBadge(p) {
  const count = Number(p.reviewCount || 0);
  const avg = Number(p.averageRating || 0);
  if (!count) return '<div class="rating-row muted">No reviews yet</div>';
  return `<div class="rating-row"><span class="stars" aria-label="${avg} out of 5 stars">★</span><span>${avg.toFixed(1)}</span><span class="muted">(${count} review${count === 1 ? '' : 's'})</span></div>`;
}

function propertyCardHtml(p) {
  const tags = (p.amenities || []).slice(0, 3).map((a) => `<span class="badge">${esc(a)}</span>`).join('');
  return `<article class="card"><img loading="lazy" src="${esc((p.images || [])[0] || '/images/APT-01.png')}" alt="${esc(p.name)}">
    <div class="body"><span class="badge b-info" style="align-self:flex-start">${esc(p.propertyType)}</span>
    <h3>${esc(p.name)}</h3><div class="muted">📍 ${esc(p.city)}${p.locationAccess ? ' · ' + esc(p.locationAccess.split(' to ')[0]) : ''}</div>
    ${ratingSummaryBadge(p)}
    <div class="price">${money(p.monthlyPrice)} <small>/ month</small></div>
    <div class="muted">${p.availableRoomsCount} of ${p.totalRoomsCount} rooms available (${p.availableBedsCount} bed${p.availableBedsCount === 1 ? '' : 's'} free)</div>
    <div class="tags">${tags}</div>
    <p class="muted" style="margin:4px 0">${esc((p.description || '').slice(0, 95))}…</p>
    <button class="btn" data-details="${p.id}">View details</button></div></article>`;
}

function formatReviewDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function renderReviewsSection(container, propertyId, data) {
  const { average = 0, count = 0, breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }, reviews = [] } = data;
  const barsHtml = [5, 4, 3, 2, 1].map((star) => {
    const n = breakdown[star] || 0;
    const pct = count ? Math.round((n / count) * 100) : 0;
    return `<div class="bar-row"><span>${star} ★</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span>${n}</span></div>`;
  }).join('');

  const listHtml = reviews.length
    ? reviews.map((r) => `<div class="review-item">
        <div class="review-head">
          <div><b>${esc(r.reviewerName)}</b> <span class="stars">${starsText(r.rating)}</span></div>
          <span class="muted">${esc(formatReviewDate(r.createdAt))}</span>
        </div>
        ${r.title ? `<div class="review-title">${esc(r.title)}</div>` : ''}
        <div>${esc(r.comment)}</div>
        ${r.ownerReply ? `<div class="owner-reply"><b>Owner reply</b>${r.repliedAt ? ` <span class="muted">(${esc(formatReviewDate(r.repliedAt))})</span>` : ''}: ${esc(r.ownerReply)}</div>` : ''}
      </div>`).join('')
    : '<div class="empty" style="padding:16px">No approved reviews yet. Be the first to share your experience!</div>';

  container.innerHTML = `<div class="reviews-box">
    <h3>Tenant reviews</h3>
    <div class="rating-summary">
      <div class="rating-big">
        <b>${count ? average.toFixed(1) : '—'}</b>
        <div class="stars">${count ? starsText(Math.round(average)) : '☆☆☆☆☆'}</div>
        <div class="muted">${count} review${count === 1 ? '' : 's'}</div>
      </div>
      <div class="rating-bars">${barsHtml}</div>
    </div>
    <div class="review-list">${listHtml}</div>
    <div class="review-form-box" id="reviewFormWrap">
      <h4 style="margin:0 0 10px">Write a review</h4>
      <form id="reviewForm">
        <div class="grid2">
          <div class="field"><label>Your name *</label><input name="reviewerName" required maxlength="80"></div>
          <div class="field"><label>Email * (kept private)</label><input name="email" type="email" required maxlength="150"></div>
        </div>
        <div class="field">
          <label>Rating *</label>
          <div class="star-picker" id="starPicker" role="radiogroup" aria-label="Star rating">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn on" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
          </div>
          <input type="hidden" name="rating" id="ratingInput" value="5">
        </div>
        <div class="field"><label>Title</label><input name="title" maxlength="120" placeholder="Short summary of your stay"></div>
        <div class="field"><label>Comment * (10–600 characters)</label><textarea name="comment" rows="3" minlength="10" maxlength="600" required placeholder="Share what you liked about the rooms, location, Wi-Fi, or management..."></textarea></div>
        <button class="btn" type="submit">Submit review</button>
      </form>
    </div>
  </div>`;

  const picker = $('#starPicker', container);
  const ratingInput = $('#ratingInput', container);
  const paintStars = (val) => {
    $$('.star-btn', picker).forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= val));
  };
  picker.onclick = (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    ratingInput.value = b.dataset.star;
    paintStars(Number(b.dataset.star));
  };

  $('#reviewForm', container).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.propertyId = propertyId;
    body.rating = Number(body.rating);
    try {
      const res = await api('/public/reviews', { method: 'POST', body });
      $('#reviewFormWrap', container).innerHTML = `<div class="badge b-ok" style="padding:8px 12px;border-radius:10px;font-size:14px">${esc(res.message || 'Thanks! Your review will appear after approval.')}</div>`;
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function openPropertyDetails(id) {
  const [p, revData] = await Promise.all([
    api('/public/properties/' + id),
    api('/public/properties/' + id + '/reviews'),
  ]);
  const imgs = p.images && p.images.length ? p.images : [];
  const rooms = (p.rooms || []).map((r) => `<tr><td>${esc(r.roomNumber)}</td><td>${esc(r.roomType)}</td><td>${r.availableBeds}/${r.capacity}</td><td>${money(r.monthlyPrice)}</td><td>${badge(r.status)}</td></tr>`).join('');
  const roomTypesText = (p.availableRoomTypes || []).length
    ? p.availableRoomTypes.map((rt) => `${rt.roomType} (${rt.bedsFree} bed${rt.bedsFree === 1 ? '' : 's'} free)`).join(', ')
    : 'No available beds currently';

  const infoItems = [
    ['Transit & Location Access', p.locationAccess || 'Central Alangilan, Batangas City'],
    ['Nearby Places & Transit', p.nearbyPlaces || 'Alangilan commercial area & jeepney routes'],
    ['Deposit & Advance Policy', p.depositPolicy || '1 month advance + 1 month security deposit'],
    ['Utilities Included / Excluded', p.utilitiesPolicy || 'Ask owner for sub-metered utility rates'],
    ['Room & Unit Inclusions', p.inclusions || 'Bedframe, mattress, study space'],
    ['Curfew & Visitor Policy', p.curfewPolicy || 'Observe quiet hours and guest registration'],
    ['Available Room Types', roomTypesText],
  ];

  const m = openModal(`<div class="modal-head"><h2>${esc(p.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="gallery"><img src="${esc(imgs[0] || '')}" alt="${esc(p.name)}"><img src="${esc(imgs[1] || imgs[0] || '')}" alt=""></div>
    <p><span class="badge b-info">${esc(p.propertyType)}</span> <span class="muted">${esc(p.address)}, ${esc(p.city)}</span></p>
    ${ratingSummaryBadge(p)}
    <div class="price" style="margin-top:6px">${money(p.monthlyPrice)} <small>/ month</small></div><p>${esc(p.description)}</p>
    <div class="info-grid">${infoItems.map(([k, v]) => `<div class="info-item"><small>${esc(k)}</small><div>${esc(v)}</div></div>`).join('')}</div>
    <h3>Rooms</h3><div style="overflow:auto"><table class="t"><tr><th>Room</th><th>Type</th><th>Beds free</th><th>Price</th><th>Status</th></tr>${rooms}</table></div>
    <h3 style="margin-top:14px">Amenities</h3><div class="tags">${(p.amenities || []).map((a) => `<span class="badge">${esc(a)}</span>`).join('')}</div>
    <h3 style="margin-top:14px">House rules</h3><ul>${(p.houseRules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted">Contact: ${esc(p.contactPhone)} · ${esc(p.contactEmail)}</p>
    ${typeof L !== 'undefined' ? '<div id="miniMap" style="height:200px;border-radius:10px;margin:10px 0"></div>' : ''}
    <button class="btn" id="applyBtn">Apply for this property</button>
    <div id="reviewsMount"></div>`);

  if (typeof L !== 'undefined') {
    const mm = L.map($('#miniMap', m)).setView([p.latitude, p.longitude], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(mm);
    L.marker([p.latitude, p.longitude]).addTo(mm);
  }
  $('#applyBtn', m).onclick = () => { m.remove(); openApplyModal(p); };
  renderReviewsSection($('#reviewsMount', m), p.id, revData);
}

function openApplyModal(p) {
  const types = ['Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room'];
  const minDate = new Date().toISOString().slice(0, 10);
  const m = openModal(`<div class="modal-head"><h2>Apply: ${esc(p.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <form id="applyForm"><div class="grid2">
    <div class="field"><label>Full name *</label><input name="fullName" required></div>
    <div class="field"><label>Email *</label><input name="email" type="email" required></div>
    <div class="field"><label>Contact number *</label><input name="contactNumber" required></div>
    <div class="field"><label>Preferred room type</label><select name="preferredRoomType">${types.map((t) => `<option ${t === p.propertyType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label>Expected move-in *</label><input name="expectedMoveInDate" type="date" min="${minDate}" required></div>
    <div class="field"><label>Occupants</label><input name="occupants" type="number" min="1" max="10" value="1"></div></div>
    <div class="field"><label>Message</label><textarea name="message" rows="3" maxlength="500"></textarea></div>
    <button class="btn" type="submit">Submit application</button></form>`);
  $('#applyForm', m).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.propertyId = p.id;
    try {
      const r = await api('/public/applications', { method: 'POST', body });
      $('.modal', m).innerHTML = `<h2>Application Received!</h2><p>Your reference number:</p><div class="ref">${esc(r.referenceNumber)}</div>
        <p class="muted">Status: ${esc(r.status)}. Keep this number; the owner will contact you.</p><button class="btn" data-close>Done</button>`;
    } catch (err) { toast(err.message, true); }
  };
}

document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-details]');
  if (d) { e.preventDefault(); openPropertyDetails(d.dataset.details).catch((x) => toast(x.message, true)); }
});
