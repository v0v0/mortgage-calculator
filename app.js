const $ = (id) => document.getElementById(id);
const money0 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let rateData;
let loanType = 'combined';
let chartMode = 'equalPayment';
let annualMode = 'equalPayment';
let results = null;
let prepaymentSeq = 0;
const STORAGE_KEY = 'mortgage-calculator-state-v1';
const PLANS_KEY = 'mortgage-calculator-plans-v1';

function yuanFromWan(v) { return Math.max(0, Number(v || 0)) * 10000; }
function wan(v) { return `${num2.format(v / 10000)} 万`; }
function pct(v) { return `${Number(v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
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
  let remainingPlanned = months;
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
      remaining: balance
    });

    remainingPlanned--;
    if (remainingPlanned <= 0 && balance > 0.005) {
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
  if (rows.length && Math.abs(rows[rows.length - 1].remaining) < 0.01) rows[rows.length - 1].remaining = 0;
  return rows;
}

function mergeSchedules(a, b) {
  const n = Math.max(a.length, b.length);
  const rows = [];
  let cp = 0, ci = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] || { payment:0, principal:0, interest:0, remaining:0, extraPrincipal:0 };
    const y = b[i] || { payment:0, principal:0, interest:0, remaining:0, extraPrincipal:0 };
    const principal = x.principal + y.principal;
    const interest = x.interest + y.interest;
    cp += principal; ci += interest;
    rows.push({ period:i+1, payment:x.payment+y.payment, principal, interest, extraPrincipal:x.extraPrincipal+y.extraPrincipal, cumulativePrincipal:cp, cumulativeInterest:ci, remaining:x.remaining+y.remaining });
  }
  return rows;
}

function summarize(schedule) {
  const principal = schedule.reduce((s,r)=>s+r.principal,0);
  const interest = schedule.reduce((s,r)=>s+r.interest,0);
  const payment = schedule.reduce((s,r)=>s+r.payment,0);
  return {
    principal, interest, payment,
    firstPayment: schedule[0]?.payment || 0,
    lastPayment: schedule[schedule.length-1]?.payment || 0,
    months: schedule.length
  };
}

function currentCity() { return rateData?.cities.find(c => c.id === $('city').value) || rateData?.cities[0]; }
function benchmarkValue(benchmark) { return benchmark === 'LPR1Y' ? rateData.lpr.oneYear : rateData.lpr.fiveYearPlus; }
function getCommercialTerm() { return $('separateTerms').checked && loanType === 'combined' ? Number($('commercialTermYears').value) : Number($('termYears').value); }
function getProvidentTerm() { return $('separateTerms').checked && loanType === 'combined' ? Number($('providentTermYears').value) : Number($('termYears').value); }

function applyCityRate() {
  if (!rateData) return;
  const c = currentCity();
  const b = benchmarkValue(c.commercial.benchmark);
  $('lprValue').textContent = pct(b);
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
  $('providentHint').textContent = `${$('homeType').value === 'first' ? '首套' : '二套'} · ${years <= 5 ? '5年及以下' : '5年以上'}参考利率，可手动修改`;
}

function syncBpEditor() {
  const direct = $('directCommercialRate').checked;
  $('bpRateEditor').classList.toggle('hidden', direct);
  $('commercialRate').disabled = !direct;
  if (!direct && rateData) {
    const c = currentCity();
    const base = benchmarkValue(c.commercial.benchmark);
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
  prepaymentSeq++;
  const row = document.createElement('div');
  row.className = 'prepayment-row';
  row.innerHTML = `
    <label>第几期<input data-field="month" type="number" min="1" value="${data.month || 60}"></label>
    <label>金额（万元）<input data-field="amount" type="number" min="0" step="1" value="${data.amountWan || 50}"></label>
    <label>偿还目标<select data-field="target"><option value="commercial">商业贷款</option><option value="provident">公积金贷款</option></select></label>
    <label>处理策略<select data-field="strategy"><option value="shorten">月供基本不变，缩短期限</option><option value="reducePayment">期限不变，减少月供</option></select></label>
    <button class="ghost" type="button">删除</button>`;
  row.querySelector('[data-field="target"]').value = data.target || 'commercial';
  row.querySelector('[data-field="strategy"]').value = data.strategy || 'shorten';
  row.querySelector('button').addEventListener('click', () => { row.remove(); calculate(); });
  row.querySelectorAll('input,select').forEach(el => el.addEventListener('input', calculate));
  $('prepaymentList').appendChild(row);
}

function calculate() {
  if (!rateData) return;
  const housePrice = yuanFromWan($('housePrice').value);
  const ratio = clamp(Number($('downPaymentRatio').value || 0), 0, 100) / 100;
  const down = housePrice * ratio;
  const totalLoan = Math.max(0, housePrice - down);
  let provident = 0, commercial = 0;
  if (loanType === 'commercial') commercial = totalLoan;
  else if (loanType === 'provident') provident = totalLoan;
  else {
    provident = Math.min(yuanFromWan($('providentAmount').value), totalLoan);
    commercial = Math.max(0, totalLoan - provident);
  }
  $('downPaymentAmount').textContent = wan(down);
  $('loanTotal').textContent = wan(totalLoan);
  $('commercialAmount').value = `${num2.format(commercial/10000)} 万`;

  const commercialRate = Number($('commercialRate').value || 0);
  const providentRate = Number($('providentRate').value || 0);
  const commercialMonths = getCommercialTerm() * 12;
  const providentMonths = getProvidentTerm() * 12;
  const pps = readPrepayments();
  const commercialPP = pps.filter(p => p.target === 'commercial');
  const providentPP = pps.filter(p => p.target === 'provident');

  const build = (method) => {
    const commercialSchedule = generateSchedule({ principal:commercial, annualRate:commercialRate, months:commercialMonths, method, prepayments:commercialPP });
    const providentSchedule = generateSchedule({ principal:provident, annualRate:providentRate, months:providentMonths, method, prepayments:providentPP });
    return { commercial:commercialSchedule, provident:providentSchedule, total:mergeSchedules(commercialSchedule, providentSchedule) };
  };
  results = { equalPayment: build('equalPayment'), equalPrincipal: build('equalPrincipal') };
  renderComparison(); renderAnnual(); renderMonthly(); renderYearCards(); drawChart(); saveState();
}

function renderComparison() {
  const ep = summarize(results.equalPayment.total);
  const ea = summarize(results.equalPrincipal.total);
  const saved = Math.max(0, ep.interest - ea.interest);
  const make = (title, s, cls='') => `<div class="compare-card ${cls}"><h3>${title}</h3>
    <div class="metric"><span>首月还款</span><b>${money0.format(s.firstPayment)}</b></div>
    <div class="metric"><span>末月还款</span><b>${money0.format(s.lastPayment)}</b></div>
    <div class="metric"><span>总本金</span><b>${wan(s.principal)}</b></div>
    <div class="metric"><span>总利息</span><b>${wan(s.interest)}</b></div>
    <div class="metric"><span>总还款额</span><b>${wan(s.payment)}</b></div>
    <div class="metric"><span>实际还款期数</span><b>${s.months} 期</b></div></div>`;
  $('comparison').innerHTML = make('等额本息',ep,'highlight') + make('等额本金',ea) + `<div class="compare-card" style="grid-column:1/-1"><div class="metric"><span>等额本金相对节省利息</span><b>${wan(saved)}</b></div></div>`;
}

function annualRows(schedule) {
  const out = [];
  for (let i=0;i<schedule.length;i+=12) {
    const rows = schedule.slice(i,i+12);
    const start = i === 0 ? schedule[0]?.remaining + schedule[0]?.principal || 0 : schedule[i-1].remaining;
    const principal = rows.reduce((s,r)=>s+r.principal,0);
    const interest = rows.reduce((s,r)=>s+r.interest,0);
    const payment = rows.reduce((s,r)=>s+r.payment,0);
    out.push({ year:Math.floor(i/12)+1,start,principal,interest,payment,end:rows.at(-1)?.remaining||0 });
  }
  return out;
}

function renderAnnual() {
  const rows = annualRows(results[annualMode].total);
  $('annualBody').innerHTML = rows.map(r=>`<tr><td>第 ${r.year} 年</td><td>${money0.format(r.start)}</td><td>${money0.format(r.principal)}</td><td>${money0.format(r.interest)}</td><td>${money0.format(r.payment)}</td><td>${money0.format(r.end)}</td></tr>`).join('');
}

function scheduleForDetail() {
  const method = $('detailMethod').value;
  let scope = $('detailScope').value;
  if (loanType === 'commercial') scope = 'commercial';
  if (loanType === 'provident') scope = 'provident';
  return results[method][scope] || [];
}
function renderMonthly() {
  const schedule = scheduleForDetail();
  const start = getStartMonth();
  $('monthlyBody').innerHTML = schedule.map((r,i)=>`<tr><td>第 ${r.period} 期</td><td>${addMonths(start,i)}</td><td>${money2.format(r.payment)}</td><td>${money2.format(r.principal)}</td><td>${money2.format(r.interest)}</td><td>${money2.format(r.cumulativePrincipal)}</td><td>${money2.format(r.cumulativeInterest)}</td><td>${money2.format(r.remaining)}</td></tr>`).join('');
}

function renderYearCards() {
  const schedule = results[chartMode].total;
  const years = [...new Set([5,10,15,20,Number($('customYear').value||8)])].filter(y=>y>0).sort((a,b)=>a-b);
  $('yearCards').innerHTML = years.map(y=>{
    const row = schedule[Math.min(y*12, schedule.length)-1];
    if (!row) return '';
    return `<div class="year-card"><h3>第 ${y} 年</h3><p><span>已还本金</span><b>${wan(row.cumulativePrincipal)}</b></p><p><span>已付利息</span><b>${wan(row.cumulativeInterest)}</b></p><p><span>累计还款</span><b>${wan(row.cumulativePrincipal+row.cumulativeInterest)}</b></p><p><span>剩余本金</span><b>${wan(row.remaining)}</b></p></div>`;
  }).join('');
}

function drawChart() {
  const canvas = $('trendChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 900, h = 300;
  canvas.width = w*dpr; canvas.height = h*dpr; ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  const rows = results?.[chartMode]?.total || [];
  if (!rows.length) return;
  const max = Math.max(rows[0].remaining + rows[0].principal, rows.at(-1).cumulativePrincipal, rows.at(-1).cumulativeInterest,1);
  const pad={l:44,r:14,t:20,b:28}, cw=w-pad.l-pad.r, ch=h-pad.t-pad.b;
  ctx.font='11px system-ui'; ctx.fillStyle='#7a808a'; ctx.strokeStyle='#e7e9ed'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(`${Math.round(max*(4-i)/4/10000)}万`,2,y+4)}
  const series=[
    {get:r=>r.remaining,stroke:'#15181d'},
    {get:r=>r.cumulativePrincipal,stroke:'#6f7783'},
    {get:r=>r.cumulativeInterest,stroke:'#a3a9b2'}
  ];
  series.forEach(s=>{ctx.beginPath();ctx.strokeStyle=s.stroke;ctx.lineWidth=2;rows.forEach((r,i)=>{const x=pad.l+cw*(i/(rows.length-1||1));const y=pad.t+ch*(1-s.get(r)/max);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()});
  ctx.fillStyle='#7a808a';ctx.fillText('0',pad.l,h-8);ctx.fillText(`${Math.ceil(rows.length/12)}年`,w-pad.r-24,h-8);
}

function updateVisibility() {
  $('providentAmountWrap').classList.toggle('hidden', loanType !== 'combined');
  $('commercialAmountWrap').classList.toggle('hidden', loanType === 'provident');
  $('commercialRatePanel').classList.toggle('hidden', loanType === 'provident');
  $('providentRatePanel').classList.toggle('hidden', loanType === 'commercial');
  $('detailScope').disabled = loanType !== 'combined';
  if (loanType !== 'combined') $('separateTerms').checked = false;
  $('separateTermsPanel').classList.toggle('hidden', !$('separateTerms').checked || loanType !== 'combined');
}

function collectState() {
  return {
    city:$('city').value, homeType:$('homeType').value, housePrice:$('housePrice').value, downPaymentRatio:$('downPaymentRatio').value,
    loanType, providentAmount:$('providentAmount').value, termYears:$('termYears').value, startMonth:$('startMonth').value,
    directCommercialRate:$('directCommercialRate').checked, bpSign:$('bpSign').value, bpValue:$('bpValue').value, commercialRate:$('commercialRate').value,
    providentRate:$('providentRate').value, separateTerms:$('separateTerms').checked, commercialTermYears:$('commercialTermYears').value, providentTermYears:$('providentTermYears').value,
    prepayments:readPrepayments()
  };
}
function saveState(){ try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(collectState())); }catch{} }
function loadState(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{return null} }
function restoreState(s){
  if(!s)return false;
  ['city','homeType','housePrice','downPaymentRatio','providentAmount','termYears','startMonth','bpSign','bpValue','commercialRate','providentRate','commercialTermYears','providentTermYears'].forEach(k=>{if(s[k]!==undefined && $(k)) $(k).value=s[k]});
  loanType=s.loanType||'combined'; $('directCommercialRate').checked=!!s.directCommercialRate; $('separateTerms').checked=!!s.separateTerms;
  $('loanTypeTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.value===loanType));
  (s.prepayments||[]).forEach(addPrepayment); updateVisibility(); syncBpEditor(); return true;
}

function renderSavedPlans(){
  let plans=[]; try{plans=JSON.parse(localStorage.getItem(PLANS_KEY)||'[]')}catch{}
  $('savedPlans').innerHTML=plans.length?plans.map((p,i)=>`<div class="saved-plan"><strong>${p.name}</strong><small>${p.state.city} · ${p.state.housePrice}万 · ${p.state.termYears}年</small><button data-load="${i}">加载</button><button data-del="${i}">删除</button></div>`).join(''):'<span class="muted">尚未保存方案。数据只保存在当前浏览器。</span>';
  $('savedPlans').querySelectorAll('[data-load]').forEach(b=>b.onclick=()=>{const p=plans[Number(b.dataset.load)];location.reload();localStorage.setItem(STORAGE_KEY,JSON.stringify(p.state))});
  $('savedPlans').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{plans.splice(Number(b.dataset.del),1);localStorage.setItem(PLANS_KEY,JSON.stringify(plans));renderSavedPlans()});
}

function bindEvents() {
  $('loanTypeTabs').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{loanType=b.dataset.value;$('loanTypeTabs').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));updateVisibility();applyProvidentRate();calculate()}));
  $('city').addEventListener('change',applyCityRate);
  $('homeType').addEventListener('change',()=>{applyProvidentRate();calculate()});
  $('termYears').addEventListener('change',()=>{applyProvidentRate();calculate()});
  $('providentTermYears').addEventListener('change',()=>{applyProvidentRate();calculate()});
  $('commercialTermYears').addEventListener('change',calculate);
  $('directCommercialRate').addEventListener('change',()=>{syncBpEditor();calculate()});
  $('bpValue').addEventListener('input',()=>{syncBpEditor();calculate()});
  $('bpSign').addEventListener('change',()=>{syncBpEditor();calculate()});
  $('commercialRate').addEventListener('input',calculate);
  $('providentRate').addEventListener('input',calculate);
  ['housePrice','downPaymentRatio','providentAmount','startMonth'].forEach(id=>$(id).addEventListener('input',calculate));
  $('separateTerms').addEventListener('change',()=>{updateVisibility();applyProvidentRate();calculate()});
  $('addPrepayment').addEventListener('click',()=>{addPrepayment();calculate()});
  $('detailMethod').addEventListener('change',renderMonthly);$('detailScope').addEventListener('change',renderMonthly);
  document.querySelectorAll('[data-chart-mode]').forEach(b=>b.onclick=()=>{chartMode=b.dataset.chartMode;document.querySelectorAll('[data-chart-mode]').forEach(x=>x.classList.toggle('active',x===b));drawChart();renderYearCards()});
  document.querySelectorAll('[data-annual-mode]').forEach(b=>b.onclick=()=>{annualMode=b.dataset.annualMode;document.querySelectorAll('[data-annual-mode]').forEach(x=>x.classList.toggle('active',x===b));renderAnnual()});
  $('customYear').addEventListener('input',renderYearCards);
  $('resetBtn').onclick=()=>{localStorage.removeItem(STORAGE_KEY);location.reload()};
  $('savePlan').onclick=()=>{let plans=[];try{plans=JSON.parse(localStorage.getItem(PLANS_KEY)||'[]')}catch{};const c=currentCity();plans.unshift({name:`${c.name} ${$('housePrice').value}万 · ${new Date().toLocaleDateString('zh-CN')}`,state:collectState()});plans=plans.slice(0,8);localStorage.setItem(PLANS_KEY,JSON.stringify(plans));renderSavedPlans()};
  window.addEventListener('resize',()=>{clearTimeout(window.__chartTimer);window.__chartTimer=setTimeout(drawChart,100)});
}

async function init() {
  for(let y=1;y<=30;y++) ['termYears','commercialTermYears','providentTermYears'].forEach(id=>{const o=document.createElement('option');o.value=y;o.textContent=`${y} 年`;$(id).appendChild(o)});
  $('termYears').value='30';$('commercialTermYears').value='30';$('providentTermYears').value='30';
  $('startMonth').value=getStartMonth();
  try {
    const res = await fetch('./data/mortgage-rates.json',{cache:'no-store'}); rateData=await res.json();
    $('city').innerHTML=rateData.cities.map(c=>`<option value="${c.id}">${c.name} · ${c.tier}</option>`).join('');
    $('dataBadge').textContent=`利率快照 ${rateData.asOf} · LPR 5Y ${pct(rateData.lpr.fiveYearPlus)}`;
    $('sourceFooter').textContent=`利率数据快照：${rateData.asOf}。LPR：${rateData.lpr.source}；公积金：现行基准；各城市商贷为市场参考值。`;
    bindEvents();
    const restored=restoreState(loadState());
    if(!restored){$('city').value='beijing';applyCityRate()} else {updateVisibility();calculate()}
    renderSavedPlans();
  } catch (e) {
    $('dataBadge').textContent='利率数据加载失败';
    document.body.insertAdjacentHTML('afterbegin','<div style="padding:10px;background:#fff2f2;text-align:center">无法加载利率数据，请刷新页面。</div>');
    console.error(e);
  }
}

init();
