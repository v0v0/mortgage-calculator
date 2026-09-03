(() => {
  const VISITOR_KEY = 'mortgage-calculator-visitor-v1';
  let cfg = null;
  let calcTimer = null;
  let interacted = false;
  let lastCalcPayload = '';
  let memoryVisitorId = '';

  function makeId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function visitorId() {
    try {
      let value = localStorage.getItem(VISITOR_KEY);
      if (!value) {
        value = makeId();
        localStorage.setItem(VISITOR_KEY, value);
      }
      return value;
    } catch (_) {
      if (!memoryVisitorId) memoryVisitorId = makeId();
      return memoryVisitorId;
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch('./data/analytics-config.json', { cache: 'no-store' });
      cfg = await res.json();
      if (!cfg?.enabled || !cfg?.endpoint) return;
      send('visit', { visitorId: visitorId() });
      bindCalculationTracking();
      bindExportTracking();
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

  function activeRepaymentMethod() {
    return document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
  }

  function prepaymentSummary() {
    const rows = [...document.querySelectorAll('.prepayment-row')];
    let count = 0;
    let totalWan = 0;
    rows.forEach(row => {
      const month = Number(row.querySelector('[data-field="month"]')?.value || 0);
      const amount = Number(row.querySelector('[data-field="amount"]')?.value || 0);
      if (month > 0 && amount > 0) {
        count += 1;
        totalWan += amount;
      }
    });
    return { prepaymentCount: count, prepaymentTotalWan: Number(totalWan.toFixed(2)) };
  }

  function snapshot() {
    const city = document.getElementById('city')?.value || '';
    const cityName = document.getElementById('city')?.selectedOptions?.[0]?.textContent?.trim() || city;
    const housePriceWan = Number(document.getElementById('housePrice')?.value || 0);
    const loanAmountWan = Number(document.getElementById('loanAmount')?.value || 0);
    const loanRatio = Number(document.getElementById('loanRatio')?.value || 0);
    const providentAmountWan = Number(document.getElementById('providentAmount')?.value || 0);
    const termYears = Number(document.getElementById('termYears')?.value || 0);
    const commercialRate = Number(document.getElementById('commercialRate')?.value || 0);
    const providentRate = Number(document.getElementById('providentRate')?.value || 0);
    const prepayment = prepaymentSummary();
    return {
      visitorId: visitorId(),
      city,
      cityName,
      housePriceWan,
      loanAmountWan,
      loanRatio,
      loanType: activeLoanType(),
      repaymentMethod: activeRepaymentMethod(),
      homeType: document.getElementById('homeType')?.value || 'first',
      termYears,
      providentAmountWan,
      commercialRate,
      providentRate,
      ...prepayment
    };
  }

  function validSnapshot(payload) {
    return payload.city && Number.isFinite(payload.housePriceWan) && payload.housePriceWan > 0 &&
      Number.isFinite(payload.loanAmountWan) && payload.loanAmountWan >= 0;
  }

  function queueCalculation() {
    if (!interacted) return;
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => {
      const payload = snapshot();
      if (!validSnapshot(payload)) return;
      const signature = JSON.stringify(payload);
      if (signature === lastCalcPayload) return;
      lastCalcPayload = signature;
      send('calc', payload);
    }, 1200);
  }

  function bindCalculationTracking() {
    const root = document.querySelector('.form-card');
    if (!root) return;
    ['input', 'change', 'click'].forEach(type => {
      root.addEventListener(type, event => {
        if (!event.isTrusted) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.closest('input,select,button')) return;
        interacted = true;
        queueCalculation();
      }, { passive: true });
    });

    document.getElementById('detailMethodTabs')?.addEventListener('click', event => {
      if (!event.isTrusted || !event.target.closest('button[data-value]')) return;
      interacted = true;
      queueCalculation();
    }, { passive: true });
  }

  function bindExportTracking() {
    document.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const button = event.target.closest?.('#floatPdf');
      if (!button) return;
      const payload = snapshot();
      if (!validSnapshot(payload)) return;
      payload.detailView = document.querySelector('#detailViewTabs button.active')?.dataset.value || 'annual';
      send('export', payload);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConfig, { once: true });
  } else {
    loadConfig();
  }
})();
