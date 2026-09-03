(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let installed = false;

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
    if (installed) return true;
    const actions = document.querySelector('.share-panel-actions');
    const field = $('shareUrlValue');
    const status = $('sharePanelStatus');
    if (!actions || !field || !status) return false;

    installed = true;
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

    const style = document.createElement('style');
    style.textContent = '.share-panel-actions .share-copy-and-share{width:100%;min-height:44px;font-size:14px;font-weight:700}';
    document.head.appendChild(style);
    return true;
  }

  if (!installCombinedAction()) {
    const observer = new MutationObserver(() => {
      if (installCombinedAction()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
  }
})();
