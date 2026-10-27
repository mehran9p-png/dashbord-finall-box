/**
 * js/ui.js — مدیریت رویدادها، مودال‌ها، نوار اسنک‌بار Undo، قفل PIN اختیاری،
 * انتخابگر تاریخ شمسی، ثبت سود سهام/کارمزد در دفتر کل و بکاپ هفتگی
 * (بدون استفاده از alert/confirm/prompt مسدودکننده؛ استفاده از Toast و مودال درون‌صفحه‌ای)
 */
(function(window) {
  'use strict';

  const {
    state, escapeHtml, toFa, pNum, fmtJalali, jalaliToGregorian, isoToJalaliParts,
    KEY_PRIVACY, KEY_PIN, KEY_PR, KEY_HIST, DEFAULT_PORTFOLIO,
    safeGetStorage, safeSetStorage, hashPin, validateAndSanitizePortfolioJson,
    migrateStorage, saveP, pushUndoSnapshot, popUndoSnapshot, markBackupDoneNow
  } = window.WD_DATA;

  const { computeAll, getStockLiveObj, autoDetectAssetCategory } = window.WD_COMPUTE;
  const { fmtNum, fmtMoney } = window.WD_RENDER;

  function showToast(message, withUndo = false) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const box = document.createElement('div');
    box.className = 'toast-box';
    box.innerHTML = `
      <span>${escapeHtml(message)}</span>
      ${withUndo ? `<button class="btn btn-primary" style="min-height:34px; padding:0.2rem 0.65rem; font-size:0.73rem;" onclick="window.undoLastAction()">بازگردانی (Undo)</button>` : ''}
    `;
    container.appendChild(box);
    setTimeout(() => {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 6500);
  }

  window.undoLastAction = function() {
    const restored = popUndoSnapshot();
    if (restored) {
      window.renderTerminal();
      showToast(`عملیات «${restored.label}» با موفقیت بازگردانی شد.`, false);
    }
  };

  function updateEyeIcon() {
    const svg = document.getElementById('eyeIconSvg');
    if (!svg) return;
    svg.innerHTML = state.isMasked
      ? `<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>`
      : `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>`;
  }

  // قفل PIN اختیاری
  function checkInitialPinLock() {
    const overlay = document.getElementById('pinLockOverlay');
    if (!overlay) return;
    if (state.pinLocked) {
      overlay.classList.add('open');
    } else {
      overlay.classList.remove('open');
    }
  }

  window.unlockWithPin = function() {
    const inp = document.getElementById('pinUnlockInput');
    const errEl = document.getElementById('pinUnlockError');
    const savedHash = safeGetStorage(KEY_PIN);
    if (!savedHash) {
      state.pinLocked = false;
      checkInitialPinLock();
      return;
    }
    if (hashPin(inp?.value || '') === savedHash) {
      state.pinLocked = false;
      if (inp) inp.value = '';
      if (errEl) errEl.textContent = '';
      checkInitialPinLock();
      showToast('قفل ترمینال باز شد.');
    } else {
      if (errEl) errEl.textContent = 'رمز PIN واردشده نادرست است.';
    }
  };

  window.saveOrClearPinLock = function() {
    const newPin = (document.getElementById('newPinSettingInput')?.value || '').trim();
    if (!newPin) {
      try { localStorage.removeItem(KEY_PIN); } catch (_) {}
      state.hasPin = false;
      state.pinLocked = false;
      showToast('قفل PIN غیرفعال شد.');
      return;
    }
    if (newPin.length < 4) {
      showToast('لطفاً حداقل ۴ رقم برای قفل PIN وارد کنید.');
      return;
    }
    safeSetStorage(KEY_PIN, hashPin(newPin));
    state.hasPin = true;
    document.getElementById('newPinSettingInput').value = '';
    showToast('قفل PIN با موفقیت فعال شد.');
  };

  window.lockTerminalNow = function() {
    if (!safeGetStorage(KEY_PIN)) {
      showToast('ابتدا در تنظیمات یک کد PIN چهار رقمی تعریف کنید.');
      window.openSettingsModal();
      return;
    }
    state.pinLocked = true;
    checkInitialPinLock();
  };

  // ویجت هدف مالی (saveTargetWealth)
  window.saveTargetWealth = function(val) {
    const raw = val !== undefined ? val : document.getElementById('wealthTargetInput')?.value;
    const target = Math.max(1000000, pNum(raw, 400000000));
    state.portfolio.wealthTargetToman = target;
    saveP();
    window.renderTerminal();
    showToast('هدف مالی جدید ذخیره شد.');
  };

  window.setHeroSparkRange = function(days, btn) {
    state.heroSparkDays = days;
    if (btn && btn.parentElement) {
      btn.parentElement.querySelectorAll('.btn').forEach(b => b.classList.remove('chip-active'));
      btn.classList.add('chip-active');
    }
    window.renderTerminal();
  };

  window.setStockSort = function(mode, btnEl) {
    state.portfolio.stockSortMode = mode;
    document.querySelectorAll('[id^="sortBtn_"]').forEach(b => b.classList.remove('chip-active'));
    if (btnEl) btnEl.classList.add('chip-active');
    saveP();
    window.renderTerminal();
  };

  window.toggleMobileStockExpand = function(origIdx) {
    state.expandedMobileStocks[origIdx] = !state.expandedMobileStocks[origIdx];
    window.renderTerminal();
  };

  window.loadDcaPreset = function(val) {
    const m = computeAll();
    if (val.startsWith('stock_')) {
      const idx = Number(val.split('_')[1]);
      const s = m.stocks[idx];
      if (s) {
        document.getElementById('dcaCurQty').value = s.qty;
        document.getElementById('dcaCurAvg').value = s.avgBuyToman;
        document.getElementById('dcaMarketPrice').value = s.currentPriceToman;
        document.getElementById('dcaMarketSlider').value = s.currentPriceToman;
        document.getElementById('dcaNewBudget').value = 5000000;
      }
    } else if (val.startsWith('crypto_')) {
      const sym = val.split('_')[1];
      const p = state.prices.crypto?.[sym]?.priceUsd || 68000;
      document.getElementById('dcaCurQty').value = 0.1;
      document.getElementById('dcaCurAvg').value = Math.round(p * 1.12);
      document.getElementById('dcaMarketPrice').value = p;
      document.getElementById('dcaNewBudget').value = 200;
    }
    window.calcDcaSniper();
  };

  window.switchMainTab = function(tabId, btnEl) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab-item').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    if (btnEl) btnEl.classList.add('active');
    else document.querySelector(`.nav-tab-item[data-tab="${tabId}"]`)?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.jumpToTabAndSection = function(tabId, secId) {
    window.switchMainTab(tabId);
    if (secId) {
      setTimeout(() => {
        document.getElementById(secId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  };

  window.scrollToSection = function(secId, pillBtn) {
    if (pillBtn && pillBtn.parentElement) {
      pillBtn.parentElement.querySelectorAll('.sub-pill-btn').forEach(b => b.classList.remove('active'));
      pillBtn.classList.add('active');
    }
    document.getElementById(secId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.togglePrivacy = function() {
    state.isMasked = !state.isMasked;
    safeSetStorage(KEY_PRIVACY, String(state.isMasked));
    document.body.classList.toggle('privacy-masked', state.isMasked);
    updateEyeIcon();
    window.renderTerminal();
  };

  window.toggleTheme = () => document.documentElement.classList.toggle('light');

  window.toggleUnit = function() {
    state.unit = state.unit === 'toman' ? 'rial' : 'toman';
    document.getElementById('unitToggleBtn').textContent = state.unit === 'toman' ? 'تومان' : 'ریال';
    window.renderTerminal();
  };

  window.openQuickHub = function(mode = 'stock') {
    document.getElementById('quickHubModal').classList.add('open');
    // مقداردهی اولیه تاریخ شمسی در مودال تراکنش
    const { jy, jm, jd } = isoToJalaliParts(new Date().toISOString());
    const tyEl = document.getElementById('txJalaliYear');
    const tmEl = document.getElementById('txJalaliMonth');
    const tdEl = document.getElementById('txJalaliDay');
    if (tyEl) tyEl.value = jy;
    if (tmEl) tmEl.value = jm;
    if (tdEl) tdEl.value = jd;

    const map = { stock: 'hubStock', tx: 'hubTx', nft: 'hubNft', loanAsset: 'hubPrices', prices: 'hubPrices' };
    const targetId = map[mode] || 'hubStock';
    if (mode === 'prices' || mode === 'loanAsset') {
      document.getElementById('manualPricesFormBox').innerHTML = state.portfolio.stocks.map((s, i) => `
        <div class="form-group">
          <label>${escapeHtml(s.symbol)} (تومان):</label>
          <input type="number" id="ms_${i}" value="${getStockLiveObj(s.symbol)?.priceToman || s.avgBuyToman}" />
        </div>
      `).join('') + `
        <div class="form-group"><label>دلار آزاد / تتر (تومان):</label><input type="number" id="mu_rate" value="${state.prices.fx.usdtToman}" /></div>
        <div class="form-group"><label>بیت‌کوین ($):</label><input type="number" id="mc_btc" value="${state.prices.crypto.BTC.priceUsd}" /></div>
        <div class="form-group"><label>اتریوم ($):</label><input type="number" id="mc_eth" value="${state.prices.crypto.ETH.priceUsd}" /></div>
        <div class="form-group"><label>سولانا ($):</label><input type="number" id="mc_sol" value="${state.prices.crypto.SOL.priceUsd}" /></div>
      `;
    }
    window.switchHubTab(targetId);
  };
  window.closeQuickHub = () => document.getElementById('quickHubModal').classList.remove('open');

  window.switchHubTab = function(paneId, btnEl) {
    document.querySelectorAll('.hub-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.hub-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(paneId)?.classList.add('active');
    if (btnEl) btnEl.classList.add('active');
    else document.querySelector(`.hub-tab-btn[data-hub="${paneId}"]`)?.classList.add('active');
  };

  window.openSellNftInHub = function(idx) {
    const nf = state.portfolio.nfts[idx];
    if (!nf) return;
    window.openQuickHub('nft');
    document.getElementById('sellNftInlineSection').style.display = 'block';
    document.getElementById('sellNftIdxInput').value = idx;
    document.getElementById('sellNftNameText').value = nf.name;
    document.getElementById('sellNftBuyText').value = nf.buyToman;
    document.getElementById('sellNftPriceInput').value = nf.floorToman || nf.buyToman;
    window.previewNftSalePnl();
  };

  window.previewNftSalePnl = function() {
    const buy = pNum(document.getElementById('sellNftBuyText').value, 0);
    const sell = pNum(document.getElementById('sellNftPriceInput').value, 0);
    const pnl = sell - buy, pct = buy > 0 ? (pnl / buy) * 100 : 0, isPos = pnl >= 0;
    document.getElementById('sellNftPreviewBox').innerHTML = `<div class="num">نتیجه معامله: <strong style="color:${isPos ? 'var(--profit)' : 'var(--loss)'};">${fmtMoney(pnl, true)} (${isPos ? '+' : ''}${fmtNum(pct, 1)}٪)</strong></div>`;
  };

  window.confirmSellNft = function() {
    const idx = Number(document.getElementById('sellNftIdxInput').value);
    const nf = state.portfolio.nfts[idx];
    if (!nf) return;
    const sellPrice = pNum(document.getElementById('sellNftPriceInput').value, 0);
    const dest = document.getElementById('sellNftDestSelect').value;
    if (sellPrice <= 0) {
      showToast('لطفاً مبلغ فروش معتبر وارد کنید.');
      return;
    }
    pushUndoSnapshot(`فروش NFT ${nf.name}`);
    const pnl = sellPrice - pNum(nf.buyToman, 0);
    const pct = nf.buyToman > 0 ? (pnl / nf.buyToman) * 100 : 0;
    if (dest === 'cash') {
      state.portfolio.cash.amountToman = pNum(state.portfolio.cash.amountToman, 46000000) + sellPrice;
    } else {
      const usdtRate = Math.max(55000, pNum(state.prices.fx?.usdtToman, 270100));
      const addedUsdt = sellPrice / usdtRate;
      const usdtObj = state.portfolio.stablecoins.find(s => s.symbol === 'USDT');
      if (usdtObj) usdtObj.amount = Number((pNum(usdtObj.amount, 0) + addedUsdt).toFixed(2));
    }
    state.portfolio.realizedPnlToman = pNum(state.portfolio.realizedPnlToman, 0) + pnl;
    state.portfolio.nftSoldLogs = state.portfolio.nftSoldLogs || [];
    state.portfolio.nftSoldLogs.unshift({ date: fmtJalali(new Date()), name: nf.name, buyPrice: nf.buyToman, sellPrice, pnl, pct });
    state.portfolio.transactions.unshift({
      id: `tx-${Date.now()}`,
      date: fmtJalali(new Date()),
      isoDate: new Date().toISOString().slice(0, 10),
      type: 'فروش',
      asset: `NFT: ${nf.name}`,
      amountToman: sellPrice,
      feeToman: 0,
      note: `سود/ضرر قطعی: ${fmtNum(pnl)}`
    });
    state.portfolio.nfts.splice(idx, 1);
    document.getElementById('sellNftInlineSection').style.display = 'none';
    saveP();
    window.closeQuickHub();
    window.renderTerminal();
    showToast(`فروش NFT «${nf.name}» ثبت شد.`, true);
  };

  window.confirmAddNft = function() {
    const name = document.getElementById('newNftName').value.trim();
    const buy = pNum(document.getElementById('newNftBuy').value, 0);
    const floor = pNum(document.getElementById('newNftFloor').value, buy);
    const note = document.getElementById('newNftNote').value.trim();
    if (!name || buy <= 0) {
      showToast('نام و قیمت خرید آیتم NFT را وارد کنید.');
      return;
    }
    pushUndoSnapshot(`افزودن NFT ${name}`);
    state.portfolio.nfts.push({ name, buyToman: buy, floorToman: floor, note });
    state.portfolio.transactions.unshift({
      id: `tx-${Date.now()}`,
      date: fmtJalali(new Date()),
      isoDate: new Date().toISOString().slice(0, 10),
      type: 'خرید',
      asset: `NFT: ${name}`,
      amountToman: buy,
      feeToman: 0,
      note
    });
    saveP();
    window.closeQuickHub();
    window.renderTerminal();
    showToast(`آیتم «${name}» اضافه شد.`, true);
  };

  window.confirmAddStock = function() {
    const sym = document.getElementById('newStockSymbol').value.trim();
    const name = document.getElementById('newStockName').value.trim() || sym;
    const qty = pNum(document.getElementById('newStockQty').value, 0);
    const buy = pNum(document.getElementById('newStockBuyPrice').value, 0);
    const note = document.getElementById('newStockNote').value.trim();
    if (!sym || qty <= 0 || buy <= 0) {
      showToast('نماد، تعداد و قیمت خرید را به درستی وارد کنید.');
      return;
    }
    pushUndoSnapshot(`خرید سهم ${sym}`);
    const totalCost = Math.round(qty * buy);
    const fee = Math.round(totalCost * (pNum(state.portfolio.riskSettings?.bourseFeePct, 0.88) / 100));
    state.portfolio.stocks.push({ symbol: sym, name, qty, avgBuyToman: buy, note });
    state.prices.stocks[sym] = { priceToman: buy, dailyChangePct: 0, source: 'خرید جدید', updatedAt: new Date().toISOString() };
    if (document.getElementById('deductFromCashCheckbox').checked) {
      state.portfolio.cash.amountToman = Math.max(0, state.portfolio.cash.amountToman - totalCost - fee);
    }
    state.portfolio.transactions.unshift({
      id: `tx-${Date.now()}`,
      date: fmtJalali(new Date()),
      isoDate: new Date().toISOString().slice(0, 10),
      type: 'خرید',
      asset: sym,
      amountToman: totalCost,
      feeToman: fee,
      note
    });
    saveP();
    window.closeQuickHub();
    window.renderTerminal();
    showToast(`خرید نماد «${sym}» ثبت شد.`, true);
  };

  window.saveManualPrices = function() {
    const nowIso = new Date().toISOString();
    state.portfolio.stocks.forEach((s, i) => {
      const v = pNum(document.getElementById(`ms_${i}`)?.value, 0);
      const curObj = getStockLiveObj(s.symbol);
      if (v > 0 && v !== pNum(curObj?.priceToman, 0)) {
        state.prices.stocks[s.symbol] = {
          priceToman: v,
          dailyChangePct: curObj?.dailyChangePct || 0,
          source: 'دستی',
          isManual: true,
          stale: false,
          updatedAt: nowIso
        };
      }
    });
    const manualUsd = pNum(document.getElementById('mu_rate')?.value, 0);
    if (manualUsd >= 55000 && manualUsd !== pNum(state.prices.fx?.usdtToman, 0)) {
      state.prices.fx.usdtToman = manualUsd;
      state.prices.fx.freeUsdToman = Math.round(manualUsd * 0.996);
      state.prices.fx.source = 'دستی';
      state.prices.fx.isManual = true;
      state.prices.fx.updatedAt = nowIso;
    }
    [['BTC', 'mc_btc'], ['ETH', 'mc_eth'], ['SOL', 'mc_sol']].forEach(([sym, elId]) => {
      const val = pNum(document.getElementById(elId)?.value, 0);
      if (val > 0 && val !== pNum(state.prices.crypto?.[sym]?.priceUsd, 0)) {
        state.prices.crypto[sym] = {
          ...state.prices.crypto[sym],
          priceUsd: val,
          source: 'دستی',
          isManual: true,
          updatedAt: nowIso
        };
      }
    });

    state.prices.lastUpdated = nowIso;
    state.prices.sourceType = 'ثبت دستی کاربر';
    safeSetStorage(KEY_PR, JSON.stringify(state.prices));
    window.closeQuickHub();
    window.renderTerminal();
    showToast('قیمت‌های دستی ثبت و قفل شدند.');
  };

  window.openSettingsModal = function() {
    state.resetConfirmStep = 0;
    document.getElementById('twoStepResetBtn').textContent = 'بازنشانی کل حافظه (۲ مرحله‌ای)';
    document.getElementById('portfolioJsonTextarea').value = JSON.stringify(state.portfolio, null, 2);
    document.getElementById('settingsModal').classList.add('open');
  };
  window.closeSettingsModal = () => document.getElementById('settingsModal').classList.remove('open');

  window.savePortfolioJson = function() {
    try {
      const rawParsed = JSON.parse(document.getElementById('portfolioJsonTextarea').value);
      pushUndoSnapshot('ویرایش دستی JSON');
      state.portfolio = validateAndSanitizePortfolioJson(rawParsed);
      saveP();
      window.closeSettingsModal();
      window.renderTerminal();
      showToast('تغییرات JSON با اعتبارسنجی کامل ذخیره شد.', true);
    } catch (err) {
      showToast('فرمت JSON نامعتبر است: ' + (err.message || ''));
    }
  };

  window.exportDatedJsonBackup = function() {
    const backupPayload = {
      ...state.portfolio,
      dailySnapshots: state.history
    };
    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wealth-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    markBackupDoneNow();
    window.renderTerminal();
    showToast('فایل بکاپ دانلود شد و یادآور هفتگی بروزرسانی گردید.');
  };

  window.importJsonBackupFile = function(ev) {
    const f = ev.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        pushUndoSnapshot('بارگذاری فایل بکاپ');
        if (Array.isArray(parsed.dailySnapshots) && parsed.dailySnapshots.length > 0) {
          state.history = parsed.dailySnapshots.map(h => ({
            date: String(h.date || '').slice(0, 10),
            totalToman: Math.max(0, pNum(h.totalToman, 0)),
            usdRate: Math.max(55000, pNum(h.usdRate, 265000))
          }));
          safeSetStorage(KEY_HIST, JSON.stringify(state.history));
        }
        const cleanPortfolio = { ...parsed };
        delete cleanPortfolio.dailySnapshots;
        state.portfolio = validateAndSanitizePortfolioJson(cleanPortfolio);
        saveP();
        markBackupDoneNow();
        window.closeSettingsModal();
        window.renderTerminal();
        showToast('فایل بکاپ با موفقیت اعتبارسنجی و بازیابی شد.', true);
      } catch (err) {
        showToast('خطا در ساختار فایل بکاپ: ' + (err.message || 'فرمت نامعتبر'));
      }
    };
    r.readAsText(f);
  };

  window.triggerTwoStepReset = function() {
    if (state.resetConfirmStep === 0) {
      state.resetConfirmStep = 1;
      document.getElementById('twoStepResetBtn').textContent = 'تأیید نهایی: کلیک کنید تا حافظه پاک شود';
    } else {
      try { localStorage.clear(); } catch (_) {}
      location.reload();
    }
  };

  window.saveRiskSettings = function() {
    state.portfolio.riskSettings = {
      riskFreeRatePct: pNum(document.getElementById('riskFreeRateInput').value, 23),
      concThresholdPct: pNum(document.getElementById('concThresholdInput').value, 30),
      bourseFeePct: pNum(document.getElementById('bourseFeePctInput').value, 0.88)
    };
    saveP();
    window.renderTerminal();
  };

  window.saveRebalanceTargets = function() {
    state.portfolio.rebalanceTargets = {
      bourse: pNum(document.getElementById('rebBourse').value, 20),
      crypto: pNum(document.getElementById('rebCrypto').value, 10),
      stable: pNum(document.getElementById('rebStable').value, 30),
      cash: pNum(document.getElementById('rebCash').value, 15),
      nft: pNum(document.getElementById('rebNft').value, 10),
      gold: pNum(document.getElementById('rebGold').value, 15)
    };
    saveP();
    window.renderTerminal();
  };

  window.updateStockBuyPrice = function(idx, v) {
    if (state.portfolio.stocks[idx]) {
      state.portfolio.stocks[idx].avgBuyToman = Math.max(1, pNum(v, 100));
      saveP();
      window.renderTerminal();
    }
  };
  window.updateStockNote = function(idx, v) {
    if (state.portfolio.stocks[idx]) {
      state.portfolio.stocks[idx].note = String(v || '').slice(0, 120);
      saveP();
    }
  };
  window.updateStableNote = function(idx, v) {
    if (state.portfolio.stablecoins[idx]) {
      state.portfolio.stablecoins[idx].note = String(v || '').slice(0, 120);
      saveP();
    }
  };
  window.updateNftFloor = function(idx, v) {
    if (state.portfolio.nfts[idx]) {
      state.portfolio.nfts[idx].floorToman = Math.max(0, pNum(v, 0));
      saveP();
      window.renderTerminal();
    }
  };
  window.updateNftNote = function(idx, v) {
    if (state.portfolio.nfts[idx]) {
      state.portfolio.nfts[idx].note = String(v || '').slice(0, 120);
      saveP();
    }
  };

  window.sellSingleStockToCash = function(idx) {
    const s = state.portfolio.stocks[idx];
    if (!s) return;
    pushUndoSnapshot(`فروش سهم ${s.symbol}`);
    const cur = pNum(getStockLiveObj(s.symbol)?.priceToman, s.avgBuyToman);
    const feeRatio = pNum(state.portfolio.riskSettings?.bourseFeePct, 0.88) / 100;
    const grossVal = Math.round(s.qty * cur);
    const feeToman = Math.round(grossVal * feeRatio);
    const saleVal = grossVal - feeToman;
    const gain = saleVal - Math.round(s.qty * s.avgBuyToman);

    state.portfolio.cash.amountToman = pNum(state.portfolio.cash.amountToman, 46000000) + saleVal;
    state.portfolio.realizedPnlToman = pNum(state.portfolio.realizedPnlToman, 0) + gain;
    state.portfolio.stocks.splice(idx, 1);
    state.portfolio.transactions.unshift({
      id: `tx-${Date.now()}`,
      date: fmtJalali(new Date()),
      isoDate: new Date().toISOString().slice(0, 10),
      type: 'فروش',
      asset: s.symbol,
      amountToman: saleVal,
      feeToman,
      note: `سود تحقق‌یافته: ${fmtNum(gain)}`
    });
    saveP();
    window.renderTerminal();
    showToast(`نماد «${s.symbol}» به مبلغ خالص ${fmtMoney(saleVal)} فروخته شد.`, true);
  };

  window.sellEntireStockPortfolioToCash = function() {
    const m = computeAll();
    if (!m.stocks.length) {
      showToast('سبد بورس خالی است.');
      return;
    }
    pushUndoSnapshot('فروش کل سبد بورس');
    const total = Math.round(m.stocksVal + m.cash.brokerCash);
    state.portfolio.cash.amountToman = pNum(state.portfolio.cash.amountToman, 46000000) + total;
    state.portfolio.cash.brokerPowerToman = 0;
    state.portfolio.realizedPnlToman = pNum(state.portfolio.realizedPnlToman, 0) + Math.round(m.stocksPnl);
    state.portfolio.stocks = [];
    saveP();
    window.renderTerminal();
    showToast('کل سبد بورس به موجودی نقد منتقل شد.', true);
  };

  window.saveLoanSettings = function() {
    const jy = pNum(document.getElementById('loanJalaliYear')?.value, 1405);
    const jm = pNum(document.getElementById('loanJalaliMonth')?.value, 7);
    const jd = pNum(document.getElementById('loanJalaliDay')?.value, 1);
    const isoStart = jalaliToGregorian(jy, jm, jd);

    state.portfolio.loan = {
      ...state.portfolio.loan,
      title: document.getElementById('loanTitleInput').value,
      principalToman: pNum(document.getElementById('loanPrincipalInput').value, 30000000),
      annualRatePct: pNum(document.getElementById('loanRateInput').value, 23),
      months: pNum(document.getElementById('loanMonthsInput').value, 12),
      startDate: isoStart,
      earlyPayoffMonth: pNum(document.getElementById('earlyPayoffMonthInput')?.value, 6),
      earlyPenaltyDiscountPct: pNum(document.getElementById('earlyPenaltyDiscountInput')?.value, 90)
    };
    saveP();
    window.renderTerminal();
  };

  window.toggleInstallmentPaid = function(mIdx, checked) {
    const s = new Set(state.portfolio.loan.paidInstallments || []);
    if (checked) s.add(mIdx); else s.delete(mIdx);
    state.portfolio.loan.paidInstallments = Array.from(s);
    saveP();
    window.renderTerminal();
  };

  window.addLoanAssetItem = function() {
    const name = document.getElementById('loanItemNameInput').value.trim();
    const buy = pNum(document.getElementById('loanItemBuyTomanInput').value, 0);
    const cur = pNum(document.getElementById('loanItemCurTomanInput').value, buy);
    if (!name || buy <= 0) {
      showToast('نام و مبلغ خرید دارایی وام را وارد کنید.');
      return;
    }
    pushUndoSnapshot(`افزودن دارایی وام ${name}`);
    state.portfolio.loan.items.push({ name, category: autoDetectAssetCategory(name), buyToman: buy, currentToman: cur });
    document.getElementById('loanItemNameInput').value = '';
    document.getElementById('loanItemBuyTomanInput').value = '';
    document.getElementById('loanItemCurTomanInput').value = '';
    saveP();
    window.closeQuickHub();
    window.renderTerminal();
    showToast(`دارایی وام «${name}» ثبت شد.`, true);
  };

  window.updateLoanItemVal = function(idx, v) {
    if (state.portfolio.loan?.items?.[idx]) {
      state.portfolio.loan.items[idx].currentToman = pNum(v, 0);
      saveP();
      window.renderTerminal();
    }
  };

  window.removeLoanAssetItem = function(idx) {
    const it = state.portfolio.loan?.items?.[idx];
    if (!it) return;
    pushUndoSnapshot(`حذف دارایی وام ${it.name}`);
    state.portfolio.loan.items.splice(idx, 1);
    saveP();
    window.renderTerminal();
    showToast(`دارایی وام «${it.name}» حذف شد.`, true);
  };

  window.saveCashConfig = function() {
    state.portfolio.cash.amountToman = pNum(document.getElementById('cashAmountInput').value, 46000000);
    state.portfolio.cash.brokerPowerToman = pNum(document.getElementById('brokerCashInput').value, 978278);
    state.portfolio.cash.targetUsdtToman = pNum(document.getElementById('cashTargetUsdtInput').value, 248000);
    saveP();
    window.renderTerminal();
  };

  window.addPriceAlert = function() {
    const asset = document.getElementById('alertAssetSelect').value;
    const cond = document.getElementById('alertCondSelect').value;
    const target = pNum(document.getElementById('alertTargetPriceInput').value, 0);
    if (target <= 0) {
      showToast('لطفاً قیمت هدف هشدار را وارد کنید.');
      return;
    }
    state.portfolio.alerts.push({ id: Date.now(), asset, cond, target });
    document.getElementById('alertTargetPriceInput').value = '';
    saveP();
    window.closeQuickHub();
    window.renderTerminal();
    showToast(`هشدار قیمتی برای «${asset}» ثبت شد.`);
  };

  window.removePriceAlert = function(idx) {
    pushUndoSnapshot('حذف هشدار قیمتی');
    state.portfolio.alerts.splice(idx, 1);
    saveP();
    window.renderTerminal();
    showToast('هشدار قیمتی حذف شد.', true);
  };

  // ثبت تراکنش در دفتر کل با پشتیبانی از سود نقدی سهام/صندوق (DPS)، کارمزد و انتخابگر تاریخ شمسی
  window.addManualTransaction = function() {
    const type = document.getElementById('txTypeInput').value;
    const asset = document.getElementById('txAssetInput').value.trim();
    const amountToman = pNum(document.getElementById('txAmountInput').value, 0);
    const feeToman = Math.max(0, pNum(document.getElementById('txFeeInput')?.value, 0));
    const note = (document.getElementById('txNoteInput')?.value || '').trim() || 'ثبت از مرکز عملیات';

    const jy = pNum(document.getElementById('txJalaliYear')?.value, 1405);
    const jm = pNum(document.getElementById('txJalaliMonth')?.value, 8);
    const jd = pNum(document.getElementById('txJalaliDay')?.value, 5);
    const isoDate = jalaliToGregorian(jy, jm, jd);
    const jalaliStr = `${toFa(jy)}/${toFa(String(jm).padStart(2, '0'))}/${toFa(String(jd).padStart(2, '0'))}`;

    if (!asset || amountToman <= 0) {
      showToast('نام دارایی و مبلغ تراکنش را وارد کنید.');
      return;
    }
    pushUndoSnapshot(`ثبت تراکنش ${type} ${asset}`);

    if (type === 'سود نقدی') {
      state.portfolio.cash.amountToman = pNum(state.portfolio.cash.amountToman, 0) + amountToman;
    } else if (type === 'کارمزد') {
      state.portfolio.cash.amountToman = Math.max(0, pNum(state.portfolio.cash.amountToman, 0) - amountToman);
    }

    state.portfolio.transactions.unshift({
      id: `tx-${Date.now()}`,
      date: jalaliStr,
      isoDate,
      type,
      asset,
      amountToman,
      feeToman,
      note
    });
    saveP();
    window.closeQuickHub();
    window.renderTerminal();
    showToast(`تراکنش «${type} - ${asset}» در دفتر کل ثبت شد.`, true);
  };

  window.exportTransactionsCsv = function() {
    const rows = [['تاریخ شمسی', 'تاریخ میلادی', 'نوع', 'دارایی', 'مبلغ (تومان)', 'کارمزد (تومان)', 'یادداشت']];
    (state.portfolio.transactions || []).forEach(t =>
      rows.push([t.date, t.isoDate || '', t.type, t.asset, t.amountToman, t.feeToman || 0, t.note || ''])
    );
    const blob = new Blob(['\uFEFF' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transactions.csv';
    a.click();
  };

  window.resetCfoDefaults = function() {
    state.portfolio.cfoConfig = JSON.parse(JSON.stringify(DEFAULT_PORTFOLIO.cfoConfig));
    saveP();
    window.updateDollarMacroModel(false);
  };

  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      window.openQuickHub('stock');
    } else if (e.key === 'Escape') {
      window.closeQuickHub();
      window.closeSettingsModal();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  migrateStorage();
  updateEyeIcon();
  checkInitialPinLock();
  window.renderTerminal();
  setTimeout(() => window.syncAllLiveMarkets(false), 250);
})(window);
