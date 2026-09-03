(() => {
  const QUALIFIED_VISIT_MS = 2_000;
  const CALC_IDLE_MS = 2_000;

  let cfg = null;
  let calcTimer = null;
  let visitTimer = null;
  let visitRecorded = false;
  let interacted = false;
  let lastCalcPayload = '';
  let visibleElapsedMs = 0;
  let visibleStartedAt = document.visibilityState === 'visible' ? performance.now() : null;

  async function loadConfig() {
    try {
      const res = await fetch('./data/analytics-config.json', { cache: 'no-store' });
      cfg = await res.json();
      if (!cfg?.enabled || !cfg?.endpoint) return;
      bindQualifiedVisitTracking();
      bindCalculationTracking();
      bindExportTracking();
    } catch (e) {
      console.warn('analytics disabled:', e);
    }
  }

  function endpoint(path) {
    return `${String(cfg.endpoint).replace(/\/$/, '')}/v1/${path}`;
  }

  async function send(path, payload = {}) {
    if (!cfg?.enabled || !cfg?.endpoint) return false;
    try {
      const res = await fetch(endpoint(path), {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  function activeLoanType() {
    return document.querySelector('#loanTypeTabs button.active')?.dataset.value || 'combined';
  }

  function activeRepaymentMethod() {
    return document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
  }

  function snapshot() {
    const city = document.getElementById('city')?.value || '';
    const cityName = document.getElementById('city')?.selectedOptions?.[0]?.textContent?.trim() || city;
    const loanAmountWan = Number(document.getElementById('loanAmount')?.value || 0);
    return {
      city,
      cityName,
      loanAmountWan,
      loanType: activeLoanType(),
      repaymentMethod: activeRepaymentMethod()
    };
  }

  function validSnapshot(payload) {
    return payload.city && Number.isFinite(payload.loanAmountWan) && payload.loanAmountWan > 0;
  }

  function currentVisibleElapsed() {
    if (visibleStartedAt === null) return visibleElapsedMs;
    return visibleElapsedMs + Math.max(0, performance.now() - visibleStartedAt);
  }

  function clearVisitTimer() {
    if (visitTimer !== null) {
      clearTimeout(visitTimer);
      visitTimer = null;
    }
  }

  function armVisitTimer() {
    clearVisitTimer();
    if (visitRecorded || document.visibilityState !== 'visible') return;
    const remaining = Math.max(0, QUALIFIED_VISIT_MS - currentVisibleElapsed());
    visitTimer = setTimeout(recordQualifiedVisit, remaining);
  }

  async function recordQualifiedVisit() {
    clearVisitTimer();
    if (visitRecorded || document.visibilityState !== 'visible') return;
    if (currentVisibleElapsed() < QUALIFIED_VISIT_MS) {
      armVisitTimer();
      return;
    }

    visitRecorded = true;
    const ok = await send('visit');
    if (!ok) {
      visitRecorded = false;
      setTimeout(armVisitTimer, 5_000);
    }
  }

  function bindQualifiedVisitTracking() {
    if (document.visibilityState === 'visible' && visibleStartedAt === null) {
      visibleStartedAt = performance.now();
    }
    armVisitTimer();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        visibleStartedAt = performance.now();
        armVisitTimer();
      } else {
        if (visibleStartedAt !== null) {
          visibleElapsedMs += Math.max(0, performance.now() - visibleStartedAt);
          visibleStartedAt = null;
        }
        clearVisitTimer();
      }
    });
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
    }, CALC_IDLE_MS);
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
      send('export', payload);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConfig, { once: true });
  } else {
    loadConfig();
  }
})();

// Final display normalization. detail-loading.js is the last table renderer and some
// columns may be written with Intl.NumberFormat after earlier formatters have run.
// Normalize the final DOM so every zero-valued money cell in repayment details is a dash.
(() => {
  const ZERO_MONEY_RE = /^(?:CN¥|CNY\s*|¥|￥)?\s*[+-]?0(?:\.0+)?\s*$/i;
  let queued = false;

  function normalizeZeroMoney() {
    ['annualBody', 'monthlyBody'].forEach(id => {
      document.getElementById(id)?.querySelectorAll('td').forEach(cell => {
        if (ZERO_MONEY_RE.test(cell.textContent.trim())) cell.textContent = '—';
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

  function installZeroNormalizer() {
    normalizeZeroMoney();
    const detailCard = document.querySelector('.detail-card');
    if (detailCard) {
      new MutationObserver(queueNormalize).observe(detailCard, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    setTimeout(normalizeZeroMoney, 80);
    setTimeout(normalizeZeroMoney, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installZeroNormalizer, { once: true });
  } else {
    installZeroNormalizer();
  }
})();
