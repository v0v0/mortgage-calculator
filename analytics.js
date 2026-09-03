(() => {
  let cfg = null;
  let calcTimer = null;
  let interacted = false;

  async function loadConfig() {
    try {
      const res = await fetch('./data/analytics-config.json', { cache: 'no-store' });
      cfg = await res.json();
      if (!cfg?.enabled || !cfg?.endpoint) return;
      send('visit', {});
      bindCalculationTracking();
    } catch (e) {
      console.warn('analytics disabled:', e);
    }
  }

  function endpoint(path) {
    return `${String(cfg.endpoint).replace(/\/$/, '')}/v1/${path}`;
  }

  function send(path, payload) {
    if (!cfg?.enabled || !cfg?.endpoint) return;
    fetch(endpoint(path), {
      method: 'POST',
      mode: 'cors',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  function activeLoanType() {
    return document.querySelector('#loanTypeTabs button.active')?.dataset.value || 'combined';
  }

  function queueCalculation() {
    if (!interacted) return;
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => {
      const city = document.getElementById('city')?.value || '';
      const cityName = document.getElementById('city')?.selectedOptions?.[0]?.textContent?.split('·')[0]?.trim() || city;
      const housePriceWan = Number(document.getElementById('housePrice')?.value || 0);
      if (!city || !Number.isFinite(housePriceWan) || housePriceWan <= 0) return;
      send('calc', {
        city,
        cityName,
        housePriceWan,
        loanType: activeLoanType()
      });
    }, 800);
  }

  function bindCalculationTracking() {
    const root = document.querySelector('.form-card');
    if (!root) return;
    ['input', 'change', 'click'].forEach(type => {
      root.addEventListener(type, (event) => {
        if (!event.isTrusted) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.closest('input,select,button')) return;
        interacted = true;
        queueCalculation();
      }, { passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConfig, { once: true });
  } else {
    loadConfig();
  }
})();
