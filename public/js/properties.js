/* properties.js - shared property cards (numbered pins, favorites, compare), details modal (room galleries, BatStateU distance, reviews), apply/waitlist/viewing modals */
let favoriteIds = new Set();
let compareMap = new Map();

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

function distanceBadge(p) {
  const parts = [];
  if (p.walkingMinutesBsu != null) parts.push(`${p.walkingMinutesBsu} min walk to BatStateU Alangilan`);
  else if (p.tricycleMinutesBsu != null) parts.push(`${p.tricycleMinutesBsu} min ride to BatStateU Alangilan`);
  return parts.length ? `<div class="muted">🚶 ${esc(parts[0])}</div>` : '';
}

function propertyCardHtml(p, index = null, { showCompare = false } = {}) {
  const tags = (p.amenities || []).slice(0, 3).map((a) => `<span class="badge">${esc(a)}</span>`).join('');
  const imgSrc = safeUrl((p.images || [])[0]);
  const isFav = favoriteIds.has(Number(p.id));
  const isCmp = compareMap.has(Number(p.id));
  return `<article class="card" data-prop-card="${p.id}">
    <div class="card-media">
      <img loading="lazy" src="${esc(imgSrc)}" alt="${esc(p.name)}">
      ${index !== null ? `<span class="card-num" title="Map pin #${index + 1}">#${index + 1}</span>` : ''}
      <button type="button" class="fav-btn ${isFav ? 'on' : ''}" data-fav="${p.id}" aria-label="${isFav ? 'Remove from favorites' : 'Save to favorites'}" title="Save favorite">${isFav ? '♥' : '♡'}</button>
    </div>
    <div class="body">
      <span class="badge b-info" style="align-self:flex-start">${esc(p.propertyType)}</span>
      <h3>${esc(p.name)}</h3>
      <div class="muted">📍 ${esc(p.city)}${p.locationAccess ? ' · ' + esc(p.locationAccess.split(' to ')[0]) : ''}</div>
      ${distanceBadge(p)}
      ${ratingSummaryBadge(p)}
      <div class="price"><small>From </small>${money(p.monthlyPrice)} <small>/ month</small></div>
      <div class="muted">${p.availableRoomsCount} of ${p.totalRoomsCount} rooms available (${p.availableBedsCount} bed${p.availableBedsCount === 1 ? '' : 's'} free)</div>
      <div class="tags">${tags}</div>
      <p class="muted" style="margin:4px 0">${esc((p.description || '').slice(0, 90))}${p.description && p.description.length > 90 ? '…' : ''}</p>
      <div class="card-actions">
        <button class="btn" data-details="${p.id}">View details</button>
        ${showCompare ? `<label class="cmp-label"><input type="checkbox" data-cmp="${p.id}" ${isCmp ? 'checked' : ''}> Compare</label>` : ''}
      </div>
    </div>
  </article>`;
}

function renderReviewsSection(container, propertyId, data) {
  const { average = 0, count = 0, breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }, reviews = [] } = data;
  const barsHtml = [5, 4, 3, 2, 1]
    .map((star) => {
      const n = breakdown[star] || 0;
      const pct = count ? Math.round((n / count) * 100) : 0;
      return `<div class="bar-row"><span>${star} ★</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span>${n}</span></div>`;
    })
    .join('');

  const listHtml = reviews.length
    ? reviews
        .map(
          (r) => `<div class="review-item">
        <div class="review-head">
          <div><b>${esc(r.reviewerName)}</b> <span class="stars">${starsText(r.rating)}</span></div>
          <span class="muted">${esc(String(r.createdAt || '').slice(0, 10))}</span>
        </div>
        ${r.title ? `<div class="review-title">${esc(r.title)}</div>` : ''}
        <div>${esc(r.comment)}</div>
        ${r.ownerReply ? `<div class="owner-reply"><b>Owner reply</b>${r.repliedAt ? ` <span class="muted">(${esc(String(r.repliedAt).slice(0, 10))})</span>` : ''}: ${esc(r.ownerReply)}</div>` : ''}
      </div>`
        )
        .join('')
    : '<div class="empty" style="padding:16px">No approved reviews yet. Be the first to share your experience!</div>';

  const u = window.__currentUser;
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
          <div class="field"><label for="revName">Your name *</label><input id="revName" name="reviewerName" required maxlength="80" value="${esc(u?.fullName || '')}"></div>
          <div class="field"><label for="revEmail">Email * (kept private)</label><input id="revEmail" name="email" type="email" required maxlength="150" value="${esc(u?.email || '')}"></div>
        </div>
        <div class="field">
          <label>Rating *</label>
          <div class="star-picker" id="starPicker" role="radiogroup" aria-label="Star rating">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn on" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
          </div>
          <input type="hidden" name="rating" id="ratingInput" value="5">
        </div>
        <div class="field"><label for="revTitle">Title</label><input id="revTitle" name="title" maxlength="120" placeholder="Short summary of your stay"></div>
        <div class="field"><label for="revComment">Comment * (10–600 characters)</label><textarea id="revComment" name="comment" rows="3" minlength="10" maxlength="600" required placeholder="Share what you liked about the rooms, location, Wi-Fi, or management..."></textarea></div>
        <button class="btn" type="submit">Submit review</button>
      </form>
    </div>
  </div>`;

  const picker = $('#starPicker', container);
  const ratingInput = $('#ratingInput', container);
  picker.onclick = (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    const val = Number(b.dataset.star);
    ratingInput.value = val;
    $$('.star-btn', picker).forEach((btn) => btn.classList.toggle('on', Number(btn.dataset.star) <= val));
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
  const imgs = p.images && p.images.length ? p.images : ['/images/placeholder.svg'];
  const galleryImgs = imgs.slice(0, 3).map((src, idx) => `<img src="${esc(safeUrl(src))}" alt="${esc(p.name)} photo ${idx + 1}">`).join('');

  const rooms = (p.rooms || [])
    .map((r) => {
      const thumbs = (r.images || []).slice(0, 3).map((img) => `<img src="${esc(safeUrl(img))}" alt="Room ${esc(r.roomNumber)}">`).join('');
      return `<tr>
        <td><b>${esc(r.roomNumber)}</b>${r.description ? `<div class="muted">${esc(r.description)}</div>` : ''}${thumbs ? `<div class="room-thumbs">${thumbs}</div>` : ''}</td>
        <td>${esc(r.roomType)}</td>
        <td>${r.availableBeds}/${r.capacity}</td>
        <td>${money(r.monthlyPrice)}</td>
        <td>${badge(r.status)}</td>
      </tr>`;
    })
    .join('');

  const roomTypesText = (p.availableRoomTypes || []).length
    ? p.availableRoomTypes.map((rt) => `${rt.roomType} (${rt.bedsFree} bed${rt.bedsFree === 1 ? '' : 's'} free)`).join(', ')
    : 'No available beds currently';

  const bsuInfo = [
    p.walkingMinutesBsu != null ? `${p.walkingMinutesBsu} min walk` : null,
    p.tricycleMinutesBsu != null ? `${p.tricycleMinutesBsu} min tricycle` : null,
  ].filter(Boolean).join(' · ') || 'Near BatStateU Alangilan';

  const infoItems = [
    ['BatStateU Alangilan Distance', bsuInfo],
    ['Minimum Lease Term', `${p.minLeaseMonths || 6} month(s)`],
    ['Transit & Location Access', p.locationAccess || 'Central Alangilan, Batangas City'],
    ['Nearby Landmarks & Shops', p.landmarks || p.nearbyPlaces || 'Alangilan commercial area & jeepney routes'],
    ['Deposit & Advance Policy', p.depositPolicy || '1 month advance + 1 month security deposit'],
    ['Utilities Included / Excluded', p.utilitiesPolicy || 'Ask owner for sub-metered utility rates'],
    ['Room & Unit Inclusions', p.inclusions || 'Bedframe, mattress, study space'],
    ['Curfew & Visitor Policy', p.curfewPolicy || 'Observe quiet hours and guest registration'],
    ['Available Room Types', roomTypesText],
  ];

  const isFull = Number(p.availableBedsCount) <= 0;
  const m = openModal(`<div class="modal-head"><h2>${esc(p.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="gallery">${galleryImgs}</div>
    <p><span class="badge b-info">${esc(p.propertyType)}</span> <span class="muted">${esc(p.address)}, ${esc(p.city)}</span></p>
    ${ratingSummaryBadge(p)}
    <div class="price" style="margin-top:6px"><small>From </small>${money(p.monthlyPrice)} <small>/ month</small></div>
    <p>${esc(p.description)}</p>
    <div class="info-grid">${infoItems.map(([k, v]) => `<div class="info-item"><small>${esc(k)}</small><div>${esc(v)}</div></div>`).join('')}</div>
    <h3>Rooms & Units</h3>
    <div style="overflow:auto"><table class="t"><thead><tr><th>Room & Photos</th><th>Type</th><th>Beds free</th><th>Price</th><th>Status</th></tr></thead><tbody>${rooms || '<tr><td colspan="5" class="empty">No rooms listed.</td></tr>'}</tbody></table></div>
    <h3 style="margin-top:14px">Amenities</h3><div class="tags">${(p.amenities || []).map((a) => `<span class="badge">${esc(a)}</span>`).join('')}</div>
    <h3 style="margin-top:14px">House rules</h3><ul>${(p.houseRules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${typeof L !== 'undefined' ? '<div id="miniMap" style="height:200px;border-radius:10px;margin:10px 0"></div>' : ''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <button class="btn" id="applyBtn">Apply for this property</button>
      <a class="btn ghost" href="/contact.html?propertyId=${p.id}#viewing">Book a viewing</a>
      ${isFull ? '<button class="btn ghost" id="waitBtn">Join waitlist</button>' : ''}
    </div>
    <div id="reviewsMount"></div>`);

  if (typeof L !== 'undefined') {
    const mm = L.map($('#miniMap', m)).setView([p.latitude, p.longitude], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(mm);
    L.marker([p.latitude, p.longitude]).addTo(mm);
  }
  $('#applyBtn', m).onclick = () => { m.remove(); openApplyModal(p); };
  const wb = $('#waitBtn', m);
  if (wb) wb.onclick = () => { m.remove(); openWaitlistModal(p); };
  renderReviewsSection($('#reviewsMount', m), p.id, revData);
}

function openApplyModal(p) {
  const types = ['Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room'];
  const minDate = manilaTodayClient();
  const u = window.__currentUser;
  const m = openModal(`<div class="modal-head"><h2>Apply: ${esc(p.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <form id="applyForm">
      <div class="grid2">
        <div class="field"><label for="apName">Full name *</label><input id="apName" name="fullName" required value="${esc(u?.fullName || '')}"></div>
        <div class="field"><label for="apEmail">Email *</label><input id="apEmail" name="email" type="email" required value="${esc(u?.email || '')}"></div>
        <div class="field"><label for="apPhone">Contact number *</label><input id="apPhone" name="contactNumber" required value="${esc(u?.phone || '')}" placeholder="09XX XXX XXXX"></div>
        <div class="field"><label for="apType">Preferred room type</label><select id="apType" name="preferredRoomType">${types.map((t) => `<option ${t === p.propertyType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="apDate">Expected move-in *</label><input id="apDate" name="expectedMoveInDate" type="date" min="${minDate}" required></div>
        <div class="field"><label for="apOcc">Occupants</label><input id="apOcc" name="occupants" type="number" min="1" max="10" value="1"></div>
      </div>
      <div class="field"><label for="apDoc">Optional Student / Government ID (JPG, PNG, WEBP, PDF, max 2 MB — kept private)</label>
        <input id="apDoc" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf"></div>
      <div class="field"><label for="apMsg">Message / Questions</label><textarea id="apMsg" name="message" rows="3" maxlength="500"></textarea></div>
      <label class="consent-row"><input type="checkbox" name="consentAccepted" required> <span>I agree to the <a href="/privacy.html" target="_blank">Privacy Policy (RA 10173)</a> and consent to CasaBatangueño processing my application details.</span></label>
      <button class="btn" type="submit">Submit application</button>
    </form>`);

  $('#applyForm', m).onsubmit = async (e) => {
    e.preventDefault();
    const formEl = e.target;
    const body = Object.fromEntries(new FormData(formEl));
    body.propertyId = p.id;
    body.occupants = Number(body.occupants) || 1;
    body.consentAccepted = formEl.elements.consentAccepted.checked;
    try {
      const file = $('#apDoc', m).files?.[0];
      if (file) {
        const contentBase64 = await readFileAsBase64(file);
        body.idDocument = { fileName: file.name, contentBase64 };
      }
      const r = await api('/public/applications', { method: 'POST', body });
      $('.modal', m).innerHTML = `<h2>Application Received!</h2>
        <p>Your reference number:</p><div class="ref">${esc(r.referenceNumber)}</div>
        <p class="muted">Status: ${esc(r.status)}. Track your status anytime on <a href="/how-it-works.html#track">How it Works</a> or in <a href="/account.html">My Account</a>.</p>
        <button class="btn" data-close>Done</button>`;
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function openWaitlistModal(p) {
  const u = window.__currentUser;
  const m = openModal(`<div class="modal-head"><h2>Join Waitlist: ${esc(p.name)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="muted">We'll email you immediately when a bed or unit opens at ${esc(p.name)}.</p>
    <form id="waitForm">
      <div class="field"><label for="wlName">Full name *</label><input id="wlName" name="fullName" required value="${esc(u?.fullName || '')}"></div>
      <div class="field"><label for="wlEmail">Email *</label><input id="wlEmail" name="email" type="email" required value="${esc(u?.email || '')}"></div>
      <div class="field"><label for="wlPhone">Phone</label><input id="wlPhone" name="phone" value="${esc(u?.phone || '')}"></div>
      <div class="field"><label for="wlType">Preferred room type</label><input id="wlType" name="preferredRoomType" value="${esc(p.propertyType)}"></div>
      <label class="consent-row"><input type="checkbox" name="consentAccepted" required> <span>I consent under the <a href="/privacy.html" target="_blank">Privacy Policy</a> to receive a vacancy alert email.</span></label>
      <button class="btn" type="submit">Notify me when available</button>
    </form>`, true);
  $('#waitForm', m).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.propertyId = p.id;
    body.consentAccepted = e.target.elements.consentAccepted.checked;
    try {
      const r = await api('/public/waitlist', { method: 'POST', body });
      m.remove();
      toast(r.message);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function openCompareModal(items) {
  if (items.length < 2) return toast('Select 2 or 3 properties to compare.', true);
  const rows = [
    ['Type', (p) => esc(p.propertyType)],
    ['Starting Price', (p) => `${money(p.monthlyPrice)} / mo`],
    ['Beds Free', (p) => `${p.availableBedsCount} free (${p.availableRoomsCount}/${p.totalRoomsCount} rooms)`],
    ['BatStateU Alangilan', (p) => (p.walkingMinutesBsu != null ? `${p.walkingMinutesBsu} min walk` : p.tricycleMinutesBsu != null ? `${p.tricycleMinutesBsu} min ride` : '—')],
    ['Min Lease', (p) => `${p.minLeaseMonths || 6} months`],
    ['Rating', (p) => (p.reviewCount ? `${Number(p.averageRating).toFixed(1)} ★ (${p.reviewCount})` : 'No reviews')],
    ['Deposit Policy', (p) => esc(p.depositPolicy || '—')],
    ['Utilities', (p) => esc(p.utilitiesPolicy || '—')],
    ['Inclusions', (p) => esc(p.inclusions || '—')],
    ['Amenities', (p) => esc((p.amenities || []).join(', ') || '—')],
  ];
  openModal(`<div class="modal-head"><h2>Compare Properties (${items.length})</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div style="overflow:auto"><table class="t">
      <thead><tr><th>Feature</th>${items.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><td><b>${esc(label)}</b></td>${items.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`);
}

async function syncFavorites() {
  try {
    const me = window.__currentUser || (await fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)));
    if (!me) return;
    window.__currentUser = me;
    const favs = await api('/customer/favorites');
    favoriteIds = new Set(favs.map((f) => Number(f.id)));
    $$('[data-fav]').forEach((btn) => {
      const on = favoriteIds.has(Number(btn.dataset.fav));
      btn.classList.toggle('on', on);
      btn.textContent = on ? '♥' : '♡';
    });
  } catch {
    // ignore if unauthenticated
  }
}

document.addEventListener('cb:auth-loaded', syncFavorites);

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-details]');
  if (d) {
    e.preventDefault();
    openPropertyDetails(d.dataset.details).catch((x) => toast(x.message, true));
    return;
  }
  const f = e.target.closest('[data-fav]');
  if (f) {
    e.preventDefault();
    if (!window.__currentUser) {
      toast('Sign in on My Account to save favorites.');
      return;
    }
    const pid = Number(f.dataset.fav);
    const isFav = favoriteIds.has(pid);
    try {
      if (isFav) {
        await api('/customer/favorites/' + pid, { method: 'DELETE' });
        favoriteIds.delete(pid);
      } else {
        await api('/customer/favorites/' + pid, { method: 'POST' });
        favoriteIds.add(pid);
      }
      $$(`[data-fav="${pid}"]`).forEach((btn) => {
        const on = favoriteIds.has(pid);
        btn.classList.toggle('on', on);
        btn.textContent = on ? '♥' : '♡';
      });
      toast(isFav ? 'Removed from favorites.' : 'Saved to favorites.');
    } catch (err) {
      toast(err.message, true);
    }
  }
});
