(() => {
  const detailCard = document.querySelector('.detail-card');
  if (!detailCard) return;

  let settleTimer = null;
  let minVisibleUntil = 0;
  let initialized = false;

  function beginLoading(minMs = 120) {
    clearTimeout(settleTimer);
    minVisibleUntil = Math.max(minVisibleUntil, performance.now() + minMs);
    detailCard.classList.add('is-calculating');
  }

  function finishWhenStable(delay = 110) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const remaining = minVisibleUntil - performance.now();
      if (remaining > 0) {
        finishWhenStable(Math.ceil(remaining));
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        detailCard.classList.remove('is-calculating');
        initialized = true;
      }));
    }, delay);
  }

  function scheduleFromMutation() {
    if (!detailCard.classList.contains('is-calculating') && initialized) return;
    finishWhenStable(90);
  }

  const detailObserver = new MutationObserver(scheduleFromMutation);
  detailObserver.observe(detailCard, { childList: true, subtree: true, attributes: false });

  const form = document.querySelector('.form-card');
  ['input', 'change'].forEach(type => {
    form?.addEventListener(type, () => {
      beginLoading(100);
      finishWhenStable(120);
    }, true);
  });

  ['loanTypeTabs', 'detailMethodTabs', 'detailViewTabs'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', event => {
      if (!event.target.closest('button')) return;
      beginLoading(90);
      finishWhenStable(110);
    }, true);
  });

  beginLoading(180);
  window.addEventListener('load', () => finishWhenStable(120), { once: true });
  finishWhenStable(260);
})();
