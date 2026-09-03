(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let shareInstalled = false;
  let saveInstalled = false;

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

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

  function installStyles() {
    if (document.getElementById('share-save-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'share-save-ui-style';
    style.textContent = `
      .share-panel-actions .share-copy-and-share{width:100%;min-height:44px;font-size:14px;font-weight:700}
      .save-dialog .save-persistence-box{margin:12px 0 14px;padding:12px;border:1px solid #d5e4f6;border-radius:13px;background:linear-gradient(145deg,#f5f9ff,#f2fbf8)}
      .save-dialog .save-persistence-title{display:flex;align-items:center;gap:7px;color:#23466f;font-size:12px;font-weight:800}
      .save-dialog .save-persistence-title svg{width:17px;height:17px;fill:none;stroke:#2563eb;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
      .save-dialog .save-persistence-box p{margin:6px 0 0!important;color:#66788e!important;font-size:11px!important;line-height:1.55}
      .save-dialog .save-persistence-box p strong{color:#304b6b}
      .save-dialog .save-persistent-option{margin-top:10px;padding-top:10px;border-top:1px dashed #cfdeed}
      .save-dialog .save-persistent-option span{display:block;color:#547086;font-size:11px;line-height:1.5}
      .save-dialog .save-persistent-option button{width:100%;margin-top:8px;min-height:40px;border:1px solid #b9d4f5;border-radius:10px;background:#eef6ff;color:#1656a5;font-size:12px;font-weight:800;cursor:pointer}
      .save-dialog .save-persistent-option button:hover{background:#e5f1ff}
      .save-dialog .save-local-intro{margin:0 0 10px!important;color:#61748b!important;font-size:11px!important;font-weight:700}
      @media(max-width:720px){
        .save-dialog .save-persistence-box{margin:10px 0 12px;padding:10px}
        .save-dialog .save-persistent-option button{min-height:42px;font-size:13px}
      }
    `;
    document.head.appendChild(style);
  }

  function setCopiedStatus() {
    const status = $('sharePanelStatus');
    const value = $('shareUrlValue')?.value || '';
    if (!status || !/^https?:\/\//.test(value)) return;
    if (status.textContent !== '已复制') status.textContent = '已复制';
  }

  function normalizeShareStatus() {
    const status = $('sharePanelStatus');
    if (!status || status.dataset.compactStatus === '1') return;
    status.dataset.compactStatus = '1';

    const observer = new MutationObserver(() => {
      const text = status.textContent || '';
      if (/1\s*秒|链接已复制|已取消系统分享|系统分享已打开|浏览器阻止|不支持系统分享|无法打开系统分享/.test(text)) {
        setCopiedStatus();
      }
    });
    observer.observe(status, { childList:true, characterData:true, subtree:true });
  }

  function installCombinedAction() {
    if (shareInstalled) return true;
    const actions = document.querySelector('.share-panel-actions');
    const field = $('shareUrlValue');
    const status = $('sharePanelStatus');
    if (!actions || !field || !status) return false;

    shareInstalled = true;
    actions.replaceChildren();

    const button = document.createElement('button');
    button.id = 'shareCopyAndShare';
    button.type = 'button';
    button.className = 'primary share-copy-and-share';
    button.textContent = '复制并分享';
    actions.appendChild(button);

    const label = field.closest('.share-url-label');
    if (label) label.insertAdjacentElement('afterend', actions);

    button.addEventListener('click', async () => {
      const url = field.value || '';
      if (!/^https?:\/\//.test(url)) return;

      await copyText(url);
      setCopiedStatus();

      if (!navigator.share) return;
      try {
        await navigator.share({
          title: '房贷利率计算器',
          text: '打开后自动应用我分享的房贷测算方案',
          url
        });
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('系统分享未能打开', error);
      } finally {
        setCopiedStatus();
      }
    });

    normalizeShareStatus();
    return true;
  }

  function installSavePersistenceGuide() {
    if (saveInstalled) return true;
    const dialog = $('saveDialog');
    const form = $('saveDialogForm');
    const title = form?.querySelector('h3');
    if (!dialog || !form || !title) return false;

    saveInstalled = true;
    const existingIntro = title.nextElementSibling;

    const guide = document.createElement('div');
    guide.className = 'save-persistence-box';
    guide.innerHTML = `
      <div class="save-persistence-title">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 5v5h8V5M8 19v-6h8v6"/></svg>
        <span>本地方案仅保存在当前浏览器</span>
      </div>
      <p>更换设备、使用无痕模式或清理浏览器数据后，<strong>本地方案可能丢失</strong>。</p>
      <div class="save-persistent-option">
        <span>想长期保留或跨设备查看？可以生成一个包含当前完整方案的专属链接，自行收藏或发送给自己。</span>
        <button id="saveDialogShare" type="button">生成并分享专属链接</button>
      </div>`;
    title.insertAdjacentElement('afterend', guide);

    if (existingIntro?.tagName === 'P') {
      existingIntro.textContent = '也可以给当前浏览器中的本地方案命名：';
      existingIntro.classList.add('save-local-intro');
    }

    $('saveDialogShare')?.addEventListener('click', event => {
      event.preventDefault();
      if (dialog.open) dialog.close();
      requestAnimationFrame(() => $('floatShare')?.click());
    });

    return true;
  }

  function installAll() {
    installStyles();
    const shareReady = installCombinedAction();
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
