(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const pendingPayload = window.__mortgageSharePayload || (location.hash.startsWith('#s=') ? location.hash.slice(3) : '');

  if (!window.__mortgageSharePayload && pendingPayload) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  const enumIndex = (value, values) => Math.max(0, values.indexOf(value));
  const enumValue = (index, values, fallback) => values[Number(index)] ?? fallback;
  const numberValue = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  function installFloatingTools() {
    if (!document.querySelector('link[data-share-state-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = './share-state.css';
      link.dataset.shareStateStyle = '1';
      document.head.appendChild(link);
    }

    const nav = document.querySelector('.floating-tools');
    if (nav) {
      nav.innerHTML = `
        <button id="floatTop" type="button" title="回到顶部" aria-label="回到顶部">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
        </button>
        <button id="floatCompare" type="button" title="查看方案对比" aria-label="查看方案对比">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-7M3 19h18"/></svg>
        </button>
        <button id="floatDetail" type="button" title="查看还款明细" aria-label="查看还款明细">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14M8 4v16M16 4v16"/></svg>
        </button>
        <button id="floatShare" type="button" title="分享当前方案链接" aria-label="分享当前方案链接">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5"/></svg>
        </button>
        <button id="floatSave" type="button" title="保存当前方案" aria-label="保存当前方案">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6"/></svg>
        </button>`;
    }

    if (!$('shareToast')) {
      const toast = document.createElement('div');
      toast.id = 'shareToast';
      toast.className = 'share-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
  }

  function packMonth(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    return match ? Number(`${match[1]}${match[2]}`) : 0;
  }

  function unpackMonth(value) {
    const text = String(Math.trunc(numberValue(value)));
    return /^\d{6}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4)}` : '';
  }

  function compactPrepayments(items) {
    return (Array.isArray(items) ? items : []).map(item => {
      const target = enumIndex(item?.target, ['commercial', 'provident']);
      const strategy = enumIndex(item?.strategy, ['shorten', 'reducePayment']);
      if (item?.mode === 'recurring') {
        return [1, numberValue(item.firstMonth), numberValue(item.intervalMonths), numberValue(item.amountWan), target, strategy];
      }
      return [0, numberValue(item?.month), numberValue(item?.amountWan), target, strategy];
    });
  }

  function expandPrepayments(items) {
    return (Array.isArray(items) ? items : []).map(item => {
      if (!Array.isArray(item)) return null;
      const recurring = item[0] === 1;
      const target = enumValue(item[recurring ? 4 : 3], ['commercial', 'provident'], 'commercial');
      const strategy = enumValue(item[recurring ? 5 : 4], ['shorten', 'reducePayment'], 'shorten');
      if (recurring) {
        return {
          mode: 'recurring',
          firstMonth: numberValue(item[1]),
          intervalMonths: numberValue(item[2]),
          amountWan: numberValue(item[3]),
          target,
          strategy
        };
      }
      return {
        mode: 'custom',
        month: numberValue(item[1]),
        amountWan: numberValue(item[2]),
        target,
        strategy
      };
    }).filter(Boolean);
  }

  function collectCompactState() {
    if (typeof collectState !== 'function') throw new Error('state collector unavailable');
    const s = collectState();
    const signedBp = (s.bpSign === '-' ? -1 : 1) * numberValue(s.bpValue);
    return [
      1,
      s.city || '',
      enumIndex(s.homeType, ['first', 'second']),
      numberValue(s.housePrice),
      numberValue(s.loanAmount),
      enumIndex(s.loanType, ['commercial', 'provident', 'combined']),
      enumIndex(s.primaryMethod, ['equalPayment', 'equalPrincipal']),
      enumIndex(s.detailMethod, ['equalPayment', 'equalPrincipal']),
      enumIndex(s.detailView, ['annual', 'monthly']),
      numberValue(s.providentAmount),
      numberValue(s.termYears),
      packMonth(s.startMonth),
      s.directCommercialRate ? 1 : 0,
      signedBp,
      numberValue(s.commercialRate),
      numberValue(s.providentRate),
      s.separateTerms ? 1 : 0,
      numberValue(s.commercialTermYears),
      numberValue(s.providentTermYears),
      compactPrepayments(s.prepayments),
      $('advancedDetails')?.open ? 1 : 0
    ];
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function compress(bytes) {
    if (!('CompressionStream' in window)) return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decompress(bytes) {
    if (!('DecompressionStream' in window)) throw new Error('decompression unsupported');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function encodeState(state) {
    const raw = new TextEncoder().encode(JSON.stringify(state));
    const zipped = await compress(raw);
    if (zipped && zipped.length + 3 < raw.length) return `z${bytesToBase64Url(zipped)}`;
    return `u${bytesToBase64Url(raw)}`;
  }

  async function decodeState(payload) {
    if (!payload || payload.length < 2) throw new Error('invalid share payload');
    const kind = payload[0];
    let bytes = base64UrlToBytes(payload.slice(1));
    if (kind === 'z') bytes = await decompress(bytes);
    else if (kind !== 'u') throw new Error('unknown share payload');
    const state = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(state) || state[0] !== 1) throw new Error('unsupported share version');
    return state;
  }

  function expandState(s) {
    const housePrice = numberValue(s[3]);
    const loanAmount = numberValue(s[4]);
    const ratio = housePrice > 0 ? loanAmount / housePrice * 100 : 0;
    const bp = numberValue(s[13]);
    return {
      city: String(s[1] || ''),
      homeType: enumValue(s[2], ['first', 'second'], 'first'),
      housePrice,
      loanRatio: Number(ratio.toFixed(4)),
      loanAmount,
      lastLoanEdit: 'amount',
      loanType: enumValue(s[5], ['commercial', 'provident', 'combined'], 'combined'),
      primaryMethod: enumValue(s[6], ['equalPayment', 'equalPrincipal'], 'equalPayment'),
      detailMethod: enumValue(s[7], ['equalPayment', 'equalPrincipal'], 'equalPayment'),
      detailView: enumValue(s[8], ['annual', 'monthly'], 'annual'),
      detailScope: 'total',
      providentAmount: numberValue(s[9]),
      termYears: numberValue(s[10]) || 30,
      startMonth: unpackMonth(s[11]),
      directCommercialRate: !!s[12],
      bpSign: bp < 0 ? '-' : '+',
      bpValue: Math.abs(bp),
      commercialRate: numberValue(s[14]),
      providentRate: numberValue(s[15]),
      separateTerms: !!s[16],
      commercialTermYears: numberValue(s[17]) || numberValue(s[10]) || 30,
      providentTermYears: numberValue(s[18]) || numberValue(s[10]) || 30,
      prepayments: expandPrepayments(s[19])
    };
  }

  function showToast(text) {
    const toast = $('shareToast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  async function makeShareUrl() {
    const encoded = await encodeState(collectCompactState());
    return `${location.origin}${location.pathname}#s=${encoded}`;
  }

  async function shareCurrentPlan() {
    const button = $('floatShare');
    try {
      const url = await makeShareUrl();
      if (navigator.share) {
        try {
          await navigator.share({
            title: '房贷利率计算器',
            text: '打开后自动应用我分享的房贷测算方案',
            url
          });
          showToast(`已生成方案链接（${url.length} 字符）`);
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.readOnly = true;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      button?.classList.add('share-success');
      setTimeout(() => button?.classList.remove('share-success'), 900);
      showToast(`方案链接已复制（${url.length} 字符）`);
    } catch (error) {
      console.error(error);
      showToast('生成分享链接失败，请重试');
    }
  }

  function bindFloatingTools() {
    $('floatTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $('floatCompare')?.addEventListener('click', () => document.querySelector('.comparison-card-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    $('floatDetail')?.addEventListener('click', () => document.querySelector('.detail-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    $('floatShare')?.addEventListener('click', shareCurrentPlan);
    $('floatSave')?.addEventListener('click', () => $('savePlan')?.click());
  }

  function preserveSharedCommercialRate(savedRate, originallyDirect) {
    const rateInput = $('commercialRate');
    const directToggle = $('directCommercialRate');
    if (!rateInput || !directToggle || savedRate <= 0) return;
    const currentRate = numberValue(rateInput.value);
    if (originallyDirect || Math.abs(currentRate - savedRate) > 0.0005) {
      directToggle.checked = true;
      if (typeof syncBpEditor === 'function') syncBpEditor();
      rateInput.value = String(savedRate);
    }
  }

  async function restoreSharedPlan() {
    if (!pendingPayload) return;
    try {
      const compact = await decodeState(pendingPayload);
      const state = expandState(compact);
      const savedCommercialRate = state.commercialRate;
      const originallyDirect = state.directCommercialRate;
      const advancedOpen = !!compact[20];
      const started = Date.now();
      const timer = setInterval(() => {
        const ready = $('city')?.options.length && typeof restoreState === 'function' && typeof calculate === 'function';
        if (!ready && Date.now() - started < 6000) return;
        clearInterval(timer);
        if (!ready) {
          showToast('分享方案加载失败：页面数据尚未就绪');
          return;
        }
        try {
          restoreState(state);
          preserveSharedCommercialRate(savedCommercialRate, originallyDirect);
          if ($('advancedDetails')) $('advancedDetails').open = advancedOpen;
          calculate();
          if (typeof renderSavedPlans === 'function') renderSavedPlans();
          showToast('已应用分享链接中的房贷方案');
        } catch (error) {
          console.error(error);
          showToast('分享方案无效或无法应用');
        }
      }, 50);
    } catch (error) {
      console.error(error);
      showToast('分享方案无法解析');
    }
  }

  installFloatingTools();
  bindFloatingTools();
  restoreSharedPlan();
})();