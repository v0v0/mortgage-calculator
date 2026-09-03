(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let shareInstalled = false;
  let saveInstalled = false;
  let titleInstalled = false;

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
    const amount = compactNumber($('loanAmount')?.value);
    const activeLoanType = document.querySelector('#loanTypeTabs button.active')?.dataset.value || 'combined';
    const loanLabel = activeLoanType === 'commercial' ? '商贷' : activeLoanType === 'provident' ? '公积金' : '组合贷';

    let method = 'equalPayment';
    try {
      if (typeof primaryMethod !== 'undefined' && primaryMethod) method = primaryMethod;
    } catch (_) {}
    const methodLabel = method === 'equalPrincipal' ? '等额本金' : '等额本息';

    const baseYears = compactNumber($('termYears')?.value);
    let termLabel = `${baseYears}年`;
    if (activeLoanType === 'combined' && $('separateTerms')?.checked) {
      const commercialYears = compactNumber($('commercialTermYears')?.value || baseYears);
      const providentYears = compactNumber($('providentTermYears')?.value || baseYears);
      termLabel = commercialYears === providentYears ? `${commercialYears}年` : `商${commercialYears}/公${providentYears}年`;
    }

    return `房贷-${city}-${amount}万-${loanLabel}-${methodLabel}-${termLabel}`;
  }

  function updatePageTitle() {
    const title = buildShareTitle();
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

  function installLiveTitle() {
    if (titleInstalled) return true;
    titleInstalled = true;
    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        updatePageTitle();
      });
    };
    document.addEventListener('input', queue, true);
    document.addEventListener('change', queue, true);
    document.addEventListener('click', queue, false);
    window.addEventListener('load', queue, { once: true });
    setTimeout(queue, 50);
    setTimeout(queue, 400);
    setTimeout(queue, 1200);
    return true;
  }

  function isIosChrome() {
    const ua = navigator.userAgent || '';
    return /(?:iPhone|iPad|iPod)/i.test(ua) && /CriOS/i.test(ua);
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

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
      } catch (_) {}
    }
    return Promise.resolve(legacyCopy(text));
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

  function triggerSystemShareImmediately(url, title) {
    if (!navigator.share) return null;
    updatePageTitle();
    try {
      const promise = navigator.share({ title, text: title, url });
      Promise.resolve(promise).catch(error => {
        if (error?.name !== 'AbortError') console.warn('系统分享未能打开', error);
      });
      return promise;
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('系统分享未能打开', error);
      return null;
    }
  }

  function buildSharePayload() {
    const url = makeShareUrlSync();
    const title = updatePageTitle();
    return { url, title };
  }

  function shareFromFloatingButton() {
    let payload;
    try {
      payload = buildSharePayload();
    } catch (error) {
      console.error(error);
      setShareStatus('生成分享链接失败，请重试');
      return;
    }

    openSharePanel(payload.url);
    setShareStatus('已复制');
    copyText(payload.url).then(copied => {
      setShareStatus(copied ? '已复制' : '复制失败，可长按链接复制');
    });

    // iOS Chrome can reject navigator.share() when the same click also opens our
    // custom share UI. Keep the panel/copy behavior there and let the explicit
    // panel button perform the system share. Safari and other browsers retain
    // immediate system sharing.
    if (!isIosChrome()) triggerSystemShareImmediately(payload.url, payload.title);
  }

  function shareFromPanelButton() {
    let payload;
    try {
      payload = buildSharePayload();
    } catch (error) {
      console.error(error);
      setShareStatus('生成分享链接失败，请重试');
      return;
    }

    openSharePanel(payload.url);
    setShareStatus('已复制');
    triggerSystemShareImmediately(payload.url, payload.title);
    copyText(payload.url).then(copied => {
      setShareStatus(copied ? '已复制' : '复制失败，可长按链接复制');
    });
  }

  function setSaveShareStatus(text) {
    const status = $('saveShareStatus');
    if (status) status.textContent = text;
  }

  function shareDirectlyFromSaveDialog() {
    let payload;
    try {
      payload = buildSharePayload();
    } catch (error) {
      console.error(error);
      setSaveShareStatus('生成专属链接失败，请重试');
      return;
    }

    // This button click is itself a fresh user activation, so share immediately
    // without closing the save dialog or opening the separate share panel.
    triggerSystemShareImmediately(payload.url, payload.title);
    copyText(payload.url).then(copied => {
      setSaveShareStatus(copied ? '专属链接已复制' : '复制失败，请重试');
    });
  }

  function installStyles() {
    if (document.getElementById('share-save-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'share-save-ui-style';
    style.textContent = `
      .share-panel-actions .share-copy-and-share{width:100%;min-height:44px;font-size:14px;font-weight:800}
      .save-dialog .save-dialog-heading{display:flex!important;align-items:center!important;gap:12px;margin:0 0 16px!important}
      .save-dialog .save-dialog-heading .dialog-icon{display:grid!important;place-items:center!important;width:40px!important;height:40px!important;flex:0 0 40px!important;margin:0!important;border-radius:12px}
      .save-dialog .save-dialog-heading h3{margin:0!important;padding:0!important;font-size:21px!important;line-height:1.2!important;color:#172033}
      .save-dialog .save-persistence-box{margin:0 0 16px;padding:15px;border:1px solid #e7bd72;border-radius:14px;background:linear-gradient(145deg,#fff8e8,#f1f7ff)}
      .save-dialog .save-persistence-title{display:flex;align-items:center;gap:9px;color:#123d70;font-size:16px;font-weight:900;line-height:1.35}
      .save-dialog .save-persistence-title svg{width:20px;height:20px;fill:none;stroke:#2563eb;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
      .save-dialog .save-persistence-box>p{margin:9px 0 0!important;color:#3f536c!important;font-size:14px!important;line-height:1.65!important;font-weight:650!important}
      .save-dialog .save-persistence-box>p strong{color:#a84d08;font-weight:900}
      .save-dialog .save-persistent-option{margin-top:13px;padding-top:13px;border-top:1px dashed #d4bd91}
      .save-dialog .save-persistent-option strong{display:block;margin-bottom:5px;color:#0f4e92;font-size:15px;line-height:1.4;font-weight:900}
      .save-dialog .save-persistent-option span{display:block;color:#425d79;font-size:13.5px;line-height:1.65;font-weight:650}
      .save-dialog .save-persistent-option button{width:100%;margin-top:11px;min-height:46px;border:1px solid #78aae5;border-radius:11px;background:linear-gradient(135deg,#eaf3ff,#e5f7f1);color:#0f56a5;font-size:14px;font-weight:900;cursor:pointer}
      .save-dialog .save-persistent-option button:hover{background:#e2efff}
      .save-dialog .save-share-status{min-height:18px;margin:7px 0 0!important;color:#08795b!important;font-size:12px!important;line-height:1.4;font-weight:800}
      .save-dialog .save-local-intro{margin:0 0 10px!important;color:#344f6f!important;font-size:13.5px!important;line-height:1.5!important;font-weight:850!important}
      @media(max-width:720px){
        .save-dialog .save-dialog-heading{gap:10px;margin-bottom:13px!important}
        .save-dialog .save-dialog-heading .dialog-icon{width:36px!important;height:36px!important;flex-basis:36px!important}
        .save-dialog .save-dialog-heading h3{font-size:20px!important}
        .save-dialog .save-persistence-box{padding:13px;margin-bottom:14px}
        .save-dialog .save-persistence-title{font-size:15px}
        .save-dialog .save-persistence-box>p{font-size:13px!important}
        .save-dialog .save-persistent-option strong{font-size:14px}
        .save-dialog .save-persistent-option span{font-size:12.75px}
        .save-dialog .save-persistent-option button{min-height:45px;font-size:14px}
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
      shareFromFloatingButton();
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
      shareFromPanelButton();
    });

    window.__mortgageShareNow = shareFromPanelButton;
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
      <p>方案只保存在这个浏览器中，<strong>不会自动同步</strong>到其他设备。更换设备、使用无痕模式或清理浏览器数据后，<strong>本地方案可能丢失</strong>。</p>
      <div class="save-persistent-option">
        <strong>重要方案建议同时保存专属链接</strong>
        <span>专属链接包含当前完整房贷方案，可以收藏、发送给自己或跨设备打开并自动恢复。</span>
        <button id="saveDialogShare" type="button">生成并分享专属链接</button>
        <p id="saveShareStatus" class="save-share-status" role="status" aria-live="polite"></p>
      </div>`;
    form.querySelector('.save-dialog-heading').insertAdjacentElement('afterend', guide);

    if (existingIntro?.tagName === 'P') {
      existingIntro.textContent = '本地保存方案名称：';
      existingIntro.classList.add('save-local-intro');
      guide.insertAdjacentElement('afterend', existingIntro);
    }

    $('saveDialogShare')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      shareDirectlyFromSaveDialog();
    });

    return true;
  }

  function installAll() {
    installStyles();
    installLiveTitle();
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