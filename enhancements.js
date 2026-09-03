(() => {
  const $ = id => document.getElementById(id);
  const money0 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num2 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let renderingDetails = false;
  let chartWrap = null;
  let chartOverlay = null;
  let chartTooltip = null;

  // app.js v2 still references the old scope controls. Keep a hidden compatibility node
  // while the visible UI now renders commercial/provident details as table columns.
  function ensureCompatibilityScope() {
    if ($('detailScopeWrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'detailScopeWrap';
    wrap.className = 'hidden';
    wrap.innerHTML = '<div id="detailScopeTabs"><button data-value="total" class="active"></button><button data-value="commercial"></button><button data-value="provident"></button></div>';
    document.body.appendChild(wrap);
  }
  ensureCompatibilityScope();

  function yuanFromWan(v) { return Math.max(0, Number(v || 0)) * 10000; }
  function addMonths(ym, offset) {
    const parts = String(ym || '').split('-').map(Number);
    const y = parts[0] || new Date().getFullYear();
    const m = parts[1] || (new Date().getMonth() + 1);
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function amortizedPayment(balance, monthlyRate, months) {
    if (months <= 0) return balance;
    if (monthlyRate === 0) return balance / months;
    const p = Math.pow(1 + monthlyRate, months);
    return balance * monthlyRate * p / (p - 1);
  }
  function readPrepayments() {
    return [...document.querySelectorAll('.prepayment-row')].map(row => ({
      month: Number(row.querySelector('[data-field="month"]')?.value || 0),
      amountWan: Number(row.querySelector('[data-field="amount"]')?.value || 0),
      target: row.querySelector('[data-field="target"]')?.value || 'commercial',
      strategy: row.querySelector('[data-field="strategy"]')?.value || 'shorten'
    })).filter(p => p.month > 0 && p.amountWan > 0);
  }
  function generateSchedule({ principal, annualRate, months, method, prepayments = [] }) {
    if (principal <= 0 || months <= 0) return [];
    const r = annualRate / 100 / 12;
    let balance = principal;
    let payment = method === 'equalPayment' ? amortizedPayment(balance, r, months) : 0;
    let principalPart = method === 'equalPrincipal' ? balance / months : 0;
    const ppMap = new Map();
    prepayments.forEach(p => {
      const month = Math.max(1, Number(p.month || 0));
      if (!ppMap.has(month)) ppMap.set(month, []);
      ppMap.get(month).push(p);
    });
    const rows = [];
    let cumulativePrincipal = 0;
    let cumulativeInterest = 0;
    const safetyMax = Math.max(months + 120, 480);
    for (let i = 1; i <= safetyMax && balance > 0.005; i++) {
      const opening = balance;
      const interest = opening * r;
      let scheduledPrincipal;
      let scheduledPayment;
      if (method === 'equalPayment') {
        scheduledPayment = Math.min(payment, opening + interest);
        scheduledPrincipal = Math.max(0, scheduledPayment - interest);
      } else {
        scheduledPrincipal = Math.min(principalPart, opening);
        scheduledPayment = scheduledPrincipal + interest;
      }
      balance = Math.max(0, opening - scheduledPrincipal);
      let extraPrincipal = 0;
      for (const event of (ppMap.get(i) || [])) {
        const extra = Math.min(yuanFromWan(event.amountWan), balance);
        balance -= extra;
        extraPrincipal += extra;
        const remaining = Math.max(1, months - i);
        if (event.strategy === 'reducePayment' && balance > 0) {
          if (method === 'equalPayment') payment = amortizedPayment(balance, r, remaining);
          else principalPart = balance / remaining;
        }
      }
      const principalPaid = scheduledPrincipal + extraPrincipal;
      const totalPayment = scheduledPayment + extraPrincipal;
      cumulativePrincipal += principalPaid;
      cumulativeInterest += interest;
      rows.push({
        period: i, payment: totalPayment, principal: principalPaid, interest,
        extraPrincipal, cumulativePrincipal, cumulativeInterest, remaining: Math.max(0, balance)
      });
      if (i >= months && balance > 0.005) {
        const finalInterest = balance * r;
        cumulativeInterest += finalInterest;
        cumulativePrincipal += balance;
        rows.push({
          period: i + 1, payment: balance + finalInterest, principal: balance, interest: finalInterest,
          extraPrincipal: 0, cumulativePrincipal, cumulativeInterest, remaining: 0
        });
        balance = 0;
      }
    }
    return rows;
  }
  function mergeSchedules(a, b) {
    const n = Math.max(a.length, b.length);
    const rows = [];
    let cp = 0, ci = 0;
    for (let i = 0; i < n; i++) {
      const c = a[i] || { payment:0, principal:0, interest:0, extraPrincipal:0, remaining:0 };
      const p = b[i] || { payment:0, principal:0, interest:0, extraPrincipal:0, remaining:0 };
      const principal = c.principal + p.principal;
      const interest = c.interest + p.interest;
      cp += principal; ci += interest;
      rows.push({ period:i+1, payment:c.payment+p.payment, principal, interest, extraPrincipal:c.extraPrincipal+p.extraPrincipal, cumulativePrincipal:cp, cumulativeInterest:ci, remaining:c.remaining+p.remaining });
    }
    return rows;
  }
  function currentLoanType() {
    return document.querySelector('#loanTypeTabs button.active')?.dataset.value || 'combined';
  }
  function currentPrimaryMethod() {
    return document.querySelector('#repaymentMethodTabs button.active')?.dataset.value || 'equalPayment';
  }
  function currentDetailMethod() {
    return document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
  }
  function buildSchedules(method) {
    const loanType = currentLoanType();
    const totalWan = Math.max(0, Number($('loanAmount')?.value || 0));
    const total = yuanFromWan(totalWan);
    let commercial = 0, provident = 0;
    if (loanType === 'commercial') commercial = total;
    else if (loanType === 'provident') provident = total;
    else {
      provident = Math.min(yuanFromWan($('providentAmount')?.value || 0), total);
      commercial = Math.max(0, total - provident);
    }
    const separate = !!$('separateTerms')?.checked && loanType === 'combined';
    const commercialYears = Number((separate ? $('commercialTermYears') : $('termYears'))?.value || 30);
    const providentYears = Number((separate ? $('providentTermYears') : $('termYears'))?.value || 30);
    const pps = readPrepayments();
    const commercialSchedule = generateSchedule({
      principal: commercial,
      annualRate: Number($('commercialRate')?.value || 0),
      months: commercialYears * 12,
      method,
      prepayments: pps.filter(p => p.target === 'commercial')
    });
    const providentSchedule = generateSchedule({
      principal: provident,
      annualRate: Number($('providentRate')?.value || 0),
      months: providentYears * 12,
      method,
      prepayments: pps.filter(p => p.target === 'provident')
    });
    return { commercial: commercialSchedule, provident: providentSchedule, total: mergeSchedules(commercialSchedule, providentSchedule), commercialPrincipal: commercial, providentPrincipal: provident };
  }

  function annualize(schedule) {
    const out = [];
    for (let i = 0; i < schedule.length; i += 12) {
      const rows = schedule.slice(i, i + 12);
      const start = i === 0 ? ((schedule[0]?.remaining || 0) + (schedule[0]?.principal || 0)) : (schedule[i - 1]?.remaining || 0);
      out.push({
        year: Math.floor(i / 12) + 1,
        start,
        principal: rows.reduce((s, r) => s + r.principal, 0),
        interest: rows.reduce((s, r) => s + r.interest, 0),
        payment: rows.reduce((s, r) => s + r.payment, 0),
        end: rows.at(-1)?.remaining || 0
      });
    }
    return out;
  }
  function annualAt(rows, i) { return rows[i] || { start:0, principal:0, interest:0, payment:0, end:0 }; }
  function monthlyAt(rows, i) { return rows[i] || { payment:0, principal:0, interest:0, extraPrincipal:0, cumulativePrincipal:0, cumulativeInterest:0, remaining:0 }; }

  function renderSplitDetails() {
    if (renderingDetails || !$('annualBody') || !$('monthlyBody')) return;
    renderingDetails = true;
    try {
      const schedules = buildSchedules(currentDetailMethod());
      const hasCommercial = schedules.commercialPrincipal > 0.005;
      const hasProvident = schedules.providentPrincipal > 0.005;
      const annualTotal = annualize(schedules.total);
      const annualCommercial = annualize(schedules.commercial);
      const annualProvident = annualize(schedules.provident);

      const annualGroups = [
        '<tr class="group-head"><th rowspan="2">年度</th><th colspan="5" class="total-group">合计</th>' +
        (hasCommercial ? '<th colspan="4" class="commercial-group">商业贷款</th>' : '') +
        (hasProvident ? '<th colspan="4" class="provident-group">公积金贷款</th>' : '') + '</tr>',
        '<tr><th>年初本金</th><th>年度还款</th><th>偿还本金</th><th>支付利息</th><th>年末本金</th>' +
        (hasCommercial ? '<th>还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') +
        (hasProvident ? '<th>还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') + '</tr>'
      ].join('');
      $('annualHead')?.closest('thead')?.replaceChildren();
      const annualThead = $('annualBody').closest('table').querySelector('thead');
      annualThead.innerHTML = annualGroups;
      $('annualBody').innerHTML = annualTotal.map((t, i) => {
        const c = annualAt(annualCommercial, i), p = annualAt(annualProvident, i);
        return `<tr><td>第 ${t.year} 年</td><td>${money0.format(t.start)}</td><td>${money0.format(t.payment)}</td><td>${money0.format(t.principal)}</td><td>${money0.format(t.interest)}</td><td>${money0.format(t.end)}</td>` +
          (hasCommercial ? `<td>${money0.format(c.payment)}</td><td>${money0.format(c.principal)}</td><td>${money0.format(c.interest)}</td><td>${money0.format(c.end)}</td>` : '') +
          (hasProvident ? `<td>${money0.format(p.payment)}</td><td>${money0.format(p.principal)}</td><td>${money0.format(p.interest)}</td><td>${money0.format(p.end)}</td>` : '') + '</tr>';
      }).join('') || '<tr><td class="empty-cell">暂无数据</td></tr>';

      const monthlyHead = '<tr class="group-head"><th rowspan="2">期数</th><th rowspan="2">日期</th><th colspan="6" class="total-group">合计</th>' +
        (hasCommercial ? '<th colspan="4" class="commercial-group">商业贷款</th>' : '') +
        (hasProvident ? '<th colspan="4" class="provident-group">公积金贷款</th>' : '') + '</tr>' +
        '<tr><th>月还款</th><th>本金</th><th>利息</th><th>提前还款</th><th>累计利息</th><th>剩余本金</th>' +
        (hasCommercial ? '<th>月还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') +
        (hasProvident ? '<th>月还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') + '</tr>';
      const monthlyThead = $('monthlyBody').closest('table').querySelector('thead');
      monthlyThead.innerHTML = monthlyHead;
      const startMonth = $('startMonth')?.value || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
      $('monthlyBody').innerHTML = schedules.total.map((t, i) => {
        const c = monthlyAt(schedules.commercial, i), p = monthlyAt(schedules.provident, i);
        return `<tr><td>第 ${t.period} 期</td><td>${addMonths(startMonth, i)}</td><td>${money2.format(t.payment)}</td><td>${money2.format(t.principal)}</td><td>${money2.format(t.interest)}</td><td>${t.extraPrincipal ? money2.format(t.extraPrincipal) : '—'}</td><td>${money2.format(t.cumulativeInterest)}</td><td>${money2.format(t.remaining)}</td>` +
          (hasCommercial ? `<td>${money2.format(c.payment)}</td><td>${money2.format(c.principal)}</td><td>${money2.format(c.interest)}</td><td>${money2.format(c.remaining)}</td>` : '') +
          (hasProvident ? `<td>${money2.format(p.payment)}</td><td>${money2.format(p.principal)}</td><td>${money2.format(p.interest)}</td><td>${money2.format(p.remaining)}</td>` : '') + '</tr>';
      }).join('') || '<tr><td class="empty-cell">暂无数据</td></tr>';
    } finally {
      renderingDetails = false;
    }
  }

  function installDetailRefresh() {
    const schedule = () => setTimeout(renderSplitDetails, 0);
    document.querySelector('.form-card')?.addEventListener('input', schedule, true);
    document.querySelector('.form-card')?.addEventListener('change', schedule, true);
    document.querySelector('#loanTypeTabs')?.addEventListener('click', schedule, true);
    document.querySelector('#detailMethodTabs')?.addEventListener('click', schedule, true);
    document.querySelector('#detailViewTabs')?.addEventListener('click', schedule, true);
    let attempts = 0;
    const timer = setInterval(() => {
      renderSplitDetails();
      if (++attempts >= 24) clearInterval(timer);
    }, 250);
  }

  function ensureChartOverlay() {
    const canvas = $('trendChart');
    if (!canvas || chartOverlay) return;
    chartWrap = document.createElement('div');
    chartWrap.className = 'interactive-chart-wrap';
    canvas.parentNode.insertBefore(chartWrap, canvas);
    chartWrap.appendChild(canvas);
    chartOverlay = document.createElement('canvas');
    chartOverlay.className = 'trend-overlay';
    chartWrap.appendChild(chartOverlay);
    chartTooltip = document.createElement('div');
    chartTooltip.className = 'trend-tooltip';
    chartTooltip.hidden = true;
    chartWrap.appendChild(chartTooltip);

    const move = event => {
      const rect = chartOverlay.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const w = rect.width;
      const h = rect.height;
      const pad = { l:54, r:18, t:22, b:40 };
      if (x < pad.l || x > w - pad.r) { clearHover(); return; }
      const schedules = buildSchedules(currentPrimaryMethod());
      const rows = schedules.total;
      if (!rows.length) return;
      const ratio = (x - pad.l) / Math.max(1, w - pad.l - pad.r);
      const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
      drawHover(rows, index, event.clientX - rect.left, event.clientY - rect.top);
    };
    chartOverlay.addEventListener('pointermove', move);
    chartOverlay.addEventListener('pointerdown', move);
    chartOverlay.addEventListener('pointerleave', clearHover);
    window.addEventListener('resize', clearHover);
  }
  function resizeOverlay() {
    if (!chartOverlay || !chartWrap) return null;
    const rect = chartWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    chartOverlay.width = Math.max(1, Math.round(rect.width * dpr));
    chartOverlay.height = Math.max(1, Math.round(rect.height * dpr));
    chartOverlay.style.width = `${rect.width}px`;
    chartOverlay.style.height = `${rect.height}px`;
    const ctx = chartOverlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w:rect.width, h:rect.height };
  }
  function clearHover() {
    if (!chartOverlay) return;
    const state = resizeOverlay();
    state?.ctx.clearRect(0, 0, state.w, state.h);
    if (chartTooltip) chartTooltip.hidden = true;
  }
  function drawHover(rows, index, pointerX, pointerY) {
    const state = resizeOverlay();
    if (!state) return;
    const { ctx, w, h } = state;
    ctx.clearRect(0, 0, w, h);
    const pad = { l:54, r:18, t:22, b:40 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    const row = rows[index];
    const initial = (rows[0]?.remaining || 0) + (rows[0]?.principal || 0);
    const max = Math.max(initial, rows.at(-1)?.cumulativePrincipal || 0, rows.at(-1)?.cumulativeInterest || 0, 1);
    const x = pad.l + cw * (index / Math.max(1, rows.length - 1));
    ctx.strokeStyle = 'rgba(30,64,175,.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    const points = [
      [row.remaining, '#2563eb'],
      [row.cumulativePrincipal, '#10b981'],
      [row.cumulativeInterest, '#f59e0b']
    ];
    points.forEach(([value, color]) => {
      const y = pad.t + ch * (1 - value / max);
      ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    const month = index + 1;
    const fullYears = Math.floor(month / 12);
    const remainMonths = month % 12;
    const periodLabel = remainMonths === 0 ? `第 ${fullYears} 年` : `第 ${fullYears} 年 ${remainMonths} 个月`;
    const date = addMonths($('startMonth')?.value, index);
    chartTooltip.innerHTML = `<strong>${periodLabel}</strong><small>${date} · 第 ${row.period} 期</small><div><i class="dot remaining"></i><span>剩余本金</span><b>${num2.format(row.remaining/10000)} 万</b></div><div><i class="dot principal"></i><span>累计本金</span><b>${num2.format(row.cumulativePrincipal/10000)} 万</b></div><div><i class="dot interest"></i><span>累计利息</span><b>${num2.format(row.cumulativeInterest/10000)} 万</b></div>`;
    chartTooltip.hidden = false;
    const tooltipWidth = 220;
    const left = pointerX + tooltipWidth + 24 > w ? Math.max(8, pointerX - tooltipWidth - 14) : pointerX + 14;
    const top = Math.max(8, Math.min(h - 148, pointerY - 62));
    chartTooltip.style.left = `${left}px`;
    chartTooltip.style.top = `${top}px`;
  }

  function buildPrintHeader() {
    const city = $('city')?.selectedOptions?.[0]?.textContent || '';
    const method = currentPrimaryMethod() === 'equalPrincipal' ? '等额本金' : '等额本息';
    const loanTypeLabel = { commercial:'商业贷款', provident:'公积金贷款', combined:'组合贷款' }[currentLoanType()] || '';
    $('printResultHeader').innerHTML = `<h1>房贷利率计算器 · 测算结果</h1><p>${city} · ${loanTypeLabel} · ${method} · 房屋总价 ${$('housePrice')?.value || 0} 万 · 贷款 ${$('loanAmount')?.value || 0} 万</p><small>生成时间：${new Date().toLocaleString('zh-CN')}</small>`;
  }
  function exportResultsPdf() {
    buildPrintHeader();
    document.body.classList.add('printing-results');
    setTimeout(() => window.print(), 60);
  }
  function installFloatingTools() {
    $('floatTop')?.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));
    $('floatSave')?.addEventListener('click', () => $('savePlan')?.click());
    $('floatPdf')?.addEventListener('click', exportResultsPdf);
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-results'));
  }

  installDetailRefresh();
  ensureChartOverlay();
  installFloatingTools();
})();
