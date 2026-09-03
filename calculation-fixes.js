(() => {
  const $ = id => document.getElementById(id);
  const yuan0 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
  const wan2 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let applying = false;
  let hoverInstalled = false;

  function yuanFromWan(v) { return Math.max(0, Number(v || 0)) * 10000; }
  function amortizedPayment(balance, monthlyRate, months) {
    if (months <= 0) return balance;
    if (monthlyRate === 0) return balance / months;
    const p = Math.pow(1 + monthlyRate, months);
    return balance * monthlyRate * p / (p - 1);
  }

  // Corrected prepayment semantics:
  // - reducePayment: keep remaining term, recalculate payment/principal slice.
  // - shorten: keep the post-prepayment payment burden roughly unchanged.
  //   For equal-principal loans, preserving only the old principal slice can make
  //   the monthly payment fall too much after a large prepayment and can invert
  //   the expected interest ordering versus equal-payment. We therefore lift the
  //   principal slice by the interest saved on the prepaid principal so that the
  //   next scheduled payment remains close to the no-prepayment trajectory.
  function correctedGenerateSchedule({ principal, annualRate, months, method, prepayments = [] }) {
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
      const events = ppMap.get(i) || [];

      for (const event of events) {
        const balanceBeforeExtra = balance;
        const extra = Math.min(yuanFromWan(event.amountWan), balance);
        balance -= extra;
        extraPrincipal += extra;
        const remaining = Math.max(1, months - i);

        if (event.strategy === 'reducePayment' && balance > 0) {
          if (method === 'equalPayment') payment = amortizedPayment(balance, r, remaining);
          else principalPart = balance / remaining;
        } else if (event.strategy === 'shorten' && balance > 0 && method === 'equalPrincipal') {
          const targetNextPayment = principalPart + balanceBeforeExtra * r;
          principalPart = Math.max(0, targetNextPayment - balance * r);
        }
      }

      const principalPaid = scheduledPrincipal + extraPrincipal;
      const totalPayment = scheduledPayment + extraPrincipal;
      cumulativePrincipal += principalPaid;
      cumulativeInterest += interest;
      rows.push({
        period: i,
        payment: totalPayment,
        scheduledPayment,
        principal: principalPaid,
        interest,
        extraPrincipal,
        cumulativePrincipal,
        cumulativeInterest,
        remaining: Math.max(0, balance)
      });

      if (i >= months && balance > 0.005) {
        const finalInterest = balance * r;
        cumulativeInterest += finalInterest;
        cumulativePrincipal += balance;
        rows.push({
          period: i + 1,
          payment: balance + finalInterest,
          scheduledPayment: balance + finalInterest,
          principal: balance,
          interest: finalInterest,
          extraPrincipal: 0,
          cumulativePrincipal,
          cumulativeInterest,
          remaining: 0
        });
        balance = 0;
      }
    }

    if (rows.length && Math.abs(rows.at(-1).remaining) < 0.01) rows.at(-1).remaining = 0;
    return rows;
  }

  try {
    // app.js is a classic script, so updating the global binding makes calculate()
    // use the corrected schedule builder on all subsequent calculations.
    generateSchedule = correctedGenerateSchedule;
    window.generateSchedule = correctedGenerateSchedule;
  } catch (_) {
    window.generateSchedule = correctedGenerateSchedule;
  }
  window.__mortgageGenerateScheduleV2 = correctedGenerateSchedule;

  function formatDiff(value) {
    const amount = Math.abs(Number(value || 0));
    if (amount < 10000) return yuan0.format(Math.round(amount));
    return `${wan2.format(amount / 10000)} 万`;
  }

  function summarizeRows(rows) {
    const list = rows || [];
    return {
      interest: list.reduce((s, r) => s + Number(r.interest || 0), 0),
      payment: list.reduce((s, r) => s + Number(r.payment || 0), 0),
      firstPayment: Number(list[0]?.payment || 0),
      lastPayment: Number(list.at(-1)?.payment || 0)
    };
  }

  function currentResult(method) {
    try {
      if (typeof results === 'undefined' || !results) return null;
      return results[method] || null;
    } catch (_) {
      return null;
    }
  }

  function updateComparisonNotes() {
    const epSet = currentResult('equalPayment');
    const eaSet = currentResult('equalPrincipal');
    if (!epSet || !eaSet) return;
    const ep = summarizeRows(epSet.total);
    const ea = summarizeRows(eaSet.total);
    const firstDiff = ea.firstPayment - ep.firstPayment;
    const interestDiff = ep.interest - ea.interest;

    const epNote = document.querySelector('.compare-card[data-method="equalPayment"] .compare-note');
    const eaNote = document.querySelector('.compare-card[data-method="equalPrincipal"] .compare-note');
    if (!epNote || !eaNote) return;

    let epText;
    let eaText;
    if (firstDiff >= 0) {
      epText = `首月较等额本金少还 ${formatDiff(firstDiff)}`;
      eaText = `首月较等额本息多还 ${formatDiff(firstDiff)}`;
    } else {
      epText = `首月较等额本金多还 ${formatDiff(firstDiff)}`;
      eaText = `首月较等额本息少还 ${formatDiff(firstDiff)}`;
    }

    if (interestDiff >= 0) {
      epText += `，但全周期利息多 ${formatDiff(interestDiff)}`;
      eaText += `，全周期可少付利息 ${formatDiff(interestDiff)}`;
    } else {
      epText += `，全周期利息少 ${formatDiff(interestDiff)}`;
      eaText += `，全周期利息多 ${formatDiff(interestDiff)}`;
    }

    if (epNote.textContent !== epText) epNote.textContent = epText;
    if (eaNote.textContent !== eaText) eaNote.textContent = eaText;
  }

  function addMonths(ym, offset) {
    const parts = String(ym || '').split('-').map(Number);
    const y = parts[0] || new Date().getFullYear();
    const m = parts[1] || (new Date().getMonth() + 1);
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function money(value, decimals = 0) {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency', currency: 'CNY',
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    }).format(Number(value || 0));
  }

  function annualize(schedule) {
    const out = [];
    const rows = schedule || [];
    for (let i = 0; i < rows.length; i += 12) {
      const chunk = rows.slice(i, i + 12);
      const start = i === 0 ? ((rows[0]?.remaining || 0) + (rows[0]?.principal || 0)) : (rows[i - 1]?.remaining || 0);
      out.push({
        year: Math.floor(i / 12) + 1,
        start,
        principal: chunk.reduce((s, r) => s + Number(r.principal || 0), 0),
        interest: chunk.reduce((s, r) => s + Number(r.interest || 0), 0),
        payment: chunk.reduce((s, r) => s + Number(r.payment || 0), 0),
        end: chunk.at(-1)?.remaining || 0
      });
    }
    return out;
  }

  function annualAt(rows, i) { return rows[i] || { start:0, principal:0, interest:0, payment:0, end:0 }; }
  function monthlyAt(rows, i) { return rows[i] || { payment:0, principal:0, interest:0, extraPrincipal:0, cumulativeInterest:0, remaining:0 }; }

  function hasEffectivePrepayment() {
    return [...document.querySelectorAll('.prepayment-row')].some(row => {
      const month = Number(row.querySelector('[data-field="month"]')?.value || 0);
      const amount = Number(row.querySelector('[data-field="amount"]')?.value || 0);
      return month > 0 && amount > 0;
    });
  }

  function renderCorrectedTables() {
    const method = document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
    const set = currentResult(method);
    const annualBody = $('annualBody');
    const monthlyBody = $('monthlyBody');
    if (!set || !annualBody || !monthlyBody) return;

    const hasCommercial = (set.commercial || []).length > 0;
    const hasProvident = (set.provident || []).length > 0;
    const annualTotal = annualize(set.total);
    const annualCommercial = annualize(set.commercial);
    const annualProvident = annualize(set.provident);

    const annualThead = annualBody.closest('table')?.querySelector('thead');
    if (annualThead) {
      annualThead.innerHTML = '<tr class="group-head"><th rowspan="2">年度</th><th colspan="4" class="total-group">合计</th>' +
        (hasCommercial ? '<th colspan="4" class="commercial-group">商业贷款</th>' : '') +
        (hasProvident ? '<th colspan="4" class="provident-group">公积金贷款</th>' : '') + '</tr>' +
        '<tr><th>年初本金</th><th>年度还款</th><th>偿还本金</th><th>支付利息</th>' +
        (hasCommercial ? '<th>还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') +
        (hasProvident ? '<th>还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') + '</tr>';
    }
    annualBody.innerHTML = annualTotal.map((t, i) => {
      const c = annualAt(annualCommercial, i), p = annualAt(annualProvident, i);
      return `<tr><td>第 ${t.year} 年</td><td>${money(t.start)}</td><td>${money(t.payment)}</td><td>${money(t.principal)}</td><td>${money(t.interest)}</td>` +
        (hasCommercial ? `<td>${money(c.payment)}</td><td>${money(c.principal)}</td><td>${money(c.interest)}</td><td>${money(c.end)}</td>` : '') +
        (hasProvident ? `<td>${money(p.payment)}</td><td>${money(p.principal)}</td><td>${money(p.interest)}</td><td>${money(p.end)}</td>` : '') + '</tr>';
    }).join('') || '<tr><td class="empty-cell">暂无数据</td></tr>';

    const showExtra = hasEffectivePrepayment();
    const monthlyThead = monthlyBody.closest('table')?.querySelector('thead');
    if (monthlyThead) {
      monthlyThead.innerHTML = '<tr class="group-head"><th rowspan="2">期数</th><th rowspan="2">日期</th><th colspan="' + (showExtra ? 6 : 5) + '" class="total-group">合计</th>' +
        (hasCommercial ? '<th colspan="4" class="commercial-group">商业贷款</th>' : '') +
        (hasProvident ? '<th colspan="4" class="provident-group">公积金贷款</th>' : '') + '</tr>' +
        '<tr><th>月还款</th><th>本金</th><th>利息</th>' + (showExtra ? '<th>提前还款</th>' : '') + '<th>累计利息</th><th>剩余本金</th>' +
        (hasCommercial ? '<th>月还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') +
        (hasProvident ? '<th>月还款</th><th>本金</th><th>利息</th><th>剩余本金</th>' : '') + '</tr>';
    }
    const startMonth = $('startMonth')?.value || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    monthlyBody.innerHTML = (set.total || []).map((t, i) => {
      const c = monthlyAt(set.commercial, i), p = monthlyAt(set.provident, i);
      return `<tr><td>第 ${t.period} 期</td><td>${addMonths(startMonth, i)}</td><td>${money(t.payment,2)}</td><td>${money(t.principal,2)}</td><td>${money(t.interest,2)}</td>` +
        (showExtra ? `<td>${t.extraPrincipal ? money(t.extraPrincipal,2) : '—'}</td>` : '') +
        `<td>${money(t.cumulativeInterest,2)}</td><td>${money(t.remaining,2)}</td>` +
        (hasCommercial ? `<td>${money(c.payment,2)}</td><td>${money(c.principal,2)}</td><td>${money(c.interest,2)}</td><td>${money(c.remaining,2)}</td>` : '') +
        (hasProvident ? `<td>${money(p.payment,2)}</td><td>${money(p.principal,2)}</td><td>${money(p.interest,2)}</td><td>${money(p.remaining,2)}</td>` : '') + '</tr>';
    }).join('') || '<tr><td class="empty-cell">暂无数据</td></tr>';
  }

  function drawCorrectedHover(event) {
    const overlay = document.querySelector('.trend-overlay');
    const tooltip = document.querySelector('.trend-tooltip');
    if (!overlay || !tooltip) return;
    const method = document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
    const rows = currentResult(method)?.total || [];
    if (!rows.length) return;

    const rect = overlay.getBoundingClientRect();
    const xPointer = event.clientX - rect.left;
    const yPointer = event.clientY - rect.top;
    const w = rect.width, h = rect.height;
    const pad = { l:54, r:18, t:22, b:40 };
    if (xPointer < pad.l || xPointer > w - pad.r) {
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0,0,overlay.width,overlay.height);
      tooltip.hidden = true;
      return;
    }

    const ratio = (xPointer - pad.l) / Math.max(1, w - pad.l - pad.r);
    const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
    const row = rows[index];
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.max(1, Math.round(w*dpr));
    overlay.height = Math.max(1, Math.round(h*dpr));
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
    const ctx = overlay.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const cw = w-pad.l-pad.r, ch=h-pad.t-pad.b;
    const initial = (rows[0]?.remaining || 0) + (rows[0]?.principal || 0);
    const max = Math.max(initial, rows.at(-1)?.cumulativePrincipal || 0, rows.at(-1)?.cumulativeInterest || 0, 1);
    const x = pad.l + cw*(index/Math.max(1,rows.length-1));
    ctx.strokeStyle='rgba(30,64,175,.55)'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x,pad.t); ctx.lineTo(x,h-pad.b); ctx.stroke(); ctx.setLineDash([]);
    [[row.remaining,'#2563eb'],[row.cumulativePrincipal,'#10b981'],[row.cumulativeInterest,'#f59e0b']].forEach(([value,color])=>{
      const y=pad.t+ch*(1-value/max); ctx.beginPath(); ctx.fillStyle='#fff'; ctx.strokeStyle=color; ctx.lineWidth=3; ctx.arc(x,y,5,0,Math.PI*2); ctx.fill(); ctx.stroke();
    });
    const month=index+1, fullYears=Math.floor(month/12), remainMonths=month%12;
    const periodLabel=remainMonths===0?`第 ${fullYears} 年`:`第 ${fullYears} 年 ${remainMonths} 个月`;
    const date=addMonths($('startMonth')?.value,index);
    tooltip.innerHTML=`<strong>${periodLabel}</strong><small>${date} · 第 ${row.period} 期</small><div><i class="dot remaining"></i><span>剩余本金</span><b>${wan2.format(row.remaining/10000)} 万</b></div><div><i class="dot principal"></i><span>累计本金</span><b>${wan2.format(row.cumulativePrincipal/10000)} 万</b></div><div><i class="dot interest"></i><span>累计利息</span><b>${wan2.format(row.cumulativeInterest/10000)} 万</b></div>`;
    tooltip.hidden=false;
    const tooltipWidth=220;
    tooltip.style.left=`${xPointer+tooltipWidth+24>w?Math.max(8,xPointer-tooltipWidth-14):xPointer+14}px`;
    tooltip.style.top=`${Math.max(8,Math.min(h-148,yPointer-62))}px`;
  }

  function installCorrectedHover() {
    if (hoverInstalled) return true;
    const overlay = document.querySelector('.trend-overlay');
    if (!overlay) return false;
    const move = event => {
      event.stopImmediatePropagation();
      drawCorrectedHover(event);
    };
    overlay.addEventListener('pointermove', move, true);
    overlay.addEventListener('pointerdown', move, true);
    hoverInstalled = true;
    return true;
  }

  function installCompactProvidentSpacing() {
    const style = document.createElement('style');
    style.id = 'calculation-fixes-style';
    style.textContent = '.provident-rate-value{justify-content:flex-start!important;gap:18px!important}.provident-rate-value b{margin-left:0!important}';
    document.head.appendChild(style);
  }

  function refreshCorrections() {
    if (applying) return;
    applying = true;
    try {
      updateComparisonNotes();
      renderCorrectedTables();
      installCorrectedHover();
    } finally {
      applying = false;
    }
  }

  function queueRefresh(delay = 35) { setTimeout(refreshCorrections, delay); }

  function install() {
    installCompactProvidentSpacing();
    const comparison = $('comparison');
    if (comparison) new MutationObserver(() => queueRefresh(0)).observe(comparison, { childList:true, subtree:true });
    document.querySelector('.form-card')?.addEventListener('input', () => queueRefresh(), true);
    document.querySelector('.form-card')?.addEventListener('change', () => queueRefresh(), true);
    $('detailMethodTabs')?.addEventListener('click', () => queueRefresh(), true);
    $('detailViewTabs')?.addEventListener('click', () => queueRefresh(), true);
    $('loanTypeTabs')?.addEventListener('click', () => queueRefresh(), true);

    let attempts = 0;
    const timer = setInterval(() => {
      try {
        if (typeof rateData !== 'undefined' && rateData && typeof calculate === 'function') {
          calculate();
          refreshCorrections();
          clearInterval(timer);
          return;
        }
      } catch (_) {}
      installCorrectedHover();
      if (++attempts >= 60) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
