const $ = (id) => document.getElementById(id);
const money0 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const METHOD_LABEL = { equalPayment: '等额本息', equalPrincipal: '等额本金' };
const STORAGE_KEY = 'mortgage-calculator-state-v2';
const LEGACY_STORAGE_KEY = 'mortgage-calculator-state-v1';
const PLANS_KEY = 'mortgage-calculator-plans-v1';

let rateData;
let loanType = 'combined';
let primaryMethod = 'equalPayment';
let detailMethod = 'equalPayment';
let detailView = 'annual';
let detailScope = 'total';
let lastLoanEdit = 'ratio';
let results = null;

function yuanFromWan(v) { return Math.max(0, Number(v || 0)) * 10000; }
function wan(v) { return `${num2.format((Number(v) || 0) / 10000)} 万`; }
function pct(v) { return `${Number(v || 0).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function addMonths(ym, offset) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getStartMonth() {
  return $('startMonth').value || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
}
function amortizedPayment(balance, monthlyRate, months) {
  if (months <= 0) return balance;
  if (monthlyRate === 0) return balance / months;
  const p = Math.pow(1 + monthlyRate, months);
  return balance * monthlyRate * p / (p - 1);
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
    const events = ppMap.get(i) || [];

    for (const event of events) {
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

function mergeSchedules(a, b) {
  const n = Math.max(a.length, b.length);
  const rows = [];
  let cumulativePrincipal = 0;
  let cumulativeInterest = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] || { payment:0, principal:0, interest:0, remaining:0, extraPrincipal:0 };
    const y = b[i] || { payment:0, principal:0, interest:0, remaining:0, extraPrincipal:0 };
    const principal = x.principal + y.principal;
    const interest = x.interest + y.interest;
    cumulativePrincipal += principal;
    cumulativeInterest += interest;
    rows.push({
      period: i + 1,
      payment: x.payment + y.payment,
      principal,
      interest,
      extraPrincipal: x.extraPrincipal + y.extraPrincipal,
      cumulativePrincipal,
      cumulativeInterest,
      remaining: x.remaining + y.remaining
    });
  }
  return rows;
}

function summarize(schedule) {
  const principal = schedule.reduce((s, r) => s + r.principal, 0);
  const interest = schedule.reduce((s, r) => s + r.interest, 0);
  const payment = schedule.reduce((s, r) => s + r.payment, 0);
  return {
    principal,
    interest,
    payment,
    firstPayment: schedule[0]?.payment || 0,
    lastPayment: schedule.at(-1)?.payment || 0,
    months: schedule.length
  };
}

function currentCity() { return rateData?.cities.find(c => c.id === $('city').value) || rateData?.cities[0]; }
function benchmarkValue(benchmark) { return benchmark === 'LPR1Y' ? rateData.lpr.oneYear : rateData.lpr.fiveYearPlus; }
function getCommercialTerm() { return $('separateTerms').checked && loanType === 'combined' ? Number($('commercialTermYears').value) : Number($('termYears').value); }
function getProvidentTerm() { return $('separateTerms').checked && loanType === 'combined' ? Number($('providentTermYears').value) : Number($('termYears').value); }

function syncLoanFromRatio() {
  const house = Math.max(0, Number($('housePrice').value || 0));
  const ratio = clamp(Number($('loanRatio').value || 0), 0, 100);
  $('loanRatio').value = Number(ratio.toFixed(2));
  $('loanAmount').value = Number((house * ratio / 100).toFixed(2));
}

function syncRatioFromLoan() {
  const house = Math.max(0, Number($('housePrice').value || 0));
  const amount = clamp(Number($('loanAmount').value || 0), 0, house || 0);
  $('loanAmount').value = Number(amount.toFixed(2));
  $('loanRatio').value = house > 0 ? Number((amount / house * 100).toFixed(2)) : 0;
}

function applyCityRate() {
  if (!rateData) return;
  const c = currentCity();
  if (!c?.commercial) return;
  const base = benchmarkValue(c.commercial.benchmark);
  $('lprValue').textContent = pct(base);
  $('bpSign').value = c.commercial.spreadBP < 0 ? '-' : '+';
  $('bpValue').value = Math.abs(c.commercial.spreadBP);
  $('commercialRate').value = c.commercial.rate;
  $('calculatedCommercialRate').textContent = pct(c.commercial.rate);
  $('commercialSource').textContent = `${c.name} · ${c.commercial.source}`;
  $('directCommercialRate').checked = false;
  syncBpEditor();
  applyProvidentRate();
  calculate();
}

function applyProvidentRate() {
  if (!rateData) return;
  const years = getProvidentTerm();
  const home = $('homeType').value === 'first' ? rateData.providentFundDefault.firstHome : rateData.providentFundDefault.secondHome;
  const rate = years <= 5 ? home.upTo5Years : home.over5Years;
  $('providentRate').value = rate;
  $('providentRateDisplay').textContent = pct(rate);
  $('providentHint').textContent = `${$('homeType').value === 'first' ? '首套' : '二套'} · ${years <= 5 ? '5年及以下' : '5年以上'}参考利率，可手动修改`;
}

function refreshCitySourceOnly() {
  const c = currentCity();
  if (!c?.commercial) return;
  $('commercialSource').textContent = `${c.name} · ${c.commercial.source}`;
  $('lprValue').textContent = pct(benchmarkValue(c.commercial.benchmark));
}

function syncBpEditor() {
  const direct = $('directCommercialRate').checked;
  $('bpRateEditor').classList.toggle('hidden', direct);
  $('commercialRate').disabled = !direct;
  if (!direct && rateData) {
    const c = currentCity();
    const base = benchmarkValue(c?.commercial?.benchmark || 'LPR5Y');
    const bp = Number($('bpValue').value || 0) / 100;
    const rate = base + ($('bpSign').value === '-' ? -bp : bp);
    $('commercialRate').value = rate.toFixed(3);
    $('calculatedCommercialRate').textContent = pct(rate);
  }
}

function readPrepayments() {
  return [...document.querySelectorAll('.prepayment-row')].map(row => ({
    month: Number(row.querySelector('[data-field="month"]').value || 0),
    amountWan: Number(row.querySelector('[data-field="amount"]').value || 0),
    target: row.querySelector('[data-field="target"]').value,
    strategy: row.querySelector('[data-field="strategy"]').value
  })).filter(p => p.month > 0 && p.amountWan > 0);
}

function addPrepayment(data = {}) {
  const row = document.createElement('div');
  row.className = 'prepayment-row';
  row.innerHTML = `
    <label>第几期<input data-field="month" type="number" min="1" value="${Number(data.month || 60)}"></label>
    <label>金额（万元）<input data-field="amount" type="number" min="0" step="1" value="${Number(data.amountWan || 50)}"></label>
    <label>偿还目标<select data-field="target"><option value="commercial">商业贷款</option><option value="provident">公积金贷款</option></select></label>
    <label>处理策略<select data-field="strategy"><option value="shorten">月供基本不变，缩短期限</option><option value="reducePayment">期限不变，减少月供</option></select></label>
    <button class="ghost" type="button">删除</button>`;
  row.querySelector('[data-field="target"]').value = data.target || (loanType === 'provident' ? 'provident' : 'commercial');
  row.querySelector('[data-field="strategy"]').value = data.strategy || 'shorten';
  row.querySelector('button').addEventListener('click', () => { row.remove(); calculate(); });
  row.querySelectorAll('input,select').forEach(el => el.addEventListener('input', calculate));
  $('prepaymentList').appendChild(row);
}

function calculate() {
  if (!rateData) return;

  const houseWan = Math.max(0, Number($('housePrice').value || 0));
  const loanWan = clamp(Number($('loanAmount').value || 0), 0, houseWan);
  const ratio = houseWan > 0 ? loanWan / houseWan * 100 : 0;
  const housePrice = yuanFromWan(houseWan);
  const totalLoan = yuanFromWan(loanWan);
  const down = Math.max(0, housePrice - totalLoan);

  if (Math.abs(Number($('loanRatio').value || 0) - ratio) > 0.01) $('loanRatio').value = Number(ratio.toFixed(2));
  if (Math.abs(Number($('loanAmount').value || 0) - loanWan) > 0.01) $('loanAmount').value = Number(loanWan.toFixed(2));

  let provident = 0;
  let commercial = 0;
  if (loanType === 'commercial') commercial = totalLoan;
  else if (loanType === 'provident') provident = totalLoan;
  else {
    const providentWan = Math.min(Math.max(0, Number($('providentAmount').value || 0)), loanWan);
    provident = yuanFromWan(providentWan);
    commercial = Math.max(0, totalLoan - provident);
  }

  $('downPaymentAmount').textContent = wan(down);
  $('loanTotal').textContent = wan(totalLoan);
  $('loanRatioSummary').textContent = `${ratio.toFixed(2).replace(/\.00$/, '')}%`;
  $('commercialAmount').value = `${num2.format(commercial / 10000)} 万`;
  $('providentRateDisplay').textContent = pct(Number($('providentRate').value || 0));

  const commercialRate = Number($('commercialRate').value || 0);
  const providentRate = Number($('providentRate').value || 0);
  const commercialMonths = getCommercialTerm() * 12;
  const providentMonths = getProvidentTerm() * 12;
  const prepayments = readPrepayments();
  const commercialPP = prepayments.filter(p => p.target === 'commercial');
  const providentPP = prepayments.filter(p => p.target === 'provident');

  const build = (method) => {
    const commercialSchedule = generateSchedule({ principal: commercial, annualRate: commercialRate, months: commercialMonths, method, prepayments: commercialPP });
    const providentSchedule = generateSchedule({ principal: provident, annualRate: providentRate, months: providentMonths, method, prepayments: providentPP });
    return {
      commercial: commercialSchedule,
      provident: providentSchedule,
      total: mergeSchedules(commercialSchedule, providentSchedule)
    };
  };

  results = { equalPayment: build('equalPayment'), equalPrincipal: build('equalPrincipal') };
  renderSelectedSummary();
  renderComparison();
  renderDetails();
  renderYearCards();
  drawChart();
  saveState();
}

function summaryCard(title, schedule, tone = '') {
  const s = summarize(schedule);
  return `<article class="summary-card ${tone}">
    <div class="summary-card-head"><h3>${title}</h3><span>${s.months} 期</span></div>
    <div class="summary-main"><small>${primaryMethod === 'equalPayment' ? '月还款' : '首月还款'}</small><strong>${money0.format(s.firstPayment)}</strong></div>
    <div class="summary-metrics">
      <div><span>贷款本金</span><b>${wan(s.principal)}</b></div>
      <div><span>总利息</span><b>${wan(s.interest)}</b></div>
      <div><span>总还款</span><b>${wan(s.payment)}</b></div>
      <div><span>末月还款</span><b>${money0.format(s.lastPayment)}</b></div>
    </div>
  </article>`;
}

function renderSelectedSummary() {
  if (!results) return;
  const set = results[primaryMethod];
  $('selectedMethodBadge').textContent = METHOD_LABEL[primaryMethod];
  $('chartMethodBadge').textContent = METHOD_LABEL[primaryMethod];
  document.querySelectorAll('#repaymentMethodTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === primaryMethod));

  if (loanType === 'combined') {
    $('selectedSummary').innerHTML =
      summaryCard('组合贷合计', set.total, 'total-summary') +
      summaryCard('商业贷款', set.commercial, 'commercial-summary') +
      summaryCard('公积金贷款', set.provident, 'provident-summary');
  } else if (loanType === 'commercial') {
    $('selectedSummary').innerHTML = summaryCard('商业贷款', set.commercial, 'commercial-summary single-summary');
  } else {
    $('selectedSummary').innerHTML = summaryCard('公积金贷款', set.provident, 'provident-summary single-summary');
  }
}

function renderComparison() {
  const ep = summarize(results.equalPayment.total);
  const ea = summarize(results.equalPrincipal.total);
  const firstDiff = ea.firstPayment - ep.firstPayment;
  const interestDiff = ep.interest - ea.interest;
  const epCommercial = summarize(results.equalPayment.commercial);
  const epProvident = summarize(results.equalPayment.provident);
  const eaCommercial = summarize(results.equalPrincipal.commercial);
  const eaProvident = summarize(results.equalPrincipal.provident);

  const splitLine = (c, p) => loanType === 'combined'
    ? `<div class="split-interest"><span>商贷利息 ${wan(c.interest)}</span><span>公积金利息 ${wan(p.interest)}</span></div>`
    : '';

  const make = (method, title, s, note, noteClass, c, p) => `<article class="compare-card ${method === primaryMethod ? 'active-choice' : ''}" data-method="${method}">
      <div class="compare-title"><h3>${title}</h3>${method === primaryMethod ? '<span>当前选择</span>' : ''}</div>
      <div class="metric"><span>首月还款</span><b>${money0.format(s.firstPayment)}</b></div>
      <div class="metric"><span>末月还款</span><b>${money0.format(s.lastPayment)}</b></div>
      <div class="metric"><span>总利息</span><b>${wan(s.interest)}</b></div>
      <div class="metric"><span>总还款额</span><b>${wan(s.payment)}</b></div>
      ${splitLine(c, p)}
      <p class="compare-note ${noteClass}">${note}</p>
    </article>`;

  const epNote = firstDiff >= 0
    ? `首月较等额本金少还 ${money0.format(firstDiff)}，但全周期利息多 ${wan(Math.max(0, interestDiff))}`
    : `首月还款更高 ${money0.format(Math.abs(firstDiff))}；请结合提前还款设置比较`;
  const eaNote = firstDiff >= 0
    ? `首月较等额本息多还 ${money0.format(firstDiff)}，全周期可少付利息 ${wan(Math.max(0, interestDiff))}`
    : `首月还款更低 ${money0.format(Math.abs(firstDiff))}；请结合提前还款设置比较`;

  $('comparison').innerHTML =
    make('equalPayment', '等额本息', ep, epNote, 'warn', epCommercial, epProvident) +
    make('equalPrincipal', '等额本金', ea, eaNote, 'good', eaCommercial, eaProvident);

  document.querySelectorAll('.compare-card[data-method]').forEach(card => {
    card.addEventListener('click', () => {
      primaryMethod = card.dataset.method;
      renderSelectedSummary();
      renderComparison();
      renderYearCards();
      drawChart();
      saveState();
    });
  });
}

function annualRows(schedule) {
  const out = [];
  for (let i = 0; i < schedule.length; i += 12) {
    const rows = schedule.slice(i, i + 12);
    const start = i === 0 ? ((schedule[0]?.remaining || 0) + (schedule[0]?.principal || 0)) : schedule[i - 1].remaining;
    const principal = rows.reduce((s, r) => s + r.principal, 0);
    const interest = rows.reduce((s, r) => s + r.interest, 0);
    const payment = rows.reduce((s, r) => s + r.payment, 0);
    out.push({ year: Math.floor(i / 12) + 1, start, principal, interest, payment, end: rows.at(-1)?.remaining || 0 });
  }
  return out;
}

function effectiveDetailScope() {
  if (loanType === 'commercial') return 'commercial';
  if (loanType === 'provident') return 'provident';
  return detailScope;
}

function detailSchedule() {
  if (!results) return [];
  return results[detailMethod][effectiveDetailScope()] || [];
}

function renderAnnual() {
  const rows = annualRows(detailSchedule());
  $('annualBody').innerHTML = rows.length
    ? rows.map(r => `<tr><td>第 ${r.year} 年</td><td>${money0.format(r.start)}</td><td>${money0.format(r.principal)}</td><td>${money0.format(r.interest)}</td><td>${money0.format(r.payment)}</td><td>${money0.format(r.end)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-cell">暂无数据</td></tr>';
}

function renderMonthly() {
  const schedule = detailSchedule();
  const start = getStartMonth();
  $('monthlyBody').innerHTML = schedule.length
    ? schedule.map((r, i) => `<tr><td>第 ${r.period} 期</td><td>${addMonths(start, i)}</td><td>${money2.format(r.payment)}</td><td>${money2.format(r.principal)}</td><td>${money2.format(r.interest)}</td><td>${r.extraPrincipal ? money2.format(r.extraPrincipal) : '—'}</td><td>${money2.format(r.cumulativePrincipal)}</td><td>${money2.format(r.cumulativeInterest)}</td><td>${money2.format(r.remaining)}</td></tr>`).join('')
    : '<tr><td colspan="9" class="empty-cell">暂无数据</td></tr>';
}

function renderDetails() {
  if (!results) return;
  $('annualPanel').classList.toggle('active', detailView === 'annual');
  $('monthlyPanel').classList.toggle('active', detailView === 'monthly');
  document.querySelectorAll('#detailViewTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === detailView));
  document.querySelectorAll('#detailMethodTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === detailMethod));
  document.querySelectorAll('#detailScopeTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === detailScope));
  renderAnnual();
  renderMonthly();
}

function renderYearCards() {
  if (!results) return;
  const total = results[primaryMethod].total;
  const maxYears = Math.ceil(total.length / 12);
  const custom = clamp(Number($('customYear').value || 8), 1, Math.max(1, maxYears));
  const years = [...new Set([5, 10, 15, 20, custom])].filter(y => y <= maxYears).sort((a, b) => a - b);
  const commercial = results[primaryMethod].commercial;
  const provident = results[primaryMethod].provident;

  $('yearCards').innerHTML = years.map(y => {
    const idx = Math.min(y * 12 - 1, total.length - 1);
    const row = total[idx];
    if (!row) return '';
    const cRemain = commercial[idx]?.remaining || 0;
    const pRemain = provident[idx]?.remaining || 0;
    const split = loanType === 'combined'
      ? `<div class="year-split"><span>商贷剩余 ${wan(cRemain)}</span><span>公积金剩余 ${wan(pRemain)}</span></div>`
      : '';
    return `<article class="year-card"><h3>第 ${y} 年</h3>
      <p><span>已还本金</span><b>${wan(row.cumulativePrincipal)}</b></p>
      <p><span>已付利息</span><b>${wan(row.cumulativeInterest)}</b></p>
      <p><span>累计还款</span><b>${wan(row.cumulativePrincipal + row.cumulativeInterest)}</b></p>
      <p><span>剩余本金</span><b>${wan(row.remaining)}</b></p>${split}</article>`;
  }).join('');
}

function drawChart() {
  const canvas = $('trendChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 900;
  const h = 320;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rows = results?.[primaryMethod]?.total || [];
  if (!rows.length) return;

  const initial = (rows[0].remaining || 0) + (rows[0].principal || 0);
  const max = Math.max(initial, rows.at(-1).cumulativePrincipal, rows.at(-1).cumulativeInterest, 1);
  const pad = { l: 54, r: 18, t: 22, b: 40 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxYears = Math.ceil(rows.length / 12);

  ctx.font = '11px system-ui';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#718096';
  ctx.strokeStyle = '#dbe7f5';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch * i / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(max * (4 - i) / 4 / 10000)}万`, 4, y);
  }

  const yearX = (year) => {
    const idx = Math.min(year * 12, rows.length - 1);
    return pad.l + cw * (idx / Math.max(1, rows.length - 1));
  };
  const labelEvery = maxYears <= 12 ? 1 : maxYears <= 20 ? 2 : 5;
  for (let year = 0; year <= maxYears; year++) {
    const x = yearX(year);
    ctx.strokeStyle = year % labelEvery === 0 ? '#cfe0f3' : '#e8f0fa';
    ctx.beginPath();
    ctx.moveTo(x, h - pad.b);
    ctx.lineTo(x, h - pad.b + 5);
    ctx.stroke();
    if (year % labelEvery === 0) {
      ctx.fillStyle = '#718096';
      ctx.textAlign = year === 0 ? 'left' : year === maxYears ? 'right' : 'center';
      ctx.fillText(`${year}年`, x, h - 17);
    }
  }
  ctx.textAlign = 'left';

  const series = [
    { get: r => r.remaining, stroke: '#2563eb', width: 3.4 },
    { get: r => r.cumulativePrincipal, stroke: '#10b981', width: 2.6 },
    { get: r => r.cumulativeInterest, stroke: '#f59e0b', width: 2.1 }
  ];
  series.forEach(s => {
    ctx.beginPath();
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    rows.forEach((r, i) => {
      const x = pad.l + cw * (i / Math.max(1, rows.length - 1));
      const y = pad.t + ch * (1 - s.get(r) / max);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function updateVisibility() {
  $('providentAmountWrap').classList.toggle('hidden', loanType !== 'combined');
  $('commercialAmountWrap').classList.toggle('hidden', loanType === 'provident');
  $('commercialRatePanel').classList.toggle('hidden', loanType === 'provident');
  $('providentRatePanel').classList.toggle('hidden', loanType === 'commercial');
  if (loanType !== 'combined') $('separateTerms').checked = false;
  $('separateTermsPanel').classList.toggle('hidden', !$('separateTerms').checked || loanType !== 'combined');
  $('detailScopeWrap').classList.toggle('hidden', loanType !== 'combined');
  if (loanType === 'commercial') detailScope = 'commercial';
  else if (loanType === 'provident') detailScope = 'provident';
  else if (!['total', 'commercial', 'provident'].includes(detailScope)) detailScope = 'total';
}

function setLoanType(value) {
  loanType = value;
  document.querySelectorAll('#loanTypeTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === loanType));
  updateVisibility();
}

function setPrimaryMethod(value) {
  primaryMethod = value;
  document.querySelectorAll('#repaymentMethodTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === primaryMethod));
  if (results) {
    renderSelectedSummary();
    renderComparison();
    renderYearCards();
    drawChart();
    saveState();
  }
}

function collectState() {
  return {
    city: $('city').value,
    homeType: $('homeType').value,
    housePrice: $('housePrice').value,
    loanRatio: $('loanRatio').value,
    loanAmount: $('loanAmount').value,
    lastLoanEdit,
    loanType,
    primaryMethod,
    detailMethod,
    detailView,
    detailScope,
    providentAmount: $('providentAmount').value,
    termYears: $('termYears').value,
    startMonth: $('startMonth').value,
    directCommercialRate: $('directCommercialRate').checked,
    bpSign: $('bpSign').value,
    bpValue: $('bpValue').value,
    commercialRate: $('commercialRate').value,
    providentRate: $('providentRate').value,
    separateTerms: $('separateTerms').checked,
    commercialTermYears: $('commercialTermYears').value,
    providentTermYears: $('providentTermYears').value,
    prepayments: readPrepayments()
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState())); } catch {}
}

function loadState() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (current) return current;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    if (legacy) {
      const house = Number(legacy.housePrice || 0);
      const ratio = 100 - Number(legacy.downPaymentRatio || 35);
      return { ...legacy, loanRatio: ratio, loanAmount: house * ratio / 100, primaryMethod: 'equalPayment', detailMethod: 'equalPayment', detailView: 'annual', detailScope: 'total' };
    }
  } catch {}
  return null;
}

function restoreState(s) {
  if (!s) return false;
  const cityExists = rateData.cities.some(c => c.id === s.city);
  $('city').value = cityExists ? s.city : 'beijing';
  ['homeType','housePrice','loanRatio','loanAmount','providentAmount','termYears','startMonth','bpSign','bpValue','commercialRate','providentRate','commercialTermYears','providentTermYears'].forEach(k => {
    if (s[k] !== undefined && $(k)) $(k).value = s[k];
  });
  lastLoanEdit = s.lastLoanEdit || 'ratio';
  setLoanType(s.loanType || 'combined');
  primaryMethod = s.primaryMethod || 'equalPayment';
  detailMethod = s.detailMethod || 'equalPayment';
  detailView = s.detailView || 'annual';
  detailScope = s.detailScope || (loanType === 'combined' ? 'total' : loanType);
  $('directCommercialRate').checked = !!s.directCommercialRate;
  $('separateTerms').checked = !!s.separateTerms;
  $('prepaymentList').innerHTML = '';
  (s.prepayments || []).forEach(addPrepayment);
  updateVisibility();
  syncBpEditor();
  refreshCitySourceOnly();
  $('providentRateDisplay').textContent = pct(Number($('providentRate').value || 0));
  document.querySelectorAll('#repaymentMethodTabs button').forEach(b => b.classList.toggle('active', b.dataset.value === primaryMethod));
  return true;
}

function getPlans() {
  try { return JSON.parse(localStorage.getItem(PLANS_KEY) || '[]'); } catch { return []; }
}

function setPlans(plans) {
  try { localStorage.setItem(PLANS_KEY, JSON.stringify(plans)); } catch {}
}

function renderSavedPlans() {
  const plans = getPlans();
  $('savedPlans').innerHTML = plans.length
    ? plans.map((p, i) => `<article class="saved-plan"><strong>${esc(p.name)}</strong><small>${esc(p.state.cityName || p.state.city)} · ${esc(p.state.housePrice)}万 · ${esc(p.state.loanAmount)}万贷款 · ${esc(METHOD_LABEL[p.state.primaryMethod] || '等额本息')}</small><div><button data-load="${i}">加载</button><button data-del="${i}">删除</button></div></article>`).join('')
    : '<span class="muted">尚未保存方案。所有方案只保存在当前浏览器。</span>';

  $('savedPlans').querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
    const plan = plans[Number(b.dataset.load)];
    if (!plan) return;
    restoreState(plan.state);
    calculate();
  });
  $('savedPlans').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    plans.splice(Number(b.dataset.del), 1);
    setPlans(plans);
    renderSavedPlans();
  });
}

function saveNamedPlan(name) {
  const c = currentCity();
  const state = { ...collectState(), cityName: c?.name || $('city').value };
  const plans = getPlans();
  plans.unshift({ name: name.trim() || `${c?.name || ''} ${$('housePrice').value}万方案`, state });
  setPlans(plans.slice(0, 12));
  renderSavedPlans();
}

function openSaveDialog() {
  const c = currentCity();
  const defaultName = `${c?.name || ''} ${$('housePrice').value}万 · ${METHOD_LABEL[primaryMethod]}`;
  $('planName').value = defaultName;
  const dialog = $('saveDialog');
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    setTimeout(() => { $('planName').focus(); $('planName').select(); }, 0);
  } else {
    const name = window.prompt('请输入方案名称', defaultName);
    if (name !== null) saveNamedPlan(name);
  }
}

function bindEvents() {
  document.querySelectorAll('#loanTypeTabs button').forEach(b => b.addEventListener('click', () => {
    setLoanType(b.dataset.value);
    applyProvidentRate();
    calculate();
  }));
  document.querySelectorAll('#repaymentMethodTabs button').forEach(b => b.addEventListener('click', () => setPrimaryMethod(b.dataset.value)));

  $('city').addEventListener('change', applyCityRate);
  $('homeType').addEventListener('change', () => { applyProvidentRate(); calculate(); });
  $('termYears').addEventListener('change', () => { applyProvidentRate(); calculate(); });
  $('providentTermYears').addEventListener('change', () => { applyProvidentRate(); calculate(); });
  $('commercialTermYears').addEventListener('change', calculate);

  $('housePrice').addEventListener('input', () => {
    if (lastLoanEdit === 'amount') syncRatioFromLoan(); else syncLoanFromRatio();
    calculate();
  });
  $('loanRatio').addEventListener('input', () => { lastLoanEdit = 'ratio'; syncLoanFromRatio(); calculate(); });
  $('loanAmount').addEventListener('input', () => { lastLoanEdit = 'amount'; syncRatioFromLoan(); calculate(); });
  $('providentAmount').addEventListener('input', calculate);
  $('startMonth').addEventListener('input', () => { renderMonthly(); saveState(); });

  $('directCommercialRate').addEventListener('change', () => { syncBpEditor(); calculate(); });
  $('bpValue').addEventListener('input', () => { syncBpEditor(); calculate(); });
  $('bpSign').addEventListener('change', () => { syncBpEditor(); calculate(); });
  $('commercialRate').addEventListener('input', calculate);
  $('providentRate').addEventListener('input', () => { $('providentRateDisplay').textContent = pct(Number($('providentRate').value || 0)); calculate(); });

  $('separateTerms').addEventListener('change', () => { updateVisibility(); applyProvidentRate(); calculate(); });
  $('addPrepayment').addEventListener('click', () => { addPrepayment(); calculate(); });
  $('customYear').addEventListener('input', renderYearCards);

  document.querySelectorAll('#detailViewTabs button').forEach(b => b.addEventListener('click', () => {
    detailView = b.dataset.value;
    renderDetails();
    saveState();
  }));
  document.querySelectorAll('#detailMethodTabs button').forEach(b => b.addEventListener('click', () => {
    detailMethod = b.dataset.value;
    renderDetails();
    saveState();
  }));
  document.querySelectorAll('#detailScopeTabs button').forEach(b => b.addEventListener('click', () => {
    detailScope = b.dataset.value;
    renderDetails();
    saveState();
  }));

  $('resetBtn').onclick = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    location.reload();
  };
  $('savePlan').onclick = openSaveDialog;
  $('saveDialog').addEventListener('close', () => {
    if ($('saveDialog').returnValue === 'confirm') saveNamedPlan($('planName').value);
  });

  window.addEventListener('resize', () => {
    clearTimeout(window.__chartTimer);
    window.__chartTimer = setTimeout(drawChart, 100);
  });
}

async function init() {
  for (let y = 1; y <= 30; y++) {
    ['termYears','commercialTermYears','providentTermYears'].forEach(id => {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = `${y} 年`;
      $(id).appendChild(o);
    });
  }
  $('termYears').value = '30';
  $('commercialTermYears').value = '30';
  $('providentTermYears').value = '30';
  $('startMonth').value = getStartMonth();

  try {
    const res = await fetch('./data/mortgage-rates.json', { cache: 'no-store' });
    rateData = await res.json();
    $('city').innerHTML = rateData.cities.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('dataBadge').textContent = `利率快照 ${rateData.asOf} · LPR 5Y ${pct(rateData.lpr.fiveYearPlus)}`;
    $('sourceFooter').textContent = `利率数据快照：${rateData.asOf}。LPR：${rateData.lpr.source || '全国银行间同业拆借中心'}；公积金采用现行基准；城市商贷为可编辑市场参考值。`;

    bindEvents();
    const restored = restoreState(loadState());
    if (!restored) {
      $('city').value = rateData.cities.some(c => c.id === 'beijing') ? 'beijing' : rateData.cities[0].id;
      syncLoanFromRatio();
      applyCityRate();
    } else {
      updateVisibility();
      calculate();
    }
    renderSavedPlans();
  } catch (e) {
    $('dataBadge').textContent = '利率数据加载失败';
    document.body.insertAdjacentHTML('afterbegin', '<div class="error-banner">无法加载利率数据，请刷新页面。</div>');
    console.error(e);
  }
}

init();
