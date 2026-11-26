/* about.js - About & FAQ page: interactive FAQ accordion */
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
