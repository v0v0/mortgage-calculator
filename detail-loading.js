(() => {
  const $ = id => document.getElementById(id);
  const detailCard = document.querySelector('.detail-card');
  if (!detailCard) return;

  const money0 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const originalAddPrepayment = typeof addPrepayment === 'function' ? addPrepayment : null;
  const originalCollectState = typeof collectState === 'function' ? collectState : null;

  let settleTimer = null;
  let detailRenderTimer = null;
  let minVisibleUntil = 0;
  let initialized = false;
  let renderingV5 = false;
  let recurringSeq = 0;

  function installStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #savePlan{display:none!important}
      .saved-card.top-saved-card{margin:0 0 12px!important;padding-top:13px!important;padding-bottom:13px!important}
      .saved-card.top-saved-card .section-title{margin-bottom:8px!important}
      .prepay-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      .prepay-actions button{white-space:nowrap}
      .recurring-prepayment-rule{display:grid;grid-template-columns:.8fr .9fr .9fr 1fr 1.55fr auto;gap:8px;align-items:end;padding:10px;background:linear-gradient(90deg,#eef6ff,#effcf8);border:1px solid #d8e8f5;border-radius:11px}
      .recurring-prepayment-rule label{min-width:0}
      .recurring-prepayment-rule input,.recurring-prepayment-rule select{width:100%;min-width:0}
      .recurring-generated-events,.recurring-generated{display:none!important}
      @media(max-width:1020px){.recurring-prepayment-rule{grid-template-columns:repeat(3,minmax(0,1fr))}.recurring-prepayment-rule>button{grid-column:auto}}
      @media(max-width:620px){.recurring-prepayment-rule{grid-template-columns:1fr 1fr}.prepay-actions{width:100%}.prepay-actions button{flex:1}}
      @media(max-width:420px){.recurring-prepayment-rule{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function moveSavedPlansToTop() {
    const saved = document.querySelector('.saved-card');
    const hero = document.querySelector('.hero');
    if (!saved || !hero) return;
    saved.classList.add('top-saved-card');
    hero.insertAdjacentElement('afterend', saved);
  }

  function setupPrepaymentActions() {
    const addCustom = $('addPrepayment');
    if (!addCustom) return;
    addCustom.textContent = '+ 自定义提前还';
    if ($('addRecurringPrepayment')) return;
    const actions = document.createElement('div');
    actions.className = 'prepay-actions';
    addCustom.parentNode.insertBefore(actions, addCustom);
    actions.appendChild(addCustom);
    const recurring = document.createElement('button');
    recurring.id = 'addRecurringPrepayment';
    recurring.type = 'button';
    recurring.className = 'ghost';
    recurring.textContent = '+ 定期提前还';
    actions.appendChild(recurring);
    recurring.addEventListener('click', () => {
      addPrepayment({ mode:'recurring', firstMonth:6, intervalMonths:6, amountWan:20 });
      if (typeof calculate === 'function') calculate();
      queueCorrectedDetails(30, true);
    });
  }

  function activeLoanType() {
    return document.querySelector('#loanTypeTabs button.active')?.dataset.value || 'combined';
  }

  function targetMaxMonths(target) {
    const type = activeLoanType();
    if (target === 'commercial' && type === 'provident') return 0;
    if (target === 'provident' && type === 'commercial') return 0;
    const separate = !!$('separateTerms')?.checked && type === 'combined';
    const years = Number((separate
      ? (target === 'commercial' ? $('commercialTermYears') : $('providentTermYears'))
      : $('termYears'))?.value || 30);
    return Math.max(0, years * 12);
  }

  function makeGeneratedEvent(month, amountWan, target, strategy) {
    const event = document.createElement('div');
    event.className = 'prepayment-row recurring-generated';
    event.setAttribute('aria-hidden', 'true');
    event.innerHTML = `
      <input data-field="month" value="${month}">
      <input data-field="amount" value="${amountWan}">
      <select data-field="target"><option value="commercial">commercial</option><option value="provident">provident</option></select>
      <select data-field="strategy"><option value="shorten">shorten</option><option value="reducePayment">reducePayment</option></select>`;
    event.querySelector('[data-field="target"]').value = target;
    event.querySelector('[data-field="strategy"]').value = strategy;
    return event;
  }

  function syncRecurringRule(rule) {
    const generated = rule.querySelector('.recurring-generated-events');
    if (!generated) return;
    const firstMonth = Math.max(1, Number(rule.querySelector('[data-field="firstMonth"]')?.value || 1));
    const intervalMonths = Math.max(1, Number(rule.querySelector('[data-field="intervalMonths"]')?.value || 6));
    const amountWan = Math.max(0, Number(rule.querySelector('[data-field="amount"]')?.value || 0));
    const target = rule.querySelector('[data-field="target"]')?.value || 'commercial';
    const strategy = rule.querySelector('[data-field="strategy"]')?.value || 'shorten';
    const maxMonths = targetMaxMonths(target);
    const fragment = document.createDocumentFragment();
    if (amountWan > 0 && maxMonths > 0) {
      for (let month = firstMonth; month <= maxMonths; month += intervalMonths) {
        fragment.appendChild(makeGeneratedEvent(month, amountWan, target, strategy));
      }
    }
    generated.replaceChildren(fragment);
  }

  function syncAllRecurringRules() {
    document.querySelectorAll('.recurring-prepayment-rule').forEach(syncRecurringRule);
  }

  function addRecurringRule(data = {}) {
    const list = $('prepaymentList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'recurring-prepayment-rule';
    row.dataset.ruleId = `recurring-${++recurringSeq}`;
    row.innerHTML = `
      <label>首次第几期<input data-field="firstMonth" type="number" min="1" value="${Number(data.firstMonth || data.month || 6)}"></label>
      <label>每隔（月）<input data-field="intervalMonths" type="number" min="1" value="${Number(data.intervalMonths || 6)}"></label>
      <label>每次金额（万元）<input data-field="amount" type="number" min="0" step="1" value="${Number(data.amountWan || 20)}"></label>
      <label>偿还目标<select data-field="target"><option value="commercial">商业贷款</option><option value="provident">公积金贷款</option></select></label>
      <label>处理策略<select data-field="strategy"><option value="shorten">月供基本不变，缩短期限</option><option value="reducePayment">期限不变，减少月供</option></select></label>
      <button class="ghost" type="button">删除</button>
      <div class="recurring-generated-events"></div>`;
    row.querySelector('[data-field="target"]').value = data.target || (activeLoanType() === 'provident' ? 'provident' : 'commercial');
    row.querySelector('[data-field="strategy"]').value = data.strategy || 'shorten';
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      if (typeof calculate === 'function') calculate();
      queueCorrectedDetails(25, true);
    });
    row.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('input', () => {
        syncRecurringRule(row);
        if (typeof calculate === 'function') calculate();
        queueCorrectedDetails(25, true);
      });
      el.addEventListener('change', () => {
        syncRecurringRule(row);
        if (typeof calculate === 'function') calculate();
        queueCorrectedDetails(25, true);
      });
    });
    list.appendChild(row);
    syncRecurringRule(row);
  }

  function patchPrepayments() {
    if (!originalAddPrepayment || !originalCollectState) return;

    addPrepayment = function patchedAddPrepayment(data = {}) {
      if (data?.mode === 'recurring') {
        addRecurringRule(data);
        return;
      }
      originalAddPrepayment(data);
      const row = $('prepaymentList')?.lastElementChild;
      if (row?.classList.contains('prepayment-row')) row.dataset.prepayMode = 'custom';
    };

    readPrepayments = function patchedReadPrepayments() {
      syncAllRecurringRules();
      return [...document.querySelectorAll('.prepayment-row:not(.recurring-prepayment-rule)')].map(row => ({
        month: Number(row.querySelector('[data-field="month"]')?.value || 0),
        amountWan: Number(row.querySelector('[data-field="amount"]')?.value || 0),
        target: row.querySelector('[data-field="target"]')?.value || 'commercial',
        strategy: row.querySelector('[data-field="strategy"]')?.value || 'shorten'
      })).filter(p => p.month > 0 && p.amountWan > 0);
    };

    collectState = function patchedCollectState() {
      const state = originalCollectState();
      const custom = [...document.querySelectorAll('#prepaymentList > .prepayment-row:not(.recurring-generated)')].map(row => ({
        mode:'custom',
        month:Number(row.querySelector('[data-field="month"]')?.value || 0),
        amountWan:Number(row.querySelector('[data-field="amount"]')?.value || 0),
        target:row.querySelector('[data-field="target"]')?.value || 'commercial',
        strategy:row.querySelector('[data-field="strategy"]')?.value || 'shorten'
      })).filter(p => p.month > 0 && p.amountWan > 0);
      const recurring = [...document.querySelectorAll('#prepaymentList > .recurring-prepayment-rule')].map(row => ({
        mode:'recurring',
        firstMonth:Number(row.querySelector('[data-field="firstMonth"]')?.value || 1),
        intervalMonths:Number(row.querySelector('[data-field="intervalMonths"]')?.value || 6),
        amountWan:Number(row.querySelector('[data-field="amount"]')?.value || 0),
        target:row.querySelector('[data-field="target"]')?.value || 'commercial',
        strategy:row.querySelector('[data-field="strategy"]')?.value || 'shorten'
      })).filter(p => p.firstMonth > 0 && p.intervalMonths > 0 && p.amountWan > 0);
      state.prepayments = [...custom, ...recurring];
      return state;
    };
  }

  function annualize(schedule) {
    const out = [];
    for (let i = 0; i < schedule.length; i += 12) {
      const rows = schedule.slice(i, i + 12);
      const start = i === 0
        ? ((schedule[0]?.remaining || 0) + (schedule[0]?.principal || 0))
        : (schedule[i - 1]?.remaining || 0);
      out.push({
        year:Math.floor(i / 12) + 1,
        start,
        payment:rows.reduce((s, r) => s + Number(r.payment || 0), 0),
        principal:rows.reduce((s, r) => s + Number(r.principal || 0), 0),
        interest:rows.reduce((s, r) => s + Number(r.interest || 0), 0),
        end:rows.at(-1)?.remaining || 0
      });
    }
    return out;
  }

  function annualAt(rows, i) {
    return rows[i] || { start:0, payment:0, principal:0, interest:0, end:0 };
  }

  function monthlyAt(rows, i) {
    return rows[i] || { period:i + 1, payment:0, principal:0, interest:0, extraPrincipal:0, cumulativeInterest:0, remaining:0 };
  }

  function fmtMonthlyPayment(value) {
    return Math.abs(Number(value || 0)) < 0.005 ? '—' : money2.format(value);
  }

  function currentResults(method) {
    try {
      if (typeof results === 'undefined' || !results) return null;
      return results[method] || null;
    } catch (_) {
      return null;
    }
  }

  function renderCorrectedDetails(force = false) {
    if (renderingV5) return;
    const method = document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
    const set = currentResults(method);
    const annualTable = $('annualBody')?.closest('table');
    const monthlyTable = $('monthlyBody')?.closest('table');
    if (!set || !annualTable || !monthlyTable) return;
    if (!force && annualTable.tHead?.querySelector('.v5-head') && monthlyTable.tHead?.querySelector('.v5-head')) return;

    renderingV5 = true;
    try {
      const type = activeLoanType();
      const combined = type === 'combined';
      const hasCommercial = combined && (set.commercial?.length || 0) > 0;
      const hasProvident = combined && (set.provident?.length || 0) > 0;
      const hasExtra = (set.total || []).some(r => Number(r.extraPrincipal || 0) > 0.005);
      const annualTotal = annualize(set.total || []);
      const annualCommercial = annualize(set.commercial || []);
      const annualProvident = annualize(set.provident || []);

      annualTable.tHead.innerHTML =
        `<tr class="group-head v5-head"><th rowspan="2">年度</th><th colspan="4" class="total-group">合计</th>` +
        (hasCommercial ? '<th colspan="4" class="commercial-group">商业贷款</th>' : '') +
        (hasProvident ? '<th colspan="4" class="provident-group">公积金贷款</th>' : '') +
        `</tr><tr><th>年初本金</th><th>年度还款</th><th>偿还本金</th><th>支付利息</th>` +
        (hasCommercial ? '<th>还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') +
        (hasProvident ? '<th>还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') + '</tr>';

      $('annualBody').innerHTML = annualTotal.length ? annualTotal.map((t, i) => {
        const c = annualAt(annualCommercial, i);
        const p = annualAt(annualProvident, i);
        return `<tr><td>第 ${t.year} 年</td><td>${money0.format(t.start)}</td><td>${money0.format(t.payment)}</td><td>${money0.format(t.principal)}</td><td>${money0.format(t.interest)}</td>` +
          (hasCommercial ? `<td>${money0.format(c.payment)}</td><td>${money0.format(c.principal)}</td><td>${money0.format(c.interest)}</td><td>${money0.format(c.end)}</td>` : '') +
          (hasProvident ? `<td>${money0.format(p.payment)}</td><td>${money0.format(p.principal)}</td><td>${money0.format(p.interest)}</td><td>${money0.format(p.end)}</td>` : '') + '</tr>';
      }).join('') : '<tr><td class="empty-cell">暂无数据</td></tr>';

      const totalCols = hasExtra ? 6 : 5;
      monthlyTable.tHead.innerHTML =
        `<tr class="group-head v5-head"><th rowspan="2">期数</th><th rowspan="2">日期</th><th colspan="${totalCols}" class="total-group">合计</th>` +
        (hasCommercial ? '<th colspan="4" class="commercial-group">商业贷款</th>' : '') +
        (hasProvident ? '<th colspan="4" class="provident-group">公积金贷款</th>' : '') +
        `</tr><tr><th>月还款</th><th>本金</th><th>利息</th>` +
        (hasExtra ? '<th>提前还款</th>' : '') +
        '<th>累计利息</th><th>剩余本金</th>' +
        (hasCommercial ? '<th>月还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') +
        (hasProvident ? '<th>月还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') + '</tr>';

      const startMonth = $('startMonth')?.value || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const addMonth = (ym, offset) => {
        const [y, m] = String(ym).split('-').map(Number);
        const d = new Date(y, m - 1 + offset, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      };
      $('monthlyBody').innerHTML = (set.total || []).length ? set.total.map((t, i) => {
        const c = monthlyAt(set.commercial || [], i);
        const p = monthlyAt(set.provident || [], i);
        return `<tr><td>第 ${t.period} 期</td><td>${addMonth(startMonth, i)}</td><td>${fmtMonthlyPayment(t.payment)}</td><td>${money2.format(t.principal || 0)}</td><td>${money2.format(t.interest || 0)}</td>` +
          (hasExtra ? `<td>${Number(t.extraPrincipal || 0) > 0.005 ? money2.format(t.extraPrincipal) : '—'}</td>` : '') +
          `<td>${money2.format(t.cumulativeInterest || 0)}</td><td>${money2.format(t.remaining || 0)}</td>` +
          (hasCommercial ? `<td>${fmtMonthlyPayment(c.payment)}</td><td>${money2.format(c.principal || 0)}</td><td>${money2.format(c.interest || 0)}</td><td>${money2.format(c.remaining || 0)}</td>` : '') +
          (hasProvident ? `<td>${fmtMonthlyPayment(p.payment)}</td><td>${money2.format(p.principal || 0)}</td><td>${money2.format(p.interest || 0)}</td><td>${money2.format(p.remaining || 0)}</td>` : '') + '</tr>';
      }).join('') : '<tr><td class="empty-cell">暂无数据</td></tr>';

      const note = document.querySelector('.detail-note');
      if (note) note.textContent = combined
        ? '完整列出每月合计及商业贷款 / 公积金组成。'
        : '完整列出每月还款明细。';
    } finally {
      renderingV5 = false;
    }
  }

  function queueCorrectedDetails(delay = 25, force = false) {
    clearTimeout(detailRenderTimer);
    detailRenderTimer = setTimeout(() => renderCorrectedDetails(force), delay);
  }

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
      queueCorrectedDetails(0, true);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        detailCard.classList.remove('is-calculating');
        initialized = true;
      }));
    }, delay);
  }

  function scheduleFromMutation() {
    if (!renderingV5) {
      const annualReady = !!$('annualBody')?.closest('table')?.tHead?.querySelector('.v5-head');
      const monthlyReady = !!$('monthlyBody')?.closest('table')?.tHead?.querySelector('.v5-head');
      if (!annualReady || !monthlyReady) queueCorrectedDetails(18, true);
    }
    if (!detailCard.classList.contains('is-calculating') && initialized) return;
    finishWhenStable(90);
  }

  function installRefreshHooks() {
    const detailObserver = new MutationObserver(scheduleFromMutation);
    detailObserver.observe(detailCard, { childList:true, subtree:true, attributes:false });

    const form = document.querySelector('.form-card');
    ['input', 'change'].forEach(type => {
      form?.addEventListener(type, () => {
        beginLoading(100);
        setTimeout(() => {
          syncAllRecurringRules();
          if (typeof calculate === 'function') calculate();
          queueCorrectedDetails(20, true);
          finishWhenStable(120);
        }, 0);
      }, true);
    });

    ['loanTypeTabs', 'detailMethodTabs', 'detailViewTabs'].forEach(id => {
      $(id)?.addEventListener('click', event => {
        if (!event.target.closest('button')) return;
        beginLoading(90);
        setTimeout(() => {
          syncAllRecurringRules();
          if (id === 'loanTypeTabs' && typeof calculate === 'function') calculate();
          queueCorrectedDetails(24, true);
          finishWhenStable(110);
        }, 0);
      }, true);
    });
  }

  installStyles();
  moveSavedPlansToTop();
  patchPrepayments();
  setupPrepaymentActions();
  installRefreshHooks();
  beginLoading(180);
  setTimeout(() => queueCorrectedDetails(0, true), 120);
  window.addEventListener('load', () => {
    syncAllRecurringRules();
    queueCorrectedDetails(0, true);
    finishWhenStable(120);
  }, { once:true });
  finishWhenStable(260);
})();
