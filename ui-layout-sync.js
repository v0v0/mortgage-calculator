(() => {
  const $ = id => document.getElementById(id);
  let syncing = false;

  function normalizeRateBadge() {
    const badge = $('dataBadge');
    if (!badge) return;
    const match = badge.textContent.match(/(?:利率快照|利率更新)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (match) badge.textContent = `利率更新 ${match[1]}`;
  }

  function hiddenMethodButton(method) {
    return document.querySelector(`#repaymentMethodTabs button[data-value="${method}"]`);
  }

  function detailMethodButton(method) {
    return document.querySelector(`#detailMethodTabs button[data-value="${method}"]`);
  }

  function activeDetailMethod() {
    return document.querySelector('#detailMethodTabs button.active')?.dataset.value || 'equalPayment';
  }

  function activeHiddenMethod() {
    return document.querySelector('#repaymentMethodTabs button.active')?.dataset.value || 'equalPayment';
  }

  function syncPrimaryFromDetail() {
    if (syncing) return;
    const method = activeDetailMethod();
    if (method === activeHiddenMethod()) return;
    const target = hiddenMethodButton(method);
    if (!target) return;
    syncing = true;
    target.click();
    syncing = false;
  }

  function syncDetailFromMethod(method) {
    if (syncing || !method || method === activeDetailMethod()) return;
    const target = detailMethodButton(method);
    if (!target) return;
    syncing = true;
    target.click();
    syncing = false;
  }

  function install() {
    const badge = $('dataBadge');
    if (badge) {
      normalizeRateBadge();
      new MutationObserver(normalizeRateBadge).observe(badge, { childList:true, characterData:true, subtree:true });
    }

    $('detailMethodTabs')?.addEventListener('click', event => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      setTimeout(syncPrimaryFromDetail, 0);
    });

    $('comparison')?.addEventListener('click', event => {
      const card = event.target.closest('.compare-card[data-method]');
      if (!card) return;
      setTimeout(() => syncDetailFromMethod(card.dataset.method), 0);
    });

    let attempts = 0;
    const timer = setInterval(() => {
      normalizeRateBadge();
      syncPrimaryFromDetail();
      if (++attempts >= 20) clearInterval(timer);
    }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
