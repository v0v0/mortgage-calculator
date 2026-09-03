(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const numberValue = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  function compactNumber(value) {
    const n = numberValue(value);
    if (!n) return '0';
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  }

  function currentMethod() {
    try {
      if (typeof primaryMethod !== 'undefined' && primaryMethod) return primaryMethod;
    } catch (_) {}
    return document.querySelector('#primaryMethodTabs button.active')?.dataset.value ||
      document.querySelector('#detailMethodTabs button.active')?.dataset.value ||
      'equalPayment';
  }

  function buildTitle() {
    const rawCity = $('city')?.selectedOptions?.[0]?.textContent?.trim() || '';
    const city = rawCity.split(/[·|｜]/)[0].trim() || '房贷';
    const amount = compactNumber($('loanAmount')?.value);
    const loanType = document.querySelector('#loanTypeTabs button.active')?.dataset.value || 'combined';
    const loanLabel = loanType === 'commercial' ? '商贷' : loanType === 'provident' ? '公积金' : '组合贷';
    const methodLabel = currentMethod() === 'equalPrincipal' ? '等额本金' : '等额本息';
    const baseYears = compactNumber($('termYears')?.value);

    let loanAndTerm = `${loanLabel}${baseYears}年`;
    if (loanType === 'combined' && $('separateTerms')?.checked) {
      const commercialYears = compactNumber($('commercialTermYears')?.value || baseYears);
      const providentYears = compactNumber($('providentTermYears')?.value || baseYears);
      loanAndTerm = commercialYears === providentYears
        ? `组合贷${commercialYears}年`
        : `组合贷商${commercialYears}/公${providentYears}年`;
    }

    return `${city}·${amount}万·${loanAndTerm}·${methodLabel}`;
  }

  function applyTitle() {
    const title = buildTitle();
    document.title = title;
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
    }
    ogTitle.setAttribute('content', title);
    return title;
  }

  function patchWebShare() {
    if (window.__mortgageShareTitlePatched || typeof Navigator === 'undefined') return;
    const original = Navigator.prototype.share;
    if (typeof original !== 'function') return;

    try {
      Navigator.prototype.share = function patchedShare(data = {}) {
        const title = applyTitle();
        return original.call(this, { ...data, title, text: title });
      };
      window.__mortgageShareTitlePatched = true;
    } catch (error) {
      console.warn('无法覆盖系统分享标题，将仅更新页面标题。', error);
    }
  }

  let queued = false;
  function queueTitle() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      applyTitle();
    });
  }

  patchWebShare();
  document.addEventListener('input', queueTitle, true);
  document.addEventListener('change', queueTitle, true);
  document.addEventListener('click', queueTitle, false);
  window.addEventListener('load', queueTitle, { once: true });
  setTimeout(queueTitle, 50);
  setTimeout(queueTitle, 400);
})();
