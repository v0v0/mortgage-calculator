(() => {
  const BAIDU_SITE_ID = '67635ed0d1b5200fa4df6891bf568485';
  const QUALIFIED_VISIT_MS = 2_000;
  const CALC_IDLE_MS = 2_000;
  const BAIDU_RETRY_MS = 5_000;

  let calcTimer = null;
  let visitTimer = null;
  let visitRecorded = false;
  let interacted = false;
  let lastCalcPayload = '';
  let visibleElapsedMs = 0;
  let visibleStartedAt = document.visibilityState === 'visible' ? performance.now() : null;

  window._hmt = window._hmt || [];
  // Keep the existing analytics definition: a PV is counted only after the page
  // has been visible for a cumulative 2 seconds. This must be queued before hm.js.
  window._hmt.push(['_setAutoPageview', false]);

  function loadBaiduAnalytics() {
    if (document.querySelector(`script[data-baidu-tongji="${BAIDU_SITE_ID}"]`)) return;

    const hm = document.createElement('script');
    hm.src = `https://hm.baidu.com/hm.js?${BAIDU_SITE_ID}`;
    hm.async = true;
    hm.dataset.baiduTongji = BAIDU_SITE_ID;
    hm.onerror = () => {
      hm.remove();
      setTimeout(loadBaiduAnalytics, BAIDU_RETRY_MS);
    };

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(hm, firstScript);
    } else {
      document.head.appendChild(hm);
    }
  }

  function trackPageview() {
    let path = `${location.pathname}${location.search}`;
    if (!path.startsWith('/')) path = `/${path}`;
    window._hmt.push(['_trackPageview', path]);
  }

  function trackEvent(action, label, value) {
    const event = ['_trackEvent', 'mortgage', action, String(label || 'unknown')];
    if (Number.isFinite(value)) event.push(value);
    window._hmt.push(event);
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

  function amountBucket(loanAmountWan) {
    const start = Math.floor(loanAmountWan / 10) * 10;
    return `${start}-${start + 10}万`;
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

  function recordQualifiedVisit() {
    clearVisitTimer();
    if (visitRecorded || document.visibilityState !== 'visible') return;
    if (currentVisibleElapsed() < QUALIFIED_VISIT_MS) {
      armVisitTimer();
      return;
    }

    visitRecorded = true;
    trackPageview();
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

  function recordCalculation(payload) {
    trackEvent('calculate', 'valid', Math.round(payload.loanAmountWan));
    trackEvent('calculate_city', payload.cityName);
    trackEvent('loan_amount_bucket', amountBucket(payload.loanAmountWan));
    trackEvent('loan_type', payload.loanType);
    trackEvent('repayment_method', payload.repaymentMethod);
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
      recordCalculation(payload);
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
      trackEvent('export', payload.cityName, Math.round(payload.loanAmountWan));
    }, true);
  }

  function startAnalytics() {
    loadBaiduAnalytics();
    bindQualifiedVisitTracking();
    bindCalculationTracking();
    bindExportTracking();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAnalytics, { once: true });
  } else {
    startAnalytics();
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
