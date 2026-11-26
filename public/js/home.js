/* home.js - Home page: quick search redirect, featured properties (top 3), approved reviews, and testimonials */
const quickForm = $('#quickSearch');
if (quickForm) {
  quickForm.onsubmit = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const q = $('#hq').value.trim();
    const type = $('#htype').value.trim();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    location.href = '/rentals.html' + (params.toString() ? '?' + params.toString() : '');
  };
}

async function loadHome() {
  try {
    const [props, reviews, testimonials] = await Promise.all([
      api('/public/properties'),
      api('/public/reviews/latest?limit=3'),
      api('/public/testimonials').catch(() => []),
    ]);
    const featured = [...props]
      .sort((a, b) => (b.availableRoomsCount > 0) - (a.availableRoomsCount > 0) || b.averageRating - a.averageRating || b.reviewCount - a.reviewCount)
      .slice(0, 3);

    $('#featuredCards').innerHTML = featured.length
      ? featured.map((p) => propertyCardHtml(p, null)).join('')
      : '<div class="empty">No published properties yet.</div>';
    syncFavorites();

    $('#latestReviews').innerHTML = reviews.length
      ? reviews
          .map(
            (r) => `<article class="review-card">
          <div class="review-head">
            <span class="stars" aria-label="${r.rating} stars">${starsText(r.rating)}</span>
            <span class="muted">${esc((r.createdAt || '').slice(0, 10))}</span>
          </div>
          ${r.title ? `<h3 style="font-size:16px;margin:0">${esc(r.title)}</h3>` : ''}
          <p class="muted" style="margin:0;color:var(--text)">"${esc(r.comment)}"</p>
          ${r.ownerReply ? `<div class="owner-reply"><b>Owner:</b> ${esc(r.ownerReply)}</div>` : ''}
          <div class="muted" style="margin-top:auto">
            <b>${esc(r.reviewerName)}</b> · <a href="#" data-details="${r.propertyId}">${esc(r.propertyName)}</a>
          </div>
        </article>`
          )
          .join('')
      : '<div class="empty">No approved reviews yet.</div>';

    const testMount = $('#testimonialsMount');
    if (testMount) {
      testMount.innerHTML = testimonials.length
        ? testimonials
            .map(
              (t) => `<article class="review-card">
            <div class="review-head">
              <span class="stars">${starsText(t.rating)}</span>
              ${t.propertyName ? `<span class="badge">${esc(t.propertyName)}</span>` : ''}
            </div>
            <p style="margin:0">"${esc(t.quote)}"</p>
            <div class="muted" style="margin-top:auto"><b>${esc(t.authorName)}</b> · ${esc(t.roleLabel || 'Resident')}</div>
          </article>`
            )
            .join('')
        : '<div class="empty">No testimonials published yet.</div>';
    }
  } catch (e) {
    $('#featuredCards').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    $('#latestReviews').innerHTML = '';
  }
}

loadHome();
