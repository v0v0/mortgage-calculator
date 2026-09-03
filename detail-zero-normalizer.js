(() => {
  const ZERO_MONEY_RE = /^(?:CN¥|CNY\s*|¥|￥)?\s*[+-]?0(?:\.0+)?\s*$/i;
  let queued = false;

  function normalizeZeroMoney(root = document) {
    const bodies = [
      root.querySelector?.('#annualBody'),
      root.querySelector?.('#monthlyBody')
    ].filter(Boolean);

    bodies.forEach(tbody => {
      tbody.querySelectorAll('td').forEach(cell => {
        const text = cell.textContent.trim();
        if (ZERO_MONEY_RE.test(text)) cell.textContent = '—';
      });
    });
  }

  function queueNormalize() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      normalizeZeroMoney();
    });
  }

  function install() {
    normalizeZeroMoney();

    const detailCard = document.querySelector('.detail-card');
    if (detailCard) {
      new MutationObserver(queueNormalize).observe(detailCard, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    ['input', 'change', 'click'].forEach(type => {
      document.addEventListener(type, event => {
        if (!event.target.closest?.('.form-card, #detailMethodTabs, #detailViewTabs, #loanTypeTabs')) return;
        setTimeout(normalizeZeroMoney, 0);
        setTimeout(normalizeZeroMoney, 80);
      }, true);
    });

    window.addEventListener('load', () => {
      normalizeZeroMoney();
      setTimeout(normalizeZeroMoney, 150);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
