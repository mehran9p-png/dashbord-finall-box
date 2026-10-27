/**
 * js/sync.js — همگام‌سازی قیمت‌ها از data/prices.json و APIهای عمومی بدون نیاز به کلید
 * (هیچ کلید API در سمت کلاینت وجود ندارد؛ دریافت قیمت بورس از طریق فایل data/prices.json تولیدشده توسط GitHub Actions یا CDN عمومی TSETMC انجام می‌شود)
 */
(function(window) {
  'use strict';

  const { state, pNum, normFa, KNOWN_INSCODES, KEY_PR, safeSetStorage, saveP } = window.WD_DATA;
  const { getStockLiveObj } = window.WD_COMPUTE;

  function normalizeTomanJS(rawVal, isRial = false) {
    let n = pNum(rawVal, 0);
    if (n <= 0) return null;
    if (isRial || n >= 1000000) n = n / 10;
    n = Math.round(n);
    return (n >= 55000 && n <= 950000) ? n : null;
  }

  async function fetchWithTimeout(url, timeoutMs = 4500) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (r.ok) return await r.text();
    } catch (_) {
      clearTimeout(tid);
    }
    return null;
  }

  async function updateLiveCryptoPrices(forceOverrideManual = false) {
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    // ۱. CoinGecko (عمومی و بدون کلید)
    try {
      const txt = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&_t=${Date.now()}`, 4000);
      if (txt) {
        const dCg = JSON.parse(txt);
        [['BTC', 'bitcoin'], ['ETH', 'ethereum'], ['SOL', 'solana']].forEach(([sym, id]) => {
          if (state.prices.crypto?.[sym]?.isManual && !forceOverrideManual) return;
          const p = pNum(dCg?.[id]?.usd, 0);
          if (p > 0) {
            state.prices.crypto[sym] = { ...state.prices.crypto[sym], priceUsd: Number(p.toFixed(2)), source: 'CoinGecko', isManual: false, updatedAt: nowIso };
            updatedCount++;
          }
        });
        if (updatedCount === 3) return 3;
      }
    } catch (_) {}

    // ۲. Coinbase Spot (عمومی و بدون کلید)
    await Promise.all(['BTC', 'ETH', 'SOL'].map(async sym => {
      if (state.prices.crypto?.[sym]?.isManual && !forceOverrideManual) return;
      if (state.prices.crypto?.[sym]?.updatedAt === nowIso) return;
      try {
        const txt = await fetchWithTimeout(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`, 4000);
        if (txt) {
          const p = pNum(JSON.parse(txt)?.data?.amount, 0);
          if (p > 0) {
            state.prices.crypto[sym] = { ...state.prices.crypto[sym], priceUsd: Number(p.toFixed(2)), source: 'Coinbase', isManual: false, updatedAt: nowIso };
            updatedCount++;
          }
        }
      } catch (_) {}
    }));

    return updatedCount;
  }

  async function updateLiveTsetmcPublic(forceOverrideManual = false) {
    let count = 0;
    const nowIso = new Date().toISOString();
    await Promise.all((state.portfolio.stocks || []).map(async s => {
      const curObj = getStockLiveObj(s.symbol);
      if (curObj?.isManual && !forceOverrideManual) return;
      if (curObj && !curObj.stale) return;
      const code = s.insCode || KNOWN_INSCODES[normFa(s.symbol)];
      if (!code) return;
      try {
        const txt = await fetchWithTimeout(`https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/${code}`, 3800);
        if (txt) {
          const info = JSON.parse(txt)?.closingPriceInfo || {};
          const rawRial = pNum(info.pDrCotVal || info.pClosing, 0);
          const prevRial = pNum(info.priceYesterday, 0);
          if (rawRial > 0) {
            const chg = prevRial > 0 ? Number((((rawRial - prevRial) / prevRial) * 100).toFixed(2)) : 0;
            state.prices.stocks[s.symbol] = {
              priceToman: Math.round(rawRial / 10),
              dailyChangePct: chg,
              source: 'TSETMC',
              isManual: false,
              stale: false,
              suspect: Math.abs(chg) > 15,
              updatedAt: nowIso
            };
            count++;
          }
        }
      } catch (_) {}
    }));
    return count;
  }

  window.syncAllLiveMarkets = async function(forceOverrideManual = false) {
    const syncBtn = document.getElementById('syncBtnMain');
    if (syncBtn) syncBtn.classList.add('spinning');
    state.syncStatus = 'loading';
    state.syncErrorMessage = '';
    if (typeof window.renderTerminal === 'function') window.renderTerminal();

    let anySuccess = false;

    // ۱. دریافت فایل data/prices.json از ریپو (تولیدشده توسط GitHub Actions با کلید امن سرور)
    try {
      const txtGit = await fetchWithTimeout(`data/prices.json?_t=${Date.now()}`, 4500);
      if (txtGit) {
        const dGit = JSON.parse(txtGit);
        const gitTime = dGit?.lastUpdated || new Date().toISOString();
        const gUsdt = normalizeTomanJS(dGit?.fx?.usdtToman, false);
        if (gUsdt && (!state.prices.fx?.isManual || forceOverrideManual)) {
          state.prices.fx.usdtToman = gUsdt;
          state.prices.fx.freeUsdToman = Math.round(gUsdt * 0.996);
          state.prices.fx.source = dGit.fx?.source || 'گیت‌هاب';
          state.prices.fx.isManual = false;
          state.prices.fx.updatedAt = gitTime;
          anySuccess = true;
        }
        if (dGit?.stocks) {
          Object.entries(dGit.stocks).forEach(([sym, obj]) => {
            const curS = getStockLiveObj(sym);
            if (curS?.isManual && !forceOverrideManual) return;
            if (pNum(obj?.priceToman, 0) > 0) {
              const chg = pNum(obj.dailyChangePct, 0);
              state.prices.stocks[sym] = {
                priceToman: pNum(obj.priceToman, 0),
                dailyChangePct: chg,
                source: obj.source || 'گیت‌هاب',
                isManual: false,
                stale: Boolean(obj.stale),
                suspect: Boolean(obj.suspect || Math.abs(chg) > 15),
                updatedAt: obj.updatedAt || gitTime
              };
              anySuccess = true;
            }
          });
        }
        if (dGit?.crypto) {
          ['BTC', 'ETH', 'SOL'].forEach(c => {
            if (state.prices.crypto?.[c]?.isManual && !forceOverrideManual) return;
            if (pNum(dGit.crypto[c]?.priceUsd, 0) > 0) {
              state.prices.crypto[c] = {
                ...state.prices.crypto[c],
                ...dGit.crypto[c],
                source: dGit.crypto[c].source || 'گیت‌هاب',
                isManual: false,
                updatedAt: gitTime
              };
              anySuccess = true;
            }
          });
        }
        state.prices.lastUpdated = gitTime;
      }
    } catch (_) {}

    // ۲. دریافت تاریخچه از data/history.json در صورت وجود
    try {
      const txtHist = await fetchWithTimeout(`data/history.json?_t=${Date.now()}`, 4000);
      if (txtHist) {
        const hArr = JSON.parse(txtHist);
        if (Array.isArray(hArr) && hArr.length > 2 && state.history.length <= 15) {
          state.history = hArr;
        }
      }
    } catch (_) {}

    // ۳. استعلام مستقیم از APIهای عمومی بدون کلید (کریپتو، تترلند، TSETMC)
    const results = await Promise.allSettled([
      updateLiveCryptoPrices(forceOverrideManual),
      updateLiveTsetmcPublic(forceOverrideManual),
      (async () => {
        if (state.prices.fx?.isManual && !forceOverrideManual) return 0;
        const txt = await fetchWithTimeout('https://api.tetherland.com/currencies', 4000);
        if (txt) {
          const v = normalizeTomanJS(JSON.parse(txt)?.data?.currencies?.USDT?.price, false);
          if (v) {
            state.prices.fx.usdtToman = v;
            state.prices.fx.freeUsdToman = Math.round(v * 0.996);
            state.prices.fx.source = 'تترلند';
            state.prices.fx.isManual = false;
            state.prices.fx.updatedAt = new Date().toISOString();
            return 1;
          }
        }
        return 0;
      })()
    ]);

    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value > 0) anySuccess = true;
    });

    if (anySuccess) {
      state.prices.lastUpdated = new Date().toISOString();
      state.syncStatus = 'success';
    } else {
      state.syncStatus = 'idle';
      state.syncErrorMessage = 'استفاده از آخرین قیمت‌های کش‌شده (در محیط آفلاین یا محدودیت شبکه)';
    }

    safeSetStorage(KEY_PR, JSON.stringify(state.prices));
    saveP();
    if (typeof window.renderTerminal === 'function') window.renderTerminal();
    if (syncBtn) syncBtn.classList.remove('spinning');
  };
})(window);
