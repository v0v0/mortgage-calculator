(() => {
  const nativeFetch = window.fetch.bind(window);
  const RATE_PATH = 'data/mortgage-rates.json';
  const VERIFY_PATH = './data/rate-verification-2026-09-03.json';

  function isRateRequest(input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    return url.replace(/^\.\//, '').endsWith(RATE_PATH);
  }

  function mergeVerification(base, verification) {
    if (!base || !verification) return base;

    base.asOf = verification.asOf || base.asOf;

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
      legend: verification.legend
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
