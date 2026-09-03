(() => {
  const $ = id => document.getElementById(id);
  const CELL_CLASSES = ['cell-meta','cell-total','cell-commercial','cell-provident','head-meta','head-total','head-commercial','head-provident','col-payment','col-principal','col-interest','col-remaining','col-opening','col-cumulative','col-extra'];
  let syncing = false;
  let tableNormalizationQueued = false;
  let html2canvasPromise = null;

  function installV3Styles() {
    if (document.querySelector('link[data-ux-v3]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './ux-v3.css';
    link.dataset.uxV3 = '1';
    document.head.appendChild(link);
  }

  function normalizeRateBadge() {
    const badge = $('dataBadge');
    if (!badge) return;
    const match = badge.textContent.match(/(?:利率快照|利率更新)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (!match) return;
    const text = `利率更新 ${match[1]}`;
    if (badge.textContent !== text) badge.textContent = text;
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

  function requestChartRedraw() {
    window.dispatchEvent(new Event('resize'));
  }

  function hasEffectivePrepayment() {
    return [...document.querySelectorAll('.prepayment-row')].some(row => {
      const month = Number(row.querySelector('[data-field="month"]')?.value || 0);
      const amount = Number(row.querySelector('[data-field="amount"]')?.value || 0);
      return month > 0 && amount > 0;
    });
  }

  function groupClass(cell) {
    if (cell.classList.contains('commercial-group')) return 'commercial';
    if (cell.classList.contains('provident-group')) return 'provident';
    return 'total';
  }

  function columnClass(text) {
    const value = String(text || '').trim();
    if (value.includes('提前')) return 'col-extra';
    if (value.includes('年初')) return 'col-opening';
    if (value.includes('剩余') || value.includes('年末')) return 'col-remaining';
    if (value.includes('累计')) return 'col-cumulative';
    if (value.includes('利息')) return 'col-interest';
    if (value.includes('本金')) return 'col-principal';
    if (value.includes('还款') || value.includes('月供')) return 'col-payment';
    return '';
  }

  function removeSubColumn(table, headerText, groupSelector) {
    const thead = table?.tHead;
    if (!thead || thead.rows.length < 2) return false;
    const groupRow = thead.rows[0];
    const subRow = thead.rows[1];
    const subCells = [...subRow.cells];
    const subIndex = subCells.findIndex(cell => cell.textContent.trim() === headerText);
    if (subIndex < 0) return false;
    const leading = [...groupRow.cells].filter(cell => cell.rowSpan > 1).length;
    const bodyIndex = leading + subIndex;
    subCells[subIndex].remove();
    [...table.tBodies].forEach(tbody => [...tbody.rows].forEach(row => row.cells[bodyIndex]?.remove()));
    const group = groupRow.querySelector(groupSelector);
    if (group && group.colSpan > 1) group.colSpan -= 1;
    return true;
  }

  function decorateTable(table) {
    const thead = table?.tHead;
    if (!thead || thead.rows.length < 2 || !table.tBodies.length) return;
    table.querySelectorAll('th,td').forEach(cell => cell.classList.remove(...CELL_CLASSES));

    const groupRow = thead.rows[0];
    const subRow = thead.rows[1];
    const bodyRows = [...table.tBodies[0].rows];
    const leadingCells = [...groupRow.cells].filter(cell => cell.rowSpan > 1);
    const leading = leadingCells.length;

    leadingCells.forEach(cell => cell.classList.add('head-meta'));
    bodyRows.forEach(row => {
      for (let i = 0; i < leading; i++) row.cells[i]?.classList.add('cell-meta');
    });

    let bodyOffset = leading;
    let subOffset = 0;
    [...groupRow.cells].filter(cell => cell.colSpan > 1).forEach(groupCell => {
      const group = groupClass(groupCell);
      const span = Number(groupCell.colSpan || 1);
      for (let i = 0; i < span; i++) {
        const header = subRow.cells[subOffset + i];
        const typeClass = columnClass(header?.textContent);
        header?.classList.add(`head-${group}`);
        if (typeClass) header?.classList.add(typeClass);
        bodyRows.forEach(row => {
          const cell = row.cells[bodyOffset + i];
          cell?.classList.add(`cell-${group}`);
          if (typeClass) cell?.classList.add(typeClass);
        });
      }
      subOffset += span;
      bodyOffset += span;
    });
  }

  function normalizeTables() {
    tableNormalizationQueued = false;
    const annualTable = $('annualBody')?.closest('table');
    const monthlyTable = $('monthlyBody')?.closest('table');
    if (annualTable) {
      removeSubColumn(annualTable, '年末本金', '.total-group');
      decorateTable(annualTable);
    }
    if (monthlyTable) {
      if (!hasEffectivePrepayment()) removeSubColumn(monthlyTable, '提前还款', '.total-group');
      decorateTable(monthlyTable);
    }
  }

  function queueNormalizeTables(delay = 0) {
    if (tableNormalizationQueued) return;
    tableNormalizationQueued = true;
    setTimeout(normalizeTables, delay);
  }

  function observeDetailTables() {
    const tables = [$('annualBody')?.closest('table'), $('monthlyBody')?.closest('table')].filter(Boolean);
    const observer = new MutationObserver(() => queueNormalizeTables(0));
    tables.forEach(table => observer.observe(table, { childList:true, subtree:true }));
    document.querySelector('.form-card')?.addEventListener('input', () => queueNormalizeTables(20), true);
    document.querySelector('.form-card')?.addEventListener('change', () => queueNormalizeTables(20), true);
    $('detailMethodTabs')?.addEventListener('click', () => queueNormalizeTables(20), true);
    $('detailViewTabs')?.addEventListener('click', () => queueNormalizeTables(20), true);
    $('loanTypeTabs')?.addEventListener('click', () => queueNormalizeTables(20), true);
    queueNormalizeTables(40);
  }

  function prepareExportButton() {
    const button = $('floatPdf');
    if (!button) return;
    button.title = '保存房贷结果长图';
    button.setAttribute('aria-label', '保存房贷结果长图');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M5 17l4.5-4.5 3.2 3.2 2-2L19 18"/></svg>';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      exportLongImage();
    }, true);
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`无法加载 ${url}`));
      document.head.appendChild(script);
    });
  }

  function ensureHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
      .catch(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'))
      .then(() => {
        if (!window.html2canvas) throw new Error('html2canvas 加载失败');
        return window.html2canvas;
      });
    return html2canvasPromise;
  }

  function fillExportHeader() {
    const city = $('city')?.selectedOptions?.[0]?.textContent?.trim() || '';
    const loanType = document.querySelector('#loanTypeTabs button.active')?.textContent?.trim() || '';
    const method = document.querySelector('#detailMethodTabs button.active')?.textContent?.trim() || '';
    const header = $('printResultHeader');
    if (!header) return;
    header.innerHTML = `<h1>房贷利率计算器 · 测算结果</h1><p>${city} · ${loanType} · ${method} · 房屋总价 ${$('housePrice')?.value || 0} 万 · 贷款 ${$('loanAmount')?.value || 0} 万</p><small>生成时间：${new Date().toLocaleString('zh-CN')}</small>`;
  }

  function downloadCanvas(canvas) {
    const city = $('city')?.selectedOptions?.[0]?.textContent?.trim() || '房贷';
    const method = document.querySelector('#detailMethodTabs button.active')?.textContent?.trim() || '测算';
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const filename = `房贷测算-${city}-${method}-${date}.png`;
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('PNG 编码失败'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        resolve();
      }, 'image/png');
    });
  }

  async function exportLongImage() {
    const button = $('floatPdf');
    const area = $('resultsExportArea');
    if (!button || !area || button.classList.contains('exporting')) return;
    button.classList.add('exporting');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const monthlyWrap = document.querySelector('.monthly-wrap');
    const previous = {
      areaWidth: area.style.width,
      areaMaxWidth: area.style.maxWidth,
      monthlyMaxHeight: monthlyWrap?.style.maxHeight || '',
      monthlyOverflow: monthlyWrap?.style.overflow || ''
    };
    try {
      fillExportHeader();
      document.body.classList.add('image-exporting');
      if (monthlyWrap) {
        monthlyWrap.style.maxHeight = 'none';
        monthlyWrap.style.overflow = 'visible';
      }
      const activeTable = document.querySelector('.detail-panel.active table');
      const desiredWidth = Math.min(2200, Math.max(1100, Math.round(area.getBoundingClientRect().width), (activeTable?.scrollWidth || 0) + 48));
      area.style.width = `${desiredWidth}px`;
      area.style.maxWidth = 'none';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      queueNormalizeTables(0);
      await new Promise(resolve => setTimeout(resolve, 30));
      const html2canvas = await ensureHtml2Canvas();
      const height = area.scrollHeight;
      const scale = height > 9000 ? 1 : height > 6000 ? 1.15 : 1.5;
      let canvas;
      try {
        canvas = await html2canvas(area, {
          backgroundColor:'#f3f7fd',
          scale,
          useCORS:true,
          logging:false,
          width:area.scrollWidth,
          height:area.scrollHeight,
          windowWidth:area.scrollWidth,
          windowHeight:area.scrollHeight,
          scrollX:0,
          scrollY:0
        });
      } catch (error) {
        canvas = await html2canvas(area, {
          backgroundColor:'#f3f7fd',
          scale:1,
          useCORS:true,
          logging:false,
          width:area.scrollWidth,
          height:area.scrollHeight,
          windowWidth:area.scrollWidth,
          windowHeight:area.scrollHeight
        });
      }
      await downloadCanvas(canvas);
    } catch (error) {
      console.error('长图导出失败', error);
      window.alert('长图生成失败，请刷新页面后重试。');
    } finally {
      document.body.classList.remove('image-exporting');
      area.style.width = previous.areaWidth;
      area.style.maxWidth = previous.areaMaxWidth;
      if (monthlyWrap) {
        monthlyWrap.style.maxHeight = previous.monthlyMaxHeight;
        monthlyWrap.style.overflow = previous.monthlyOverflow;
      }
      button.disabled = false;
      button.classList.remove('exporting');
      button.removeAttribute('aria-busy');
      requestChartRedraw();
    }
  }

  function install() {
    installV3Styles();
    const badge = $('dataBadge');
    if (badge) {
      normalizeRateBadge();
      new MutationObserver(normalizeRateBadge).observe(badge, { childList:true, characterData:true, subtree:true });
    }

    $('detailMethodTabs')?.addEventListener('click', event => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      setTimeout(() => {
        syncPrimaryFromDetail();
        requestChartRedraw();
        queueNormalizeTables(10);
      }, 0);
    });

    $('detailViewTabs')?.addEventListener('click', event => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      setTimeout(() => {
        if (button.dataset.value === 'annual') requestChartRedraw();
        queueNormalizeTables(10);
      }, 0);
    });

    $('comparison')?.addEventListener('click', event => {
      const card = event.target.closest('.compare-card[data-method]');
      if (!card) return;
      setTimeout(() => {
        syncDetailFromMethod(card.dataset.method);
        requestChartRedraw();
      }, 0);
    });

    prepareExportButton();
    observeDetailTables();

    let attempts = 0;
    const timer = setInterval(() => {
      normalizeRateBadge();
      syncPrimaryFromDetail();
      queueNormalizeTables(0);
      if (++attempts >= 20) clearInterval(timer);
    }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
