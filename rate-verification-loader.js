(() => {
  const nativeFetch = window.fetch.bind(window);
  const RATE_PATH = 'data/mortgage-rates.json';
  const VERIFY_PATH = './data/rate-verification-2026-09-03.json';
  const CURRENT_STATE_KEY = 'mortgage-calculator-state-v2';
  const LEGACY_STATE_KEY = 'mortgage-calculator-state-v1';
  const SCOPED_STATE_PREFIX = 'mortgage-calculator-state-v3:';
  const CITY_NAMES = {
    guiyang: '贵阳',
    taiyuan: '太原',
    baoding: '保定',
    zhuhai: '珠海',
    luoyang: '洛阳'
  };

  if (location.hash.startsWith('#s=')) {
    window.__mortgageSharePayload = location.hash.slice(3);
    history.replaceState(null, '', location.pathname + location.search);
  }

  const nativeStorageGet = Storage.prototype.getItem;
  const nativeStorageSet = Storage.prototype.setItem;
  const nativeStorageRemove = Storage.prototype.removeItem;

  function currentStateScope() {
    const params = new URLSearchParams(location.search);
    params.sort();
    const query = params.toString();
    const sharePayload = window.__mortgageSharePayload || '';
    return `${location.pathname}${query ? `?${query}` : ''}${sharePayload ? `#s=${sharePayload}` : ''}`;
  }

  const stateScope = currentStateScope();
  const scopedStateKey = `${SCOPED_STATE_PREFIX}${encodeURIComponent(stateScope)}`;
  const isDefaultStateScope = !location.search && !window.__mortgageSharePayload;

  function enrichSavedState(value) {
    try {
      const state = JSON.parse(value);
      if (!state || typeof state !== 'object' || Array.isArray(state)) return value;
      const customYear = document.getElementById('customYear');
      const advancedDetails = document.getElementById('advancedDetails');
      if (customYear) state.customYear = customYear.value;
      if (advancedDetails) state.advancedDetailsOpen = advancedDetails.open;
      return JSON.stringify(state);
    } catch (_) {
      return value;
    }
  }

  function installScopedStateStorage() {
    Storage.prototype.getItem = function scopedGetItem(key) {
      if (this === localStorage && key === CURRENT_STATE_KEY) {
        try {
          const tabState = nativeStorageGet.call(sessionStorage, scopedStateKey);
          if (tabState !== null) return tabState;
        } catch (_) {}
        try {
          const persistedState = nativeStorageGet.call(localStorage, scopedStateKey);
          if (persistedState !== null) {
            try { nativeStorageSet.call(sessionStorage, scopedStateKey, persistedState); } catch (_) {}
            return persistedState;
          }
        } catch (_) {}
        if (isDefaultStateScope) return nativeStorageGet.call(localStorage, CURRENT_STATE_KEY);
        return null;
      }

      // Prevent the old global v1 state from leaking into a parameterized/share page.
      if (this === localStorage && key === LEGACY_STATE_KEY && !isDefaultStateScope) return null;
      return nativeStorageGet.call(this, key);
    };

    Storage.prototype.setItem = function scopedSetItem(key, value) {
      if (this === localStorage && key === CURRENT_STATE_KEY) {
        const state = enrichSavedState(String(value));
        try { nativeStorageSet.call(sessionStorage, scopedStateKey, state); } catch (_) {}
        nativeStorageSet.call(localStorage, scopedStateKey, state);
        return;
      }
      return nativeStorageSet.call(this, key, value);
    };

    Storage.prototype.removeItem = function scopedRemoveItem(key) {
      if (this === localStorage && key === CURRENT_STATE_KEY) {
        try { nativeStorageRemove.call(sessionStorage, scopedStateKey); } catch (_) {}
        try { nativeStorageRemove.call(localStorage, scopedStateKey); } catch (_) {}
        if (isDefaultStateScope) {
          try { nativeStorageRemove.call(localStorage, CURRENT_STATE_KEY); } catch (_) {}
        }
        return;
      }
      if (this === localStorage && key === LEGACY_STATE_KEY && !isDefaultStateScope) return;
      return nativeStorageRemove.call(this, key);
    };
  }

  function readScopedStateDirectly() {
    let raw = null;
    try { raw = nativeStorageGet.call(sessionStorage, scopedStateKey); } catch (_) {}
    if (raw === null) {
      try { raw = nativeStorageGet.call(localStorage, scopedStateKey); } catch (_) {}
    }
    if (raw === null && isDefaultStateScope) {
      try { raw = nativeStorageGet.call(localStorage, CURRENT_STATE_KEY); } catch (_) {}
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function restoreSupplementalState() {
    const state = readScopedStateDirectly();
    if (!state) return;
    const customYear = document.getElementById('customYear');
    const advancedDetails = document.getElementById('advancedDetails');
    if (customYear && state.customYear !== undefined) customYear.value = state.customYear;
    if (advancedDetails && state.advancedDetailsOpen !== undefined) advancedDetails.open = !!state.advancedDetailsOpen;
    if (customYear && typeof window.renderYearCards === 'function') {
      try { window.renderYearCards(); } catch (_) {}
    }
  }

  function bindSupplementalAutosave() {
    const save = () => {
      if (typeof window.saveState === 'function') {
        try { window.saveState(); } catch (_) {}
      }
    };
    document.getElementById('customYear')?.addEventListener('input', save);
    document.getElementById('advancedDetails')?.addEventListener('toggle', save);
    window.addEventListener('pagehide', save);
  }

  installScopedStateStorage();
  window.addEventListener('DOMContentLoaded', () => {
    bindSupplementalAutosave();
    restoreSupplementalState();
    setTimeout(restoreSupplementalState, 200);
  }, { once: true });

  function loadShareTitlePatch() {
    if (document.querySelector('script[data-mortgage-share-title-patch]')) return;
    const patch = document.createElement('script');
    patch.src = './share-title-patch.js';
    patch.dataset.mortgageShareTitlePatch = '1';
    document.body.appendChild(patch);
  }

  function loadShareUiPatch() {
    if (document.querySelector('script[data-mortgage-share-ui-patch]')) return;
    const patch = document.createElement('script');
    patch.src = './share-ui-patch.js';
    patch.dataset.mortgageShareUiPatch = '1';
    patch.addEventListener('load', loadShareTitlePatch, { once: true });
    document.body.appendChild(patch);
  }

  function loadShareState() {
    if (document.querySelector('script[data-mortgage-share-state]')) return;
    const script = document.createElement('script');
    script.src = './share-state.js';
    script.dataset.mortgageShareState = '1';
    script.addEventListener('load', loadShareUiPatch, { once: true });
    document.body.appendChild(script);
  }

  window.addEventListener('load', loadShareState, { once: true });

  function isRateRequest(input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    return url.replace(/^\.\//, '').endsWith(RATE_PATH);
  }

  function applyCityScope(base, verification) {
    const tiers = verification.cityScope && verification.cityScope.tiers;
    if (!tiers) return;

    const existing = new Map((base.cities || []).map(city => [city.id, city]));
    const ordered = [];

    for (const [tier, cityIds] of Object.entries(tiers)) {
      for (const id of cityIds) {
        const city = existing.get(id) || { id, name: CITY_NAMES[id] || id };
        city.tier = tier;
        ordered.push(city);
      }
    }

    base.cities = ordered;
    base.cityListBasis = {
      name: verification.cityScope.basis,
      source: '第一财经·新一线城市研究所 2025 城市分级',
      sourceUrl: verification.cityScope.sourceUrl
    };
  }

  function mergeVerification(base, verification) {
    if (!base || !verification) return base;

    base.asOf = verification.asOf || base.asOf;
    applyCityScope(base, verification);

    if (Array.isArray(verification.lpr)) {
      base.lpr = base.lpr || {};
      base.lpr.oneYear = verification.lpr[0];
      base.lpr.fiveYearPlus = verification.lpr[1];
      base.lpr.publishedAt = verification.lpr[2];
    }

    if (verification.provident) {
      base.providentFundDefault = base.providentFundDefault || {};
      base.providentFundDefault.firstHome = {
        upTo5Years: verification.provident.first[0],
        over5Years: verification.provident.first[1]
      };
      base.providentFundDefault.secondHome = {
        upTo5Years: verification.provident.second[0],
        over5Years: verification.provident.second[1]
      };
      base.providentFundDefault.source = '现行个人住房公积金贷款利率（全国基准）';
      base.providentFundDefault.sourceUrl = verification.provident.url;
      base.providentFundDefault.effective = verification.provident.effective;
    }

    for (const city of base.cities || []) {
      const row = verification.rates && verification.rates[city.id];
      if (!row) continue;

      const [rate, spreadBP, qualityCode, confidenceCode, sourceId] = row;
      const source = (verification.sources && verification.sources[sourceId]) || [];
      const qualityLabel = (verification.legend && verification.legend[qualityCode]) || qualityCode;
      const confidenceLabel = (verification.legend && verification.legend[confidenceCode]) || confidenceCode;
      const sourceTitle = source[0] || '市场参考';
      const sourceDate = source[2] || verification.asOf;

      city.commercial = {
        ...(city.commercial || {}),
        benchmark: 'LPR5Y',
        rate,
        spreadBP,
        quality: qualityCode,
        qualityLabel,
        confidence: confidenceCode,
        confidenceLabel,
        source: `${sourceTitle} · ${qualityLabel} · 置信度${confidenceLabel} · ${sourceDate}`,
        sourceTitle,
        sourceUrl: source[1] || '',
        sourceDate,
        verifiedAt: verification.asOf
      };
    }

    base.verification = {
      asOf: verification.asOf,
      note: verification.note,
      legend: verification.legend,
      cityScope: verification.cityScope
    };

    return base;
  }

  window.fetch = async function verifiedRateFetch(input, init) {
    if (!isRateRequest(input)) return nativeFetch(input, init);

    const [baseResponse, verificationResponse] = await Promise.all([
      nativeFetch(input, init),
      nativeFetch(VERIFY_PATH, { cache: 'no-store' })
    ]);

    if (!baseResponse.ok || !verificationResponse.ok) return baseResponse;

    try {
      const [base, verification] = await Promise.all([
        baseResponse.json(),
        verificationResponse.json()
      ]);
      const merged = mergeVerification(base, verification);
      return new Response(JSON.stringify(merged), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (error) {
      console.warn('城市房贷利率核验快照合并失败，将使用基础利率数据。', error);
      return nativeFetch(input, init);
    }
  };
})();