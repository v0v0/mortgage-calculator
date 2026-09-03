(() => {
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);

  // Two legacy initialization loops repeatedly rebuild the same result DOM for
  // several seconds. Replace only those known loops with a small number of
  // settling passes, then restore the native timer implementation after load.
  window.setInterval = function patchedSetInterval(handler, timeout, ...args) {
    const source = typeof handler === 'function' ? Function.prototype.toString.call(handler) : '';

    if (source.includes('renderSplitDetails') && source.includes('attempts >= 24')) {
      return nativeSetTimeout(() => handler(...args), 60);
    }

    if (source.includes('queueNormalizeTables') && source.includes('attempts >= 20')) {
      const first = nativeSetTimeout(() => handler(...args), 80);
      nativeSetTimeout(() => handler(...args), 260);
      return first;
    }

    return nativeSetInterval(handler, timeout, ...args);
  };

  function installComparisonStyles() {
    if (document.getElementById('comparison-v6-style')) return;
    const style = document.createElement('style');
    style.id = 'comparison-v6-style';
    style.textContent = `
      .comparison-card-wrap>.section-title{display:none!important}
      .comparison-card-wrap{padding-top:14px!important}
      .compare-title{gap:10px;align-items:center!important}
      .compare-title h3{flex:0 0 auto;margin:0!important}
      .compare-title-right{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:7px;min-width:0;flex-wrap:wrap}
      .compare-title .principal-cross-note{font-size:10px;font-weight:700;color:#087257;background:#eafaf3;border:1px solid #c8ebdc;padding:4px 7px;border-radius:999px;white-space:nowrap}
      .compare-title .current-choice-badge{font-size:9px!important;padding:4px 6px!important;white-space:nowrap;flex:0 0 auto}
      .principal-decrease-note{margin:-1px 0 5px;font-size:10px;color:#64748b;font-weight:650;line-height:1.4}
      .principal-decrease-note b{color:#087257;font-variant-numeric:tabular-nums}
      @media(max-width:720px){
        .comparison-card-wrap{padding-top:10px!important}
        .compare-title{align-items:flex-start!important}
        .compare-title-right{gap:5px;row-gap:4px}
        .compare-title .principal-cross-note{font-size:9px;padding:3px 5px;white-space:normal;text-align:right}
        .compare-title .current-choice-badge{font-size:8px!important;padding:3px 5px!important}
        .principal-decrease-note{font-size:9px;margin-top:-2px}
      }
    `;
    document.head.appendChild(style);
  }

  function regularPayment(row) {
    if (!row) return 0;
    return Math.max(0, Number(row.payment || 0) - Number(row.extraPrincipal || 0));
  }

  function currentResults() {
    try {
      if (typeof results === 'undefined' || !results) return null;
      return results;
    } catch (_) {
      return null;
    }
  }

  function crossoverPeriod(equalPaymentRows, equalPrincipalRows) {
    const limit = Math.min(equalPaymentRows.length, equalPrincipalRows.length);
    for (let i = 0; i < limit; i++) {
      const ep = regularPayment(equalPaymentRows[i]);
      const ea = regularPayment(equalPrincipalRows[i]);
      if (ep > 0.005 && ea + 0.005 < ep) return i + 1;
    }
    return 0;
  }

  function typicalPrincipalDecrease(rows) {
    const diffs = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (Number(prev?.extraPrincipal || 0) > 0.005 || Number(curr?.extraPrincipal || 0) > 0.005) continue;
      const a = regularPayment(prev);
      const b = regularPayment(curr);
      const diff = a - b;
      if (a > 0.005 && b > 0.005 && diff > 0.005) diffs.push(diff);
    }
    if (!diffs.length) return 0;
    diffs.sort((a, b) => a - b);
    const mid = Math.floor(diffs.length / 2);
    return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  }

  function formatYuan(value) {
    const amount = Math.abs(Number(value || 0));
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: amount < 10 ? 2 : 0
    }).format(amount);
  }

  function decorateComparison() {
    installComparisonStyles();
    const comparison = document.getElementById('comparison');
    const sets = currentResults();
    if (!comparison || !sets?.equalPayment?.total || !sets?.equalPrincipal?.total) return false;

    comparison.querySelectorAll('.compare-card').forEach(card => {
      const title = card.querySelector('.compare-title');
      if (!title) return;
      let right = title.querySelector('.compare-title-right');
      if (!right) {
        right = document.createElement('span');
        right.className = 'compare-title-right';
        title.appendChild(right);
      }
      const badge = [...title.children].find(el => el !== right && el.tagName === 'SPAN');
      if (badge) {
        badge.textContent = '当前';
        badge.classList.add('current-choice-badge');
        right.appendChild(badge);
      }
    });

    const principalCard = comparison.querySelector('.compare-card[data-method="equalPrincipal"]');
    const principalTitle = principalCard?.querySelector('.compare-title');
    const principalRight = principalTitle?.querySelector('.compare-title-right');
    if (!principalCard || !principalTitle || !principalRight) return true;

    const cross = crossoverPeriod(sets.equalPayment.total, sets.equalPrincipal.total);
    let crossNote = principalRight.querySelector('.principal-cross-note');
    if (!crossNote) {
      crossNote = document.createElement('span');
      crossNote.className = 'principal-cross-note';
      principalRight.prepend(crossNote);
    }
    crossNote.textContent = cross ? `第 ${cross} 期开始月供低于等额本息` : '月供未低于等额本息';

    const decrease = typicalPrincipalDecrease(sets.equalPrincipal.total);
    let decreaseNote = principalCard.querySelector('.principal-decrease-note');
    if (!decreaseNote) {
      decreaseNote = document.createElement('div');
      decreaseNote.className = 'principal-decrease-note';
      principalTitle.insertAdjacentElement('afterend', decreaseNote);
    }
    decreaseNote.innerHTML = decrease > 0.005 ? `常规月供每月约递减 <b>${formatYuan(decrease)}</b>` : '常规月供随剩余本金逐月下降';
    return true;
  }

  function installComparisonEnhancements() {
    installComparisonStyles();
    const heading = document.querySelector('.comparison-card-wrap>.section-title');
    if (heading) heading.remove();

    const comparison = document.getElementById('comparison');
    if (comparison) {
      new MutationObserver(() => nativeSetTimeout(decorateComparison, 0)).observe(comparison, { childList: true });
    }

    let attempts = 0;
    const settle = () => {
      decorateComparison();
      if (++attempts < 30 && !document.querySelector('.compare-card[data-method="equalPrincipal"] .principal-cross-note')) {
        nativeSetTimeout(settle, 80);
      }
    };
    settle();
  }

  installComparisonEnhancements();

  window.addEventListener('load', () => {
    nativeSetTimeout(() => {
      decorateComparison();
      window.setInterval = nativeSetInterval;
    }, 0);
  }, { once: true });
})();