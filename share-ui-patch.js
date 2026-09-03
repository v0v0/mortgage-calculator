(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let shareInstalled = false;
  let saveInstalled = false;

  const enumIndex = (value, values) => Math.max(0, values.indexOf(value));
  const numberValue = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  function packMonth(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    return match ? Number(`${match[1]}${match[2]}`) : 0;
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

  function collectCompactStateSync() {
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

  function makeShareUrlSync() {
    const raw = new TextEncoder().encode(JSON.stringify(collectCompactStateSync()));
    return `${location.origin}${location.pathname}#s=u${bytesToBase64Url(raw)}`;
  }

  function compactNumber(value) {
    const n = numberValue(value);
    if (!n) return '0';
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  }

  function buildShareTitle() {
    const rawCity = $('city')?.selectedOptions?.[0]?.textContent?.trim() || '';
    const city = rawCity.split(/[·|｜]/)[0].trim() || '房贷';
    const amount = compactNumber($('housePrice')?.value);
    let method = 'equalPayment';
    try {
      if (typeof primaryMethod !== 'undefined' && primaryMethod) method = primaryMethod;
    } catch (_) {}
    const methodLabel = method === 'equalPrincipal' ? '等额本金' : '等额本息';
    return `房贷计算-${city}${amount}万-${methodLabel}`;
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
      } catch (_) {}
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.readOnly = true;
      textarea.setAttribute('aria-hidden', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.fontSize = '16px';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (_) {
      return false;
    }
  }

  function setShareStatus(text) {
    const status = $('sharePanelStatus');
    if (status) status.textContent = text;
  }

  function openSharePanel(url) {
    const backdrop = $('sharePanelBackdrop');
    const field = $('shareUrlValue');
    if (field) field.value = url;
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add('share-panel-open');
  }

  function applyShareMetadata(title) {
    const previousTitle = document.title;
    let ogTitle = document.querySelector('meta[property="og:title"]');
    const createdOg = !ogTitle;
    const previousOg = ogTitle?.getAttribute('content') || '';
    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
    }
    document.title = title;
    ogTitle.setAttribute('content', title);
    return () => {
      document.title = previousTitle;
      if (createdOg) ogTitle.remove();
      else ogTitle.setAttribute('content', previousOg);
    };
  }

  function triggerSystemShareImmediately(url, title) {
    if (!navigator.share) return null;
    const restoreMetadata = applyShareMetadata(title);
    try {
      const promise = navigator.share({ title, text: title, url });
      Promise.resolve(promise)
        .catch(error => {
          if (error?.name !== 'AbortError') console.warn('系统分享未能打开', error);
        })
        .finally(restoreMetadata);
      return promise;
    } catch (error) {
      restoreMetadata();
      if (error?.name !== 'AbortError') console.warn('系统分享未能打开', error);
      return null;
    }
  }

  function shareNow() {
    let url;
    try {
      url = makeShareUrlSync();
    } catch (error) {
      console.error(error);
      setShareStatus('生成分享链接失败，请重试');
      return;
    }

    const title = buildShareTitle();
    openSharePanel(url);
    setShareStatus('已复制');

    // navigator.share() must run in the same user-activation task. Do not wait for
    // compression, clipboard promises or timers before invoking it.
    triggerSystemShareImmediately(url, title);

    copyText(url).then(copied => {
      setShareStatus(copied ? '已复制' : '复制失败，可长按链接复制');
    });
  }

  function installStyles() {
    if (document.getElementById('share-save-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'share-save-ui-style';
    style.textContent = `
      .share-panel-actions .share-copy-and-share{width:100%;min-height:44px;font-size:14px;font-weight:800}
      .save-dialog .save-dialog-heading{display:flex;align-items:center;gap:12px;margin:0 0 14px}
      .save-dialog .save-dialog-heading .dialog-icon{flex:0 0 42px;margin:0}
      .save-dialog .save-dialog-heading h3{margin:0;font-size:20px;line-height:1.25;color:#172033}
      .save-dialog .save-persistence-box{margin:0 0 16px;padding:14px;border:1px solid #efcf98;border-radius:14px;background:linear-gradient(145deg,#fff9ed,#f5f9ff)}
      .save-dialog .save-persistence-title{display:flex;align-items:center;gap:8px;color:#173f70;font-size:15px;font-weight:900;line-height:1.35}
      .save-dialog .save-persistence-title svg{width:19px;height:19px;fill:none;stroke:#2563eb;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
      .save-dialog .save-persistence-box>p{margin:8px 0 0!important;color:#4d6179!important;font-size:13px!important;line-height:1.65;font-weight:600}
      .save-dialog .save-persistence-box>p strong{color:#b45309;font-weight:900}
      .save-dialog .save-persistent-option{margin-top:12px;padding-top:12px;border-top:1px dashed #d6c59f}
      .save-dialog .save-persistent-option strong{display:block;margin-bottom:4px;color:#174f91;font-size:14px;line-height:1.4}
      .save-dialog .save-persistent-option span{display:block;color:#4f657e;font-size:13px;line-height:1.6;font-weight:600}
      .save-dialog .save-persistent-option button{width:100%;margin-top:10px;min-height:44px;border:1px solid #8db9ee;border-radius:11px;background:linear-gradient(135deg,#edf5ff,#e8f7f3);color:#1257a6;font-size:14px;font-weight:900;cursor:pointer}
      .save-dialog .save-persistent-option button:hover{background:#e5f1ff}
      .save-dialog .save-local-intro{margin:0 0 10px!important;color:#405a78!important;font-size:13px!important;line-height:1.5;font-weight:800}
      @media(max-width:720px){
        .save-dialog .save-dialog-heading{gap:10px;margin-bottom:12px}
        .save-dialog .save-dialog-heading h3{font-size:19px}
        .save-dialog .save-persistence-box{padding:12px;margin-bottom:14px}
        .save-dialog .save-persistence-title{font-size:14px}
        .save-dialog .save-persistence-box>p,.save-dialog .save-persistent-option span{font-size:12.5px}
        .save-dialog .save-persistent-option button{min-height:44px;font-size:14px}
      }
    `;
    document.head.appendChild(style);
  }

  function installShareUi() {
    if (shareInstalled) return true;
    const floatShare = $('floatShare');
    const actions = document.querySelector('.share-panel-actions');
    const field = $('shareUrlValue');
    if (!floatShare || !actions || !field) return false;

    shareInstalled = true;

    // Capture phase prevents the legacy delayed share handler from running.
    floatShare.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      shareNow();
    }, true);

    actions.replaceChildren();
    const button = document.createElement('button');
    button.id = 'shareCopyAndShare';
    button.type = 'button';
    button.className = 'primary share-copy-and-share';
    button.textContent = '复制并分享';
    actions.appendChild(button);

    const label = field.closest('.share-url-label');
    if (label) label.insertAdjacentElement('afterend', actions);

    button.addEventListener('click', event => {
      event.preventDefault();
      shareNow();
    });

    window.__mortgageShareNow = shareNow;
    return true;
  }

  function installSavePersistenceGuide() {
    if (saveInstalled) return true;
    const dialog = $('saveDialog');
    const form = $('saveDialogForm');
    const title = form?.querySelector('h3');
    const icon = form?.querySelector('.dialog-icon');
    if (!dialog || !form || !title || !icon) return false;

    saveInstalled = true;

    if (!form.querySelector('.save-dialog-heading')) {
      const heading = document.createElement('div');
      heading.className = 'save-dialog-heading';
      icon.insertAdjacentElement('beforebegin', heading);
      heading.append(icon, title);
    }

    const existingIntro = form.querySelector('.save-dialog-heading')?.nextElementSibling;
    const guide = document.createElement('div');
    guide.className = 'save-persistence-box';
    guide.innerHTML = `
      <div class="save-persistence-title">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 5v5h8V5M8 19v-6h8v6"/></svg>
        <span>本地保存：仅当前浏览器可用</span>
      </div>
      <p>方案只保存在这个浏览器中，不会自动同步到其他设备。更换设备、使用无痕模式或清理浏览器数据后，<strong>本地方案可能丢失</strong>。</p>
      <div class="save-persistent-option">
        <strong>建议重要方案使用专属链接长期保存</strong>
        <span>专属链接包含当前完整房贷方案，可以收藏、发送给自己或跨设备打开并自动恢复。</span>
        <button id="saveDialogShare" type="button">生成并分享专属链接</button>
      </div>`;
    form.querySelector('.save-dialog-heading').insertAdjacentElement('afterend', guide);

    if (existingIntro?.tagName === 'P') {
      existingIntro.textContent = '也可以给当前浏览器中的本地方案命名：';
      existingIntro.classList.add('save-local-intro');
      guide.insertAdjacentElement('afterend', existingIntro);
    }

    $('saveDialogShare')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (dialog.open) dialog.close('cancel');
      // Keep the original button click's user activation; do not defer with rAF/timer.
      shareNow();
    });

    return true;
  }

  function installAll() {
    installStyles();
    const shareReady = installShareUi();
    const saveReady = installSavePersistenceGuide();
    return shareReady && saveReady;
  }

  if (!installAll()) {
    const observer = new MutationObserver(() => {
      if (installAll()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
  }
})();
