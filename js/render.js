/**
 * js/render.js — لایه رندر DOM و چارت‌ها با رعایت کامل امنیت XSS (escapeHtml)،
 * مخفی‌سازی کامل ارقام (شامل Tooltipها و محورهای چارت و Inputها)،
 * کارت‌های فشرده موبایل برای جدول ۱۱ ستونه بورس، ویجت هدف مالی، و چارت دوگانه تومانی/دلاری
 */
(function(window) {
  'use strict';

  const {
    state, escapeHtml, toFa, pNum, normFa, fmtJalali, isoToJalaliParts,
    SEMANTIC_COLORS, DEFAULT_PORTFOLIO, DEFAULT_PRICES, saveP, isWeeklyBackupDue
  } = window.WD_DATA;

  const { computeAll, computeQuantRisk, getStockLiveObj } = window.WD_COMPUTE;

  function fmtNum(val, dec = 0, isSensitive = false) {
    if (isSensitive && state.isMasked) return '***,***';
    const num = pNum(val, 0);
    const parts = Math.abs(num).toFixed(dec).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    return (num < 0 ? '-' : '') + toFa(parts.join('٫'));
  }

  function fmtMoney(tomanVal, sign = false) {
    const suffix = state.unit === 'rial' ? ' ریال' : ' تومان';
    if (state.isMasked) return '***,***' + suffix;
    const num = pNum(tomanVal, 0);
    const mult = state.unit === 'rial' ? 10 : 1;
    return (sign && num > 0 ? '+' : '') + fmtNum(Math.round(num * mult), 0) + suffix;
  }

  function fmtUsd(usdVal, dec = 2, sign = false) {
    if (state.isMasked) return '$***';
    const num = pNum(usdVal, 0);
    const prefix = sign && num > 0 ? '+' : (num < 0 ? '-' : '');
    return `${prefix}$${Math.abs(num).toFixed(dec)}`;
  }

  function buildSemiGaugeSvg(pctValue, colorHex, subText = '') {
    const clamped = Math.min(100, Math.max(0, pNum(pctValue, 50)));
    const radius = 46;
    const circum = Math.PI * radius;
    const dashOffset = circum - (clamped / 100) * circum;
    return `
      <svg viewBox="0 0 120 68" style="width:100%; height:100%; overflow:visible;" role="img" aria-label="${escapeHtml(subText)}">
        <path d="M 14 58 A 46 46 0 0 1 106 58" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="10" stroke-linecap="round"/>
        <path d="M 14 58 A 46 46 0 0 1 106 58" fill="none" stroke="${colorHex}" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${circum.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"/>
        <text x="60" y="54" text-anchor="middle" fill="currentColor" font-size="14" font-weight="900">${state.isMasked ? '***' : toFa(Math.round(clamped)) + '٪'}</text>
        ${subText ? `<text x="60" y="67" text-anchor="middle" fill="#94a3b8" font-size="8.5">${escapeHtml(subText)}</text>` : ''}
      </svg>
    `;
  }

  function buildSparklineSvg(valuesArray, colorHex = '#10b981', width = 120, height = 38) {
    if (!Array.isArray(valuesArray) || valuesArray.length < 2) return '';
    const min = Math.min(...valuesArray);
    const max = Math.max(...valuesArray);
    const range = (max - min) || 1;
    const pts = valuesArray.map((v, i) => {
      const x = 4 + (i / (valuesArray.length - 1)) * (width - 8);
      const y = height - 5 - ((v - min) / range) * (height - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${width} ${height}" style="width:${width}px; height:${height}px; overflow:visible;" aria-hidden="true"><polyline fill="none" stroke="${colorHex}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  }

  // تنظیمات مشترک Chart.js برای مخفی‌سازی کامل Tooltip و محورهای چارت در حالت Privacy
  function getPrivacyAwareChartPlugins(unitSuffix = '') {
    return {
      tooltip: {
        rtl: true,
        callbacks: {
          label: function(ctx) {
            const dsLabel = ctx.dataset?.label || '';
            if (state.isMasked) return `${dsLabel}: ***,***`;
            const rawVal = ctx.parsed?.y !== undefined ? ctx.parsed.y : ctx.parsed;
            return `${dsLabel}: ${fmtNum(rawVal, 1)} ${unitSuffix}`;
          }
        }
      }
    };
  }

  function getPrivacyAwareYScale(colorHex = '#94a3b8', prefix = '', suffix = '') {
    return {
      ticks: {
        color: colorHex,
        font: { family: 'Vazirmatn', size: 10 },
        callback: function(value) {
          if (state.isMasked) return '***';
          return `${prefix}${toFa(value)}${suffix}`;
        }
      }
    };
  }

  function getPriceAgeMeta(isoTime, warnMins, dangerMins, srcLabel, isManual) {
    const src = isManual ? 'دستی' : (srcLabel || 'کش');
    if (!isoTime) return { dot: '●', color: 'var(--warn)', text: `${src}`, ageMins: 999 };
    const diffMs = Date.now() - new Date(isoTime).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    const timeStr = new Date(isoTime).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    if (isManual) return { dot: '●', color: 'var(--c-stable)', text: `دستی (${timeStr})`, ageMins: mins };
    if (mins <= warnMins) return { dot: '●', color: 'var(--profit)', text: `${src} (${timeStr})`, ageMins: mins };
    if (mins <= dangerMins) return { dot: '●', color: 'var(--warn)', text: `${src} (${toFa(mins)}د پیش)`, ageMins: mins };
    return { dot: '●', color: 'var(--loss)', text: `${src} (${toFa(Math.round(mins / 60))}س پیش)`, ageMins: mins };
  }

  function renderTopBannersAndFreshness(m) {
    const f = m.freshness;
    const bannerEl = document.getElementById('staleOrSuspectBanner');
    const bannerTextEl = document.getElementById('staleOrSuspectText');
    if (bannerEl && bannerTextEl) {
      if (f.hasWarningBanner) {
        const msgs = [];
        if (f.isStaleAlert) {
          msgs.push(`قیمت بورس بیش از ${toFa(Math.max(6, Math.round(f.ageHours)))} ساعت است که بروزرسانی نشده است.`);
        }
        if (f.suspectSymbols.length > 0) {
          msgs.push(`تغییر قیمت روزانه غیرعادی (Suspect) در نمادهای: ${escapeHtml(f.suspectSymbols.join('، '))} — لطفاً قیمت پایانی یا تعدیل نماد را بررسی کنید.`);
        }
        bannerTextEl.textContent = msgs.join(' | ');
        bannerEl.classList.add('visible');
        bannerEl.classList.toggle('danger', f.suspectSymbols.length > 0);
      } else {
        bannerEl.classList.remove('visible');
      }
    }

    const backupBanner = document.getElementById('weeklyBackupBanner');
    if (backupBanner) {
      backupBanner.classList.toggle('visible', isWeeklyBackupDue());
    }

    const ageStr = f.ageMinutes < 60
      ? `${toFa(f.ageMinutes)} دقیقه پیش`
      : `${toFa(Math.round(f.ageHours))} ساعت پیش`;
    const statusTextEl = document.getElementById('marketFreshnessStatusText');
    if (statusTextEl) {
      const syncStateStr = state.syncStatus === 'loading' ? 'در حال بروزرسانی...' : `${ageStr}، ${f.marketStatusText}`;
      statusTextEl.textContent = syncStateStr;
    }
  }

  function renderGoalWidget(m) {
    const g = m.goal;
    const pctEl = document.getElementById('goalProgressPctBadge');
    const fillEl = document.getElementById('goalProgressFill');
    const curEl = document.getElementById('goalCurrentVsTargetText');
    const remEl = document.getElementById('goalRemainingText');
    const inpEl = document.getElementById('wealthTargetInput');

    if (pctEl) pctEl.textContent = state.isMasked ? '***٪' : `${fmtNum(g.progressPct, 1)}٪`;
    if (fillEl) fillEl.style.width = `${g.progressPct.toFixed(1)}%`;
    if (curEl) {
      curEl.textContent = `${fmtMoney(m.gross)} از ${fmtMoney(g.targetToman)} (${fmtUsd(g.targetUsd, 0)})`;
    }
    if (remEl) {
      remEl.textContent = g.remainingToman <= 0
        ? 'هدف مالی محقق شده است!'
        : `مانده تا هدف: ${fmtMoney(g.remainingToman)}`;
    }
    if (inpEl && document.activeElement !== inpEl) {
      inpEl.value = g.targetToman;
    }
  }

  function renderDailyCommander(m, qRisk) {
    const actions = [];
    const underwaterStock = [...m.stocks].sort((a, b) => a.pnlPct - b.pnlPct)[0];
    if (underwaterStock && underwaterStock.currentPriceToman < underwaterStock.avgBuyToman && m.cash.totalCash >= 2000000) {
      actions.push({
        priority: 'اقدام ۱: میانگین کم کردن',
        cls: 'badge-profit',
        text: `نماد «${escapeHtml(underwaterStock.symbol)}» زیر میانگین خرید شماست (${fmtNum(underwaterStock.pnlPct, 1)}٪) و نقدینگی ریالی کافی برای خرید پله‌ای موجود است.`,
        tab: 'tab4Analytics',
        sec: 'secDcaTool',
        btnText: 'محاسبه پله DCA'
      });
    }
    const l = m.loan;
    const paidSet = new Set(l.paidInstallments || [1]);
    let nextInstIdx = 1;
    while (paidSet.has(nextInstIdx) && nextInstIdx <= l.loanMonths) nextInstIdx++;
    if (nextInstIdx <= l.loanMonths) {
      const dueD = new Date(new Date(l.startDate || '2026-09-23').getTime() + nextInstIdx * 30 * 86400000);
      const daysLeft = Math.ceil((dueD.getTime() - Date.now()) / 86400000);
      actions.push({
        priority: daysLeft <= 7 ? 'اقدام ۲: سررسید قسط وام' : 'اقدام ۲: برنامه اقساط وام',
        cls: daysLeft <= 7 ? 'badge-loss' : 'badge-warn',
        text: `قسط شماره ${toFa(nextInstIdx)} وام (${fmtMoney(l.monthlyInst)}) در تاریخ ${fmtJalali(dueD)} سررسید می‌شود.`,
        tab: 'tab3Loans',
        sec: '',
        btnText: 'مدیریت وام'
      });
    }
    const nftShare = (m.nftsVal / (m.gross || 1)) * 100;
    actions.push({
      priority: nftShare > 18 ? 'اقدام ۳: کاهش تمرکز NFT' : 'اقدام ۳: رصد پله خرید تتر',
      cls: nftShare > 18 ? 'badge-warn' : 'badge-info',
      text: nftShare > 18
        ? `وزن کلکسیون NFT تلگرام به ${fmtNum(nftShare, 1)}٪ رسیده؛ بخشی را به دارایی نقدشونده تبدیل کنید.`
        : `نرخ تتر آزاد ${fmtMoney(m.rates.usdt)} است؛ فاصله تا پله خرید شما در بخش تحلیل دلار بررسی شود.`,
      tab: 'tab4Analytics',
      sec: nftShare > 18 ? 'secRiskLedger' : 'secCfoDollar',
      btnText: nftShare > 18 ? 'میز ریبالانس' : 'تحلیل CFO دلار'
    });

    const listEl = document.getElementById('dailyCommanderList');
    if (listEl) {
      listEl.innerHTML = actions.slice(0, 3).map(ac => `
        <div class="cmd-item">
          <div><span class="badge ${ac.cls}">${escapeHtml(ac.priority)}</span></div>
          <div style="font-size:0.75rem; line-height:1.55;">${ac.text}</div>
          <button class="btn" style="align-self:flex-start; min-height:38px; padding:0.25rem 0.65rem; font-size:0.72rem;" onclick="window.jumpToTabAndSection('${ac.tab}', '${ac.sec}')">${escapeHtml(ac.btnText)}</button>
        </div>
      `).join('');
    }

    const sc = qRisk.healthScore;
    const col = sc >= 70 ? '#10b981' : '#f59e0b';
    const healthSvgEl = document.getElementById('commanderHealthSvgBox');
    if (healthSvgEl) {
      healthSvgEl.innerHTML = `
        <svg viewBox="0 0 80 80" style="width:68px; height:68px;" role="img" aria-label="امتیاز سلامت سبد">
          <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="7"/>
          <circle cx="40" cy="40" r="32" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round"
                  stroke-dasharray="201" stroke-dashoffset="${201 - (sc / 100) * 201}" transform="rotate(-90 40 40)"/>
          <text x="40" y="45" text-anchor="middle" fill="currentColor" font-size="18" font-weight="900">${state.isMasked ? '**' : toFa(sc)}</text>
        </svg>
      `;
    }
  }

  function renderStocksTreemapAndTable(m) {
    const mode = state.portfolio.stockSortMode || 'priceAsc';
    const filterQ = normFa(document.getElementById('stockSearchChip')?.value || '').toLowerCase();

    const byVal = [...m.stocks].sort((a, b) => b.valueToman - a.valueToman);
    const treemapEl = document.getElementById('bourseTreemapBox');
    if (treemapEl) {
      treemapEl.innerHTML = byVal.length === 0
        ? `<div style="padding:1rem; color:var(--text-sub); width:100%; text-align:center;">سبد بورس خالی است.</div>`
        : byVal.map(s => {
          const wPct = Math.max(12, (s.valueToman / (m.stocksVal || 1)) * 100);
          const bg = s.pnlPct >= 5 ? 'rgba(16, 185, 129, 0.82)' : (s.pnlPct >= 0 ? 'rgba(16, 185, 129, 0.52)' : 'rgba(244, 63, 94, 0.72)');
          return `
            <div class="treemap-cell" style="flex: ${wPct.toFixed(0)} 1 ${Math.max(82, wPct * 2.1)}px; background:${bg};" onclick="window.loadDcaPreset('stock_${s.origIdx}'); window.jumpToTabAndSection('tab4Analytics', 'secDcaTool');">
              <div style="font-weight:900; font-size:0.8rem;">${escapeHtml(s.symbol)}</div>
              <div class="num" style="font-size:0.69rem;">${s.pnlPct >= 0 ? '+' : ''}${fmtNum(s.pnlPct, 1, true)}٪</div>
              <div class="num" style="font-size:0.65rem;">${state.isMasked ? '***' : fmtNum(Math.round(s.valueToman / 1e6), 1) + 'M'}</div>
            </div>
          `;
        }).join('');
    }

    const sorted = [...m.stocks]
      .filter(s => !filterQ || normFa(s.symbol).toLowerCase().includes(filterQ) || normFa(s.name).toLowerCase().includes(filterQ))
      .sort((a, b) => {
        if (mode === 'priceAsc') return a.currentPriceToman - b.currentPriceToman;
        if (mode === 'priceDesc') return b.currentPriceToman - a.currentPriceToman;
        if (mode === 'pnlDesc') return b.pnlPct - a.pnlPct;
        return b.valueToman - a.valueToman;
      });

    // ۱. جدول ۱۱ ستونه برای دسکتاپ
    const tbody = document.getElementById('stocksTableBody');
    if (tbody) {
      tbody.innerHTML = sorted.length === 0
        ? `<tr><td colspan="11" style="text-align:center; padding:1.5rem; color:var(--text-sub);">هیچ نمادی با این عبارت یافت نشد.</td></tr>`
        : sorted.map(s => {
          const pos = s.pnlToman >= 0;
          const sparkPts = [s.avgBuyToman, s.avgBuyToman * 1.02, s.currentPriceToman * 0.98, s.currentPriceToman];
          const sparkSvg = buildSparklineSvg(sparkPts, pos ? '#10b981' : '#f43f5e', 60, 20);
          const stObj = getStockLiveObj(s.symbol);
          const sm = getPriceAgeMeta(stObj?.updatedAt || state.prices.lastUpdated, 60, 240, stObj?.source || 'کش', stObj?.isManual);
          return `
            <tr>
              <td><strong>${escapeHtml(s.symbol)}</strong> ${s.suspect ? '<span class="badge badge-warn" title="تغییر روزانه غیرعادی">مشکوک</span>' : ''}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${sparkSvg}</td>
              <td class="num">${fmtNum(s.qty, 0, true)}</td>
              <td><input type="number" class="inline-input num sensitive-input" aria-label="قیمت خرید ${escapeHtml(s.symbol)}" value="${s.avgBuyToman}" onchange="window.updateStockBuyPrice(${s.origIdx}, this.value)" /></td>
              <td class="num">
                <strong style="color:var(--c-stable)">${fmtMoney(s.currentPriceToman)}</strong>
                <div style="font-size:0.64rem; color:${sm.color};">${sm.dot} ${escapeHtml(sm.text)}</div>
              </td>
              <td><span class="badge ${s.dailyChangePct >= 0 ? 'badge-profit' : 'badge-loss'}">${s.dailyChangePct >= 0 ? '+' : ''}${fmtNum(s.dailyChangePct, 2, true)}٪</span></td>
              <td class="num"><strong>${fmtMoney(s.valueToman)}</strong></td>
              <td class="num" style="color:${pos ? 'var(--profit)' : 'var(--loss)'}; font-weight:800;">
                <div>${fmtMoney(s.pnlToman, true)} (${pos ? '+' : ''}${fmtNum(s.pnlPct, 1, true)}٪)</div>
                <div style="font-size:0.66rem; color:var(--c-stable); direction:ltr;">${fmtUsd(s.pnlUsd, 2, true)}</div>
              </td>
              <td><input type="text" aria-label="یادداشت ${escapeHtml(s.symbol)}" value="${escapeHtml(s.note || '')}" style="width:110px; min-height:36px; font-size:0.72rem;" onchange="window.updateStockNote(${s.origIdx}, this.value)" /></td>
              <td><button class="btn-sell" aria-label="فروش ${escapeHtml(s.symbol)}" onclick="window.sellSingleStockToCash(${s.origIdx})">فروش</button></td>
            </tr>
          `;
        }).join('');
    }

    // ۲. کارت‌های فشرده موبایل (نماد، تعداد، سود٪ و ارزش، با دکمه گسترش)
    const mobBox = document.getElementById('stocksMobileCardsContainer');
    if (mobBox) {
      mobBox.innerHTML = sorted.length === 0
        ? `<div style="text-align:center; padding:1.2rem; color:var(--text-sub);">هیچ نمادی یافت نشد.</div>`
        : sorted.map(s => {
          const pos = s.pnlToman >= 0;
          const isExp = Boolean(state.expandedMobileStocks[s.origIdx]);
          return `
            <div class="mobile-stock-card ${isExp ? 'expanded' : ''}" id="mobStockCard_${s.origIdx}">
              <div class="mobile-stock-head">
                <div>
                  <strong style="font-size:0.88rem;">${escapeHtml(s.symbol)}</strong>
                  <span style="font-size:0.72rem; color:var(--text-sub); margin-right:0.35rem;">تعداد: <b class="num">${fmtNum(s.qty, 0, true)}</b></span>
                </div>
                <div style="display:flex; align-items:center; gap:0.45rem;">
                  <span class="badge ${pos ? 'badge-profit' : 'badge-loss'} num">${pos ? '+' : ''}${fmtNum(s.pnlPct, 1, true)}٪</span>
                  <strong class="num" style="font-size:0.84rem;">${fmtMoney(s.valueToman)}</strong>
                  <button class="btn" style="min-height:38px; min-width:38px; padding:0 0.5rem;" aria-label="جزئیات ${escapeHtml(s.symbol)}" onclick="window.toggleMobileStockExpand(${s.origIdx})">${isExp ? 'بستن' : 'جزئیات'}</button>
                </div>
              </div>
              <div class="mobile-stock-details">
                <div style="display:flex; justify-content:space-between;"><span>نام کامل:</span><strong>${escapeHtml(s.name)}</strong></div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span>میانگین خرید من:</span>
                  <input type="number" class="inline-input num sensitive-input" value="${s.avgBuyToman}" onchange="window.updateStockBuyPrice(${s.origIdx}, this.value)" />
                </div>
                <div style="display:flex; justify-content:space-between;"><span>قیمت روز (تغییر روزانه):</span><strong class="num">${fmtMoney(s.currentPriceToman)} (${fmtNum(s.dailyChangePct, 2, true)}٪)</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>سود/زیان خالص:</span><strong class="num" style="color:${pos ? 'var(--profit)' : 'var(--loss)'}">${fmtMoney(s.pnlToman, true)} (${fmtUsd(s.pnlUsd, 2, true)})</strong></div>
                <div style="display:flex; gap:0.4rem; align-items:center; margin-top:0.2rem;">
                  <input type="text" value="${escapeHtml(s.note || '')}" placeholder="یادداشت..." style="min-height:38px; font-size:0.74rem;" onchange="window.updateStockNote(${s.origIdx}, this.value)" />
                  <button class="btn-sell" onclick="window.sellSingleStockToCash(${s.origIdx})">فروش به نقد</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
    }
  }

  function populateDcaPresets(m) {
    const sel = document.getElementById('dcaPresetSelect');
    if (!sel) return;
    const prevVal = sel.value;
    sel.innerHTML = '';
    m.stocks.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = `stock_${i}`;
      opt.textContent = `سهم ${s.symbol} (خرید: ${fmtNum(s.avgBuyToman)} | روز: ${fmtNum(s.currentPriceToman)})`;
      sel.appendChild(opt);
    });
    ['BTC', 'ETH', 'SOL'].forEach(c => {
      const opt = document.createElement('option');
      opt.value = `crypto_${c}`;
      opt.textContent = `رمزارز ${c}`;
      sel.appendChild(opt);
    });
    if (prevVal) sel.value = prevVal;
  }

  window.calcDcaSniper = function() {
    const curQty = Math.max(0.0001, pNum(document.getElementById('dcaCurQty')?.value, 5000));
    const curAvg = Math.max(0.01, pNum(document.getElementById('dcaCurAvg')?.value, 560));
    const mktPrice = Math.max(0.01, pNum(document.getElementById('dcaMarketPrice')?.value, 520));
    const budget = Math.max(0, pNum(document.getElementById('dcaNewBudget')?.value, 5000000));

    const oldCost = curQty * curAvg;
    const lumpUnits = budget / mktPrice;
    const lumpAvg = (oldCost + budget) / (curQty + lumpUnits);

    const steps = [
      { name: "پله ۱ (فعلی)", drop: 0, w: 0.20 },
      { name: "پله ۲ (۵-٪)", drop: 0.05, w: 0.35 },
      { name: "پله ۳ (۱۰-٪)", drop: 0.10, w: 0.45 }
    ];
    let runQty = curQty, runCost = oldCost;
    const stepAvgs = [curAvg];

    const tbody = document.getElementById('dcaLadderTableBody');
    if (tbody) {
      tbody.innerHTML = steps.map(st => {
        const entryP = mktPrice * (1 - st.drop);
        const stepBudget = budget * st.w;
        const stepUnits = stepBudget / entryP;
        runQty += stepUnits;
        runCost += stepBudget;
        const stepNewAvg = runCost / runQty;
        stepAvgs.push(Number(stepNewAvg.toFixed(1)));
        const reqFromStep = ((stepNewAvg - entryP) / entryP) * 100;
        return `
          <tr>
            <td><strong>${escapeHtml(st.name)}</strong> (${toFa(st.w * 100)}٪)</td>
            <td class="num"><strong>${fmtNum(entryP, entryP < 10 ? 2 : 0, true)}</strong></td>
            <td class="num">${fmtNum(stepBudget, 0, true)}</td>
            <td class="num">+${fmtNum(stepUnits, stepUnits < 5 ? 4 : 0, true)}</td>
            <td class="num" style="color:var(--c-stable); font-weight:800;">${fmtNum(stepNewAvg, stepNewAvg < 10 ? 2 : 0, true)}</td>
            <td><span class="badge badge-info">+${fmtNum(Math.max(0, reqFromStep), 1, true)}٪</span></td>
          </tr>
        `;
      }).join('');
    }

    const ladderFinalAvg = stepAvgs[stepAvgs.length - 1];
    const compBox = document.getElementById('dcaComparisonBox');
    if (compBox) {
      compBox.innerHTML = `
        <div style="background:var(--bg-input); padding:0.65rem; border-radius:10px; border:1px solid var(--border);">
          <div style="font-size:0.72rem; color:var(--text-sub);">خرید یک‌جا در قیمت روز</div>
          <div class="num" style="font-size:0.95rem; font-weight:900; margin:0.15rem 0;">سر‌به‌سر: ${fmtNum(lumpAvg, lumpAvg < 10 ? 2 : 0, true)}</div>
        </div>
        <div style="background:var(--profit-soft); padding:0.65rem; border-radius:10px; border:1px solid rgba(16,185,129,0.35);">
          <div style="font-size:0.72rem; color:var(--profit); font-weight:700;">خرید پله‌ای (۳ پله)</div>
          <div class="num" style="font-size:0.95rem; font-weight:900; color:var(--profit); margin:0.15rem 0;">سر‌به‌سر: ${fmtNum(ladderFinalAvg, ladderFinalAvg < 10 ? 2 : 0, true)}</div>
        </div>
      `;
    }

    if (typeof Chart !== 'undefined') {
      const ctx = document.getElementById('dcaStepChartCanvas')?.getContext('2d');
      if (ctx) {
        if (state.charts.dcaStep) state.charts.dcaStep.destroy();
        state.charts.dcaStep = new Chart(ctx, {
          type: 'line',
          data: {
            labels: ['قبلی', 'پله ۱', 'پله ۲', 'پله ۳'],
            datasets: [{ label: 'قیمت سر‌به‌سر', data: stepAvgs, stepped: true, borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.14)', fill: true, pointRadius: 4 }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, ...getPrivacyAwareChartPlugins('تومان') },
            scales: { y: getPrivacyAwareYScale('#94a3b8') }
          }
        });
      }
    }
  };

  function renderCryptoDipAndGauges(m) {
    const cMap = state.prices.crypto || DEFAULT_PRICES.crypto;
    const sent = state.prices.sentiment || DEFAULT_PRICES.sentiment;
    const fng = pNum(sent.fngValue, 50);
    const fngCol = fng <= 35 ? '#10b981' : (fng >= 70 ? '#f43f5e' : '#f59e0b');
    const fngLbl = fng <= 30 ? 'ترس (خرید)' : (fng >= 70 ? 'طمع (احتیاط)' : 'خنثی');

    document.getElementById('gaugeFngSvg').innerHTML = buildSemiGaugeSvg(fng, fngCol, fngLbl);
    document.getElementById('fngValueText').textContent = `${toFa(fng)} / ۱۰۰ — ${fngLbl}`;

    const btcP = pNum(cMap.BTC?.priceUsd, 80018);
    const btcMa200 = pNum(cMap.BTC?.ma200Usd, 63400);
    const mvrvZ = Number((((btcP / (btcMa200 || 1)) - 0.75) * 3.2).toFixed(2));
    const mvrvPct = Math.min(100, Math.max(10, (mvrvZ / 4) * 100));
    document.getElementById('gaugeMvrvSvg').innerHTML = buildSemiGaugeSvg(mvrvPct, '#06b6d4', 'Z-Score');
    document.getElementById('onchainMvrvText').textContent = `${fmtNum(mvrvZ, 2)} (انباشت)`;

    const btcd = pNum(sent.btcDominance, 57.4);
    document.getElementById('gaugeBtcdSvg').innerHTML = buildSemiGaugeSvg(btcd, '#eab308', 'BTC.D');
    document.getElementById('onchainBtcdText').textContent = `${fmtNum(btcd, 1)}٪`;

    document.getElementById('fxSpreadInfo').textContent = fmtUsd(m.stableUsd, 2);
    document.getElementById('stablecoinsTableBody').innerHTML = m.stablecoins.map((st, idx) => `
      <tr>
        <td><strong>${escapeHtml(st.symbol)}</strong> (${escapeHtml(st.network)})</td>
        <td class="num">${fmtNum(st.amount, 2, true)}</td>
        <td class="num">${fmtUsd(st.usdValue, 2)}</td>
        <td class="num">${fmtMoney(st.valueFreeToman)}</td>
        <td class="num">${fmtMoney(st.valueUsdtToman)}</td>
        <td><input type="text" aria-label="یادداشت استیبل‌کوین" value="${escapeHtml(st.note || '')}" style="width:140px; min-height:36px; font-size:0.72rem;" onchange="window.updateStableNote(${idx}, this.value)" /></td>
      </tr>
    `).join('');

    document.getElementById('dipPlannerCards').innerHTML = ['BTC', 'ETH', 'SOL'].map((sym, i) => {
      const budget = m.stableUsd * [0.5, 0.3, 0.2][i];
      const coin = cMap[sym] || DEFAULT_PRICES.crypto[sym];
      const curP = pNum(coin.priceUsd, 100);
      const ma200 = pNum(coin.ma200Usd, curP * 0.9);
      const h90 = Math.max(curP, pNum(coin.high90dUsd, curP * 1.1));
      const distFromH90Pct = ((h90 - curP) / h90) * 100;
      const distFromMa200Pct = ((curP - ma200) / ma200) * 100;
      const step1Price = h90 * 0.85;
      const step2Price = h90 * 0.75;

      let recTitle = 'صبر برای اصلاح (نگهداری استیبل‌کوین)';
      let recClass = 'badge-warn';
      let recReason = `قیمت فعلی ($${fmtNum(curP, 1, true)}) تنها ${fmtNum(distFromH90Pct, 1)}٪ از سقف ۹۰ روزه فاصله دارد. تا رسیدن به پله ۱ ($${fmtNum(step1Price, 0, true)}) صبر کنید.`;

      if (curP <= step2Price || (curP <= step1Price && fng <= 35)) {
        recTitle = 'در پله ۲ و ۱ خرید پله‌ای انجام دهید';
        recClass = 'badge-profit';
        recReason = `اصلاح ${fmtNum(distFromH90Pct, 1)}٪ از سقف و شاخص ترس‌وطمع ${toFa(fng)} موقعیت کم‌ریسکی ایجاد کرده است.`;
      } else if (curP <= step1Price || curP <= ma200 * 1.02) {
        recTitle = 'در پله ۱ خرید تدریجی را آغاز کنید';
        recClass = 'badge-profit';
        recReason = `قیمت به محدوده حمایتی پله اول ($${fmtNum(step1Price, 0, true)}) نزدیک شده است.`;
      }

      const rows = [0.15, 0.25, 0.35].map((drop, idx) => {
        const lvl = h90 * (1 - drop), u = budget * [0.25, 0.35, 0.40][idx];
        const hit = curP <= lvl;
        return `<tr style="${hit ? 'background:var(--profit-soft);' : ''}"><td>پله ${toFa(idx + 1)} (${toFa(drop * 100)}-٪)</td><td class="num"><strong>$${fmtNum(lvl, 0, true)}</strong></td><td class="num">${fmtUsd(u, 1)}</td><td class="num"><strong>${fmtNum(u / lvl, 4, true)} ${escapeHtml(sym)}</strong></td></tr>`;
      }).join('');

      return `
        <div class="card" style="margin-bottom:0; border-top:3px solid var(--c-crypto);">
          <div class="section-head">
            <span class="section-title">${escapeHtml(sym)} (بودجه: ${fmtUsd(budget, 1)})</span>
            <span class="badge badge-info num">${fmtUsd(curP, 1)}</span>
          </div>
          <div style="background:var(--bg-input); padding:0.6rem; border-radius:9px; margin-bottom:0.55rem; font-size:0.73rem; line-height:1.55;">
            <div style="margin-bottom:0.25rem;"><span class="badge ${recClass}">${escapeHtml(recTitle)}</span></div>
            <div style="color:var(--text-sub);">${recReason}</div>
          </div>
          <div class="table-box"><table><thead><tr><th>پله</th><th>هدف</th><th>بودجه</th><th>مقدار</th></tr></thead><tbody>${rows}</tbody></table></div>
        </div>
      `;
    }).join('');
  }

  function renderCashAndNftCards(m) {
    document.getElementById('cashAmountInput').value = m.cash.bankCash;
    document.getElementById('brokerCashInput').value = m.cash.brokerCash;
    document.getElementById('cashTargetUsdtInput').value = m.cash.targetUsdt;
    document.getElementById('totalAvailableCashText').textContent = fmtMoney(m.cash.totalCash);
    document.getElementById('cashBuysNowText').textContent = `${fmtNum(m.cash.buysNow, 1, true)} USDT`;
    document.getElementById('cashBuysTargetText').textContent = `${fmtNum(m.cash.buysTarget, 1, true)} USDT`;

    const fillRatio = Math.min(100, Math.round((m.cash.targetUsdt / m.rates.usdt) * 100));
    document.getElementById('cashTargetFillPctText').textContent = `${toFa(fillRatio)}٪`;
    document.getElementById('cashTargetProgressFill').style.width = `${fillRatio}%`;

    document.getElementById('nftsCardGrid').innerHTML = m.nfts.length === 0
      ? `<div style="grid-column:1/-1; text-align:center; padding:1.2rem; color:var(--text-sub);">هیچ آیتم NFT در سبد موجود نیست.</div>`
      : m.nfts.map((nf, i) => {
        const pos = nf.pnlToman >= 0;
        return `
          <div class="nft-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <strong style="font-size:0.84rem;">${escapeHtml(nf.name)}</strong>
              <span class="badge ${pos ? 'badge-profit' : 'badge-loss'} num">${pos ? '+' : ''}${fmtNum(nf.pnlPct, 1, true)}٪</span>
            </div>
            <div style="font-size:0.73rem; color:var(--text-sub); display:grid; gap:0.25rem;">
              <div>قیمت خرید: <b class="num">${fmtMoney(nf.buyToman)}</b></div>
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <span>ارزش کف (Floor):</span>
                <input type="number" class="inline-input num sensitive-input" aria-label="ارزش کف ${escapeHtml(nf.name)}" value="${nf.floorToman}" onchange="window.updateNftFloor(${i}, this.value)" />
              </div>
              <div>سود/زیان کف: <b class="num" style="color:${pos ? 'var(--profit)' : 'var(--loss)'}">${fmtMoney(nf.pnlToman, true)}</b></div>
            </div>
            <div style="display:flex; gap:0.4rem; align-items:center;">
              <input type="text" aria-label="یادداشت ${escapeHtml(nf.name)}" value="${escapeHtml(nf.note || '')}" placeholder="یادداشت..." style="font-size:0.72rem; min-height:36px; padding:0.22rem 0.45rem;" onchange="window.updateNftNote(${i}, this.value)" />
              <button class="btn-sell" onclick="window.openSellNftInHub(${i})">فروش</button>
            </div>
          </div>
        `;
      }).join('');
  }

  function renderLoanFullTab(m) {
    const l = m.loan;
    const reqGrowth = l.loanPrincipal > 0 ? (l.totalInterest / l.loanPrincipal) * 100 : 0;
    const prog = Math.min(100, Math.max(0, (l.loanInvestedVal / l.breakEvenTargetToman) * 100));
    const isPos = l.loanInvestedVal >= l.breakEvenTargetToman;

    document.getElementById('loanArbitrageStatusPill').className = `badge ${isPos ? 'badge-profit' : 'badge-loss'}`;
    document.getElementById('loanArbitrageStatusPill').textContent = isPos ? 'آربیتراژ مثبت (سودده)' : 'زیر نقطه سر‌به‌سر';
    document.getElementById('loanBreakEvenCard').innerHTML = `
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.35rem;">
        <span><strong>نقطه سر‌به‌سر وام:</strong> <b class="num">${fmtMoney(l.breakEvenTargetToman)}</b> (+${fmtNum(reqGrowth, 1, true)}٪)</span>
        <strong style="color:${isPos ? 'var(--profit)' : 'var(--loss)'}">${isPos ? 'عبور از سر‌به‌سر' : 'زیر نقطه سر‌به‌سر'}</strong>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${prog}%"></div></div>
    `;
    document.getElementById('loanSummaryStatsBox').innerHTML = `
      <div>قسط ماهانه: <strong class="num">${fmtMoney(l.monthlyInst)}</strong></div>
      <div>کل سود بانکی: <strong class="num" style="color:var(--loss)">${fmtMoney(l.totalInterest)}</strong></div>
      <div>ارزش فعلی سبد وام: <strong class="num" style="color:var(--c-stable)">${fmtMoney(l.loanInvestedVal)}</strong></div>
      <div>سود خالص نسبت به اصل: <strong class="num" style="color:var(--profit)">${fmtMoney(l.netPnl, true)}</strong></div>
    `;

    // همگام‌سازی انتخابگر تاریخ شمسی شروع وام
    const { jy, jm, jd } = isoToJalaliParts(l.startDate || '2026-09-23');
    const jyEl = document.getElementById('loanJalaliYear');
    const jmEl = document.getElementById('loanJalaliMonth');
    const jdEl = document.getElementById('loanJalaliDay');
    if (jyEl && document.activeElement !== jyEl) jyEl.value = jy;
    if (jmEl && document.activeElement !== jmEl) jmEl.value = jm;
    if (jdEl && document.activeElement !== jdEl) jdEl.value = jd;

    document.getElementById('loanAssetsTableBody').innerHTML = l.items.map((it, idx) => `
      <tr>
        <td><strong>${escapeHtml(it.name)}</strong></td>
        <td><span class="badge badge-info">${escapeHtml(it.category)}</span></td>
        <td class="num">${fmtMoney(it.buyToman)}</td>
        <td><input type="number" class="inline-input num sensitive-input" style="width:92px;" value="${it.currentToman}" onchange="window.updateLoanItemVal(${idx}, this.value)" /></td>
        <td class="num" style="color:${it.pnl >= 0 ? 'var(--profit)' : 'var(--loss)'}; font-weight:800;">${fmtMoney(it.pnl, true)}</td>
        <td><button class="btn" style="min-height:36px; padding:0.2rem 0.5rem;" onclick="window.removeLoanAssetItem(${idx})">حذف</button></td>
      </tr>
    `).join('');

    // شبیه‌ساز تسویه زودهنگام وام
    const sim = l.earlyPayoffSim;
    const earlyMonthInp = document.getElementById('earlyPayoffMonthInput');
    const earlyDiscInp = document.getElementById('earlyPenaltyDiscountInput');
    if (earlyMonthInp && document.activeElement !== earlyMonthInp) earlyMonthInp.value = sim.payoffMonth;
    if (earlyDiscInp && document.activeElement !== earlyDiscInp) earlyDiscInp.value = l.earlyPenaltyDiscountPct ?? 90;

    const earlyBox = document.getElementById('earlyPayoffResultBox');
    if (earlyBox) {
      earlyBox.innerHTML = `
        <div>مانده اصل بدهی در ماه ${toFa(sim.payoffMonth)}: <strong class="num">${fmtMoney(sim.remainingPrincipalToman)}</strong></div>
        <div>سود ماه‌های آینده (${toFa(sim.remainingMonths)} ماه): <strong class="num">${fmtMoney(sim.remainingFutureInterestToman)}</strong></div>
        <div>سود بخشیده‌شده در تسویه زودهنگام: <strong class="num" style="color:var(--profit)">${fmtMoney(sim.interestSavedToman)}</strong></div>
        <div>مبلغ تسویه یک‌جا در ماه ${toFa(sim.payoffMonth)}: <strong class="num" style="color:var(--c-stable)">${fmtMoney(sim.lumpSumPayoffToman)}</strong></div>
      `;
    }

    const scenarios = [
      { title: "خوش‌بینانه", roi: 65, cls: "badge-profit" },
      { title: "پایه (تورمی)", roi: 40, cls: "badge-info" },
      { title: "بدبینانه", roi: 10, cls: "badge-loss" }
    ];
    document.getElementById('loanScenariosTableBody').innerHTML = scenarios.map(sc => {
      const fv = Math.round(l.loanPrincipal * (1 + sc.roi / 100)), net = fv - Math.round(l.totalRepayment);
      return `<tr><td><strong>${escapeHtml(sc.title)}</strong></td><td><span class="badge ${sc.cls} num">+${toFa(sc.roi)}٪</span></td><td class="num"><strong>${fmtMoney(fv)}</strong></td><td class="num">${fmtMoney(l.totalRepayment)}</td><td class="num" style="color:${net >= 0 ? 'var(--profit)' : 'var(--loss)'}; font-weight:800;">${fmtMoney(net, true)}</td></tr>`;
    }).join('');

    const startD = new Date(l.startDate || '2026-09-23');
    const paidSet = new Set(Array.isArray(l.paidInstallments) ? l.paidInstallments : [1]);
    let foundNext = false;
    const cardsHtml = [];
    for (let i = 1; i <= l.loanMonths; i++) {
      const dueD = new Date(startD.getTime() + i * 30 * 86400000);
      const paid = paidSet.has(i);
      const isNext = !paid && !foundNext;
      if (isNext) {
        foundNext = true;
        const dLeft = Math.ceil((dueD.getTime() - Date.now()) / 86400000);
        document.getElementById('loanNextDueBadge').textContent = `قسط بعدی (#${toFa(i)}): ${toFa(Math.max(0, dLeft))} روز مانده`;
      }
      cardsHtml.push(`
        <div class="loan-inst-card ${paid ? 'paid' : ''} ${isNext ? 'next-due' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>قسط ${toFa(i)}</strong>
            <input type="checkbox" aria-label="پرداخت قسط ${toFa(i)}" ${paid ? 'checked' : ''} style="width:18px; height:18px; min-height:18px; cursor:pointer;" onchange="window.toggleInstallmentPaid(${i}, this.checked)" />
          </div>
          <div class="num" style="color:var(--text-sub);">${fmtJalali(dueD)}</div>
          <div class="num" style="font-weight:800;">${fmtMoney(l.monthlyInst)}</div>
          <span class="badge ${paid ? 'badge-profit' : (isNext ? 'badge-loss' : 'badge-info')}" style="align-self:flex-start;">${paid ? 'پرداخت شد' : (isNext ? 'سررسید بعدی' : 'آینده')}</span>
        </div>
      `);
    }
    document.getElementById('loanVisualTimelineGrid').innerHTML = cardsHtml.join('');
    document.getElementById('loanPaidCountBadge').textContent = `پرداخت‌شده: ${toFa(paidSet.size)} از ${toFa(l.loanMonths)}`;
  }

  window.updateDollarMacroModel = function(saveHist = false) {
    const m = computeAll();
    const cur = m.rates.usdt;
    const cfg = state.portfolio.cfoConfig || DEFAULT_PORTFOLIO.cfoConfig;
    const w = pNum(document.getElementById('geoWarSlider')?.value, cfg.warScore);
    const s = pNum(document.getElementById('geoSanctionSlider')?.value, cfg.sancScore);
    const inf = pNum(document.getElementById('geoInflationSlider')?.value, cfg.infScore);
    const cbi = pNum(document.getElementById('geoCbiSlider')?.value, cfg.cbiScore);
    const wWar = pNum(document.getElementById('wWarInput')?.value, cfg.wWar);
    const wSanc = pNum(document.getElementById('wSancInput')?.value, cfg.sancScore);
    const wInf = pNum(document.getElementById('wInfInput')?.value, cfg.wInf);
    const wCbi = pNum(document.getElementById('wCbiInput')?.value, cfg.wCbi);
    const s1 = pNum(document.getElementById('smaStep1Pct')?.value, cfg.step1Pct ?? 0);
    const s2 = pNum(document.getElementById('smaStep2Pct')?.value, cfg.step2Pct ?? 2.5);
    const s3 = pNum(document.getElementById('smaStep3Pct')?.value, cfg.step3Pct ?? 7.5);

    document.getElementById('geoWarValText').textContent = toFa(w);
    document.getElementById('geoSanctionValText').textContent = toFa(s);
    document.getElementById('geoInflationValText').textContent = toFa(inf);
    document.getElementById('geoCbiValText').textContent = toFa(cbi);

    const s90 = Array.from({ length: 30 }, (_, i) => Math.round(cur * 0.935 + (cur * 0.065 * (i / 29)) + Math.sin(i * 0.4) * 2400));
    s90[29] = cur;
    const sma90 = Math.round(s90.reduce((a, b) => a + b, 0) / s90.length);
    const score = Number(((w * wWar + s * wSanc + inf * wInf - cbi * wCbi) / 100).toFixed(1));
    const distPct = ((cur - sma90) / sma90) * 100;

    if (saveHist) {
      state.portfolio.cfoConfig = { warScore: w, sancScore: s, infScore: inf, cbiScore: cbi, wWar, wSanc, wInf, wCbi, step1Pct: s1, step2Pct: s2, step3Pct: s3, scoreHistory: cfg.scoreHistory || [] };
      state.portfolio.cfoConfig.scoreHistory.push({ date: fmtJalali(new Date()).slice(5), score });
      saveP();
    }

    const dialCol = score >= 60 ? '#10b981' : (score <= 40 ? '#f43f5e' : '#f59e0b');
    document.getElementById('cfoPressureDialSvg').innerHTML = buildSemiGaugeSvg(score, dialCol, 'فشار بنیادی');

    const z1 = Math.round(sma90 * (1 + s1 / 100));
    const z2 = Math.round(sma90 * (1 + s2 / 100));
    const z3 = Math.round(sma90 * (1 + s3 / 100));
    const distFromBubblePct = ((cur - z3) / z3) * 100;
    const fairVal = Math.round(sma90 * 0.975 * (1 + (score - 45) / 380));
    const bubblePct = ((cur - fairVal) / fairVal) * 100;

    let stateLabel = 'صبر (نگهداری موجودی فعلی)';
    let stateCls = 'badge-warn';
    let stateReason = `قیمت فعلی (${fmtMoney(cur)}) به اندازه ${distPct >= 0 ? '+' : ''}${fmtNum(distPct, 1)}٪ با SMA90 فاصله دارد و امتیاز بنیادی (${fmtNum(score, 1)}) متعادل است.`;

    if (distPct <= s2 && score >= 50) {
      stateLabel = 'بخر (ورود پله‌ای)';
      stateCls = 'badge-profit';
      stateReason = `قیمت در محدوده حمایتی پله خرید (${fmtNum(distPct, 1)}٪ نسبت به SMA90) قرار دارد و نمره فشار کلان (${fmtNum(score, 1)} از ۱۰۰) محرک رشد است.`;
    } else if (cur >= z3 || (distPct > s3 && score < 45)) {
      stateLabel = 'بفروش / سیو سود (اشباع حباب)';
      stateCls = 'badge-loss';
      stateReason = `قیمت از مرز حباب تعیین‌شده (${fmtMoney(z3)}) عبور کرده است.`;
    }

    document.getElementById('cfoDollarValuationCard').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.3rem;">
        <span><strong>امتیاز فشار CFO: <span class="num" style="color:var(--c-stable)">${fmtNum(score, 1)} از ۱۰۰</span></strong></span>
        <span class="badge ${stateCls}">${escapeHtml(stateLabel)}</span>
      </div>
      <div style="font-size:0.74rem; color:var(--text-main); margin-top:0.15rem;">${stateReason}</div>
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.4rem; font-size:0.72rem; color:var(--text-sub); padding:0.35rem 0; border-top:1px dashed var(--border);" class="num">
        <span>فاصله از SMA90: <b>${distPct >= 0 ? '+' : ''}${fmtNum(distPct, 1)}٪</b></span>
        <span>فاصله تا مرز حباب: <b>${distFromBubblePct >= 0 ? '+' : ''}${fmtNum(distFromBubblePct, 1)}٪</b></span>
        <span>حباب ذاتی: <b>${bubblePct >= 0 ? '+' : ''}${fmtNum(bubblePct, 1)}٪</b></span>
      </div>
    `;

    document.getElementById('sma90StatusBadge').textContent = `SMA 90: ${fmtNum(sma90, 0, true)} ت`;
    document.getElementById('sma90BuyZonesBox').innerHTML = `
      <div style="padding:0.45rem; background:var(--profit-soft); border-radius:8px;"><div style="color:var(--profit); font-weight:700;">پله ۱ (${toFa(s1)}٪)</div><b class="num">${fmtMoney(z1)}</b></div>
      <div style="padding:0.45rem; background:var(--warn-soft); border-radius:8px;"><div style="color:var(--warn); font-weight:700;">پله ۲ (+${toFa(s2)}٪)</div><b class="num">${fmtMoney(z2)}</b></div>
      <div style="padding:0.45rem; background:var(--loss-soft); border-radius:8px;"><div style="color:var(--loss); font-weight:700;">مرز حباب (+${toFa(s3)}٪)</div><b class="num">${fmtMoney(z3)}</b></div>
    `;

    if (typeof Chart !== 'undefined') {
      const ctx = document.getElementById('dollarSma90Canvas')?.getContext('2d');
      if (ctx) {
        if (state.charts.sma) state.charts.sma.destroy();
        state.charts.sma = new Chart(ctx, {
          type: 'line',
          data: {
            labels: s90.map((_, i) => `روز ${toFa(i * 3 + 1)}`),
            datasets: [
              { label: 'دلار آزاد (هزار ت)', data: s90.map(v => Math.round(v / 1000)), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.1)', fill: true, tension: 0.3 },
              { label: 'پله ۱ خرید (SMA90)', data: s90.map(() => Math.round(z1 / 1000)), borderColor: '#10b981', borderDash: [5,5], pointRadius: 0, fill: false },
              { label: 'مرز حباب', data: s90.map(() => Math.round(z3 / 1000)), borderColor: '#f43f5e', borderDash: [2,4], pointRadius: 0, fill: false }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: getPrivacyAwareChartPlugins('هزار تومان'),
            scales: { y: getPrivacyAwareYScale('#94a3b8') }
          }
        });
      }
    }
  };

  function renderRedesignedRiskTab(m, qRisk) {
    const dial = document.getElementById('portfolioHealthDial');
    if (dial) {
      dial.textContent = state.isMasked ? '**' : toFa(qRisk.healthScore);
      dial.style.borderColor = qRisk.healthScore >= 70 ? 'var(--profit)' : 'var(--warn)';
    }

    document.getElementById('quantMetricsCards').innerHTML = `
      <div class="card" style="padding:0.65rem; margin:0;"><div style="font-size:0.7rem; color:var(--text-sub);">بازده واقعی (XIRR)</div><div class="num" style="font-size:1rem; font-weight:900; color:var(--profit);">${m.xirrPct >= 0 ? '+' : ''}${fmtNum(m.xirrPct, 1, true)}٪</div></div>
      <div class="card" style="padding:0.65rem; margin:0;"><div style="font-size:0.7rem; color:var(--text-sub);">نسبت شارپ</div><div class="num" style="font-size:1rem; font-weight:900; color:var(--c-stable);">${fmtNum(qRisk.sharpe, 2, true)}</div></div>
      <div class="card" style="padding:0.65rem; margin:0;"><div style="font-size:0.7rem; color:var(--text-sub);">Max Drawdown</div><div class="num" style="font-size:1rem; font-weight:900; color:var(--loss);">${fmtNum(qRisk.maxDdPct, 2, true)}٪</div></div>
      <div class="card" style="padding:0.65rem; margin:0;"><div style="font-size:0.7rem; color:var(--text-sub);">بازده TWR</div><div class="num" style="font-size:1rem; font-weight:900; color:var(--profit);">+${fmtNum(qRisk.twrPct, 1, true)}٪</div></div>
    `;

    const classNames = { bourse: 'بورس ایران', crypto: 'رمزارز', stable: 'استیبل‌کوین', cash: 'نقدینگی ریالی', nft: 'NFT تلگرام', gold: 'طلا' };
    const targets = state.portfolio.rebalanceTargets || DEFAULT_PORTFOLIO.rebalanceTargets;
    const sumT = Object.values(targets).reduce((a, b) => a + pNum(b, 0), 0);
    document.getElementById('rebalanceSumBadge').textContent = `جمع هدف: ${toFa(sumT)}٪ (مرز تحمل: ±۲٪)`;

    const tolerancePct = 2.0;
    const bourseFeeRatio = pNum(state.portfolio.riskSettings?.bourseFeePct, 0.88) / 100;

    const planRows = Object.keys(classNames).map(k => {
      const curVal = m.classTotals[k] || 0;
      const curPct = m.gross > 0 ? (curVal / m.gross) * 100 : 0;
      const tarPct = pNum(targets[k], 0);
      const diffPct = curPct - tarPct;
      const targetVal = m.gross * (tarPct / 100);
      const rawDeltaToman = targetVal - curVal;
      const withinTolerance = Math.abs(diffPct) <= tolerancePct;

      const feeRate = k === 'bourse' ? bourseFeeRatio : (k === 'crypto' || k === 'stable' ? 0.0025 : 0);
      const feeToman = withinTolerance ? 0 : Math.round(Math.abs(rawDeltaToman) * feeRate);
      const netExecutionToman = withinTolerance ? 0 : (rawDeltaToman > 0 ? Math.round(rawDeltaToman + feeToman) : Math.round(Math.abs(rawDeltaToman) - feeToman));

      return {
        key: k, title: classNames[k], color: SEMANTIC_COLORS[k] || '#3b82f6',
        curVal, curPct, tarPct, diffPct, rawDeltaToman, withinTolerance,
        actionType: withinTolerance ? 'hold' : (rawDeltaToman < 0 ? 'sell' : 'buy'),
        netExecutionToman, feeToman
      };
    });

    document.getElementById('rebalanceDualBarsBox').innerHTML = `
      <div class="table-box">
        <table>
          <thead><tr><th>کلاس دارایی</th><th>فعلی / هدف</th><th>انحراف</th><th>مبلغ اقدام (با احتساب کارمزد)</th></tr></thead>
          <tbody>
            ${planRows.map(r => {
              let badgeCls = 'badge-info';
              let actionLabel = 'در محدوده تحمل (±۲٪)';
              if (r.actionType === 'sell') {
                badgeCls = 'badge-loss';
                actionLabel = `فروش: ${fmtMoney(r.netExecutionToman)}`;
              } else if (r.actionType === 'buy') {
                badgeCls = 'badge-profit';
                actionLabel = `خرید: ${fmtMoney(r.netExecutionToman)}`;
              }
              return `
                <tr>
                  <td><strong><span style="color:${r.color}">●</span> ${escapeHtml(r.title)}</strong></td>
                  <td class="num">${fmtNum(r.curPct, 1, true)}٪ / <b>${fmtNum(r.tarPct, 0)}٪</b></td>
                  <td class="num" style="color:${r.withinTolerance ? 'var(--text-sub)' : 'var(--warn)'}">${r.diffPct >= 0 ? '+' : ''}${fmtNum(r.diffPct, 1, true)}٪</td>
                  <td class="num"><span class="badge ${badgeCls}">${actionLabel}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('realizedUnrealizedBox').innerHTML = `
      <div style="display:flex; justify-content:space-between;"><span>سود/زیان تحقق‌نیافته (باز):</span><strong class="num" style="color:var(--profit)">${fmtMoney(m.unrealizedPnl, true)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>سود/زیان تحقق‌یافته (قطعی):</span><strong class="num" style="color:var(--c-stable)">${fmtMoney(m.realizedPnl, true)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>جمع سود نقدی سهام/صندوق (DPS):</span><strong class="num" style="color:var(--profit)">+${fmtMoney(m.totalDividends)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>جمع کارمزدهای ثبت‌شده:</span><strong class="num" style="color:var(--loss)">-${fmtMoney(m.totalFees)}</strong></div>
    `;
  }

  // نمودار رشد ثروت به تومان و دلار (کنار هم برای سنجش واقعی بازده در تورم)
  window.renderOverviewCharts = function(mIn, qRiskIn) {
    if (typeof Chart === 'undefined') return;
    const m = mIn || computeAll();
    const qRisk = qRiskIn || computeQuantRisk(m);
    const vals = [m.stocksVal, m.stableValToman, m.cash.totalCash, m.nftsVal, m.loan.loanInvestedVal];
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const pcts = vals.map(v => ((v / total) * 100).toFixed(1));
    const titles = ['بورس ایران', 'استیبل‌کوین', 'نقدینگی', 'NFT تلگرام', 'وام ۳۰M'];
    const colors = [SEMANTIC_COLORS.bourse, SEMANTIC_COLORS.stable, SEMANTIC_COLORS.cash, SEMANTIC_COLORS.nft, SEMANTIC_COLORS.loan];

    document.getElementById('donutPercentLegend').innerHTML = titles.map((t, i) => `
      <div class="donut-legend-box">
        <div class="num" style="color:${colors[i]}; font-weight:800;">${state.isMasked ? '**٪' : toFa(pcts[i]) + '٪'}</div>
        <div style="color:var(--text-sub); font-size:0.66rem;">${escapeHtml(t)}</div>
      </div>
    `).join('');

    const dCtx = document.getElementById('allocationDonutCanvas')?.getContext('2d');
    if (dCtx) {
      if (state.charts.donut) state.charts.donut.destroy();
      state.charts.donut = new Chart(dCtx, {
        type: 'doughnut',
        data: {
          labels: titles,
          datasets: [{ data: vals.map(v => Math.round(v / 1e6)), backgroundColor: colors, borderWidth: 0 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '64%',
          plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'Vazirmatn', size: 10 } } },
            ...getPrivacyAwareChartPlugins('میلیون تومان')
          }
        }
      });
    }

    const lCtx = document.getElementById('wealthGrowthLineCanvas')?.getContext('2d');
    if (lCtx) {
      if (state.charts.wLine) state.charts.wLine.destroy();
      const r = document.getElementById('historyRangeSelect')?.value || 'all';
      const curMode = document.getElementById('historyCurrencyModeSelect')?.value || 'both';
      const list = r === 'all' ? state.history : state.history.slice(-Number(r));

      document.getElementById('drawdownChartMeta').innerHTML = `بازده واقعی سالانه (XIRR): <b style="color:var(--profit)">+${fmtNum(m.xirrPct, 1, true)}٪</b> | حداکثر افت (Max DD: ${fmtNum(qRisk.maxDdPct, 2, true)}٪)`;

      const datasets = [];
      if (curMode === 'toman' || curMode === 'both') {
        datasets.push({
          label: 'ثروت کل (میلیون تومان)',
          data: list.map(h => Number((h.totalToman / 1e6).toFixed(1))),
          borderColor: SEMANTIC_COLORS.bourse,
          backgroundColor: 'rgba(59,130,246,0.12)',
          fill: true,
          tension: 0.35,
          yAxisID: 'yToman'
        });
      }
      if (curMode === 'usd' || curMode === 'both') {
        datasets.push({
          label: 'ثروت به دلار آزاد ($)',
          data: list.map(h => {
            const rate = pNum(h.usdRate, m.rates.freeUsd);
            return Number((pNum(h.totalToman, 0) / Math.max(55000, rate)).toFixed(1));
          }),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          borderDash: curMode === 'both' ? [4, 3] : [],
          fill: curMode === 'usd',
          tension: 0.35,
          yAxisID: 'yUsd'
        });
      }

      const scalesObj = {
        x: { ticks: { color: '#94a3b8', font: { family: 'Vazirmatn', size: 10 } } }
      };
      if (curMode === 'toman' || curMode === 'both') {
        scalesObj.yToman = {
          type: 'linear',
          position: 'right',
          ...getPrivacyAwareYScale('#3b82f6', '', 'M')
        };
      }
      if (curMode === 'usd' || curMode === 'both') {
        scalesObj.yUsd = {
          type: 'linear',
          position: curMode === 'both' ? 'left' : 'right',
          grid: { drawOnChartArea: curMode === 'usd' },
          ...getPrivacyAwareYScale('#10b981', '$', '')
        };
      }

      state.charts.wLine = new Chart(lCtx, {
        type: 'line',
        data: {
          labels: list.map(h => (h.jalaliDate || fmtJalali(h.date)).slice(5)),
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: getPrivacyAwareChartPlugins(''),
          scales: scalesObj
        }
      });
    }

    const loanCtx = document.getElementById('loanYearEndChartCanvas')?.getContext('2d');
    if (loanCtx) {
      if (state.charts.lChart) state.charts.lChart.destroy();
      const l = m.loan;
      const mLabels = Array.from({ length: 12 }, (_, i) => `ماه ${toFa(i + 1)}`);
      state.charts.lChart = new Chart(loanCtx, {
        type: 'line',
        data: {
          labels: mLabels,
          datasets: [
            { label: 'ارزش سبد وام (میلیون ت)', data: mLabels.map((_, i) => Number(((l.loanInvestedVal * Math.pow(1 + 0.38 / 12, i + 1)) / 1e6).toFixed(1))), borderColor: '#10b981', fill: true, backgroundColor: 'rgba(16,185,129,0.12)' },
            { label: 'کل بدهی بانک', data: mLabels.map((_, i) => Number(((l.loanPrincipal + l.totalInterest * ((i + 1) / 12)) / 1e6).toFixed(1))), borderColor: SEMANTIC_COLORS.loan, borderDash: [5,5], fill: false }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: getPrivacyAwareChartPlugins('میلیون تومان'),
          scales: { y: getPrivacyAwareYScale('#94a3b8', '', 'M') }
        }
      });
    }
  };

  function renderAlertsAndTransactionsTab(m) {
    const alerts = state.portfolio.alerts || [];
    document.getElementById('alertsCardsContainer').innerHTML = alerts.length === 0
      ? `<div style="text-align:center; padding:1rem; color:var(--text-sub);">هیچ هشداری ثبت نشده است.</div>`
      : alerts.map((al, i) => {
        const curP = al.asset === 'USDT' ? m.rates.usdt : (['BTC','ETH'].includes(al.asset) ? pNum(state.prices.crypto?.[al.asset]?.priceUsd, 0) : pNum(getStockLiveObj(al.asset)?.priceToman, 0));
        const hit = al.cond === 'below' ? (curP <= al.target && curP > 0) : (curP >= al.target);
        const ratio = curP > 0 ? Math.min(100, Math.round((Math.min(curP, al.target) / Math.max(curP, al.target)) * 100)) : 50;
        return `
          <div style="background:var(--bg-input); padding:0.55rem 0.7rem; border-radius:9px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:0.74rem;">
            <strong>${escapeHtml(al.asset)} (${al.cond === 'below' ? '≤' : '≥'} ${fmtNum(al.target, 0, true)})</strong>
            <span class="num">فعلی: ${fmtNum(curP, 0, true)}</span>
            <span class="badge ${hit ? 'badge-loss' : 'badge-info'}">${hit ? 'فعال شد!' : toFa(ratio) + '٪'}</span>
            <button class="btn" style="min-height:34px; padding:0.15rem 0.45rem;" onclick="window.removePriceAlert(${i})">حذف</button>
          </div>
        `;
      }).join('');
    window.renderTransactionsTable();
  }

  window.renderTransactionsTable = function() {
    const fType = document.getElementById('txFilterType')?.value || 'all';
    const q = normFa(document.getElementById('txSearchInput')?.value || '').toLowerCase();
    const list = (state.portfolio.transactions || []).filter(tx => (fType === 'all' || tx.type === fType) && (!q || normFa(tx.asset).toLowerCase().includes(q) || normFa(tx.note).toLowerCase().includes(q)));
    document.getElementById('transactionsTableBody').innerHTML = list.length === 0
      ? `<tr><td colspan="6" style="text-align:center; padding:1rem; color:var(--text-sub);">تراکنشی یافت نشد.</td></tr>`
      : list.map(tx => `
        <tr>
          <td class="num">${escapeHtml(tx.date)}</td>
          <td><span class="badge ${tx.type === 'سود نقدی' ? 'badge-profit' : (tx.type === 'کارمزد' ? 'badge-loss' : 'badge-info')}">${escapeHtml(tx.type)}</span></td>
          <td><strong>${escapeHtml(tx.asset)}</strong></td>
          <td class="num"><b>${fmtMoney(tx.amountToman)}</b></td>
          <td class="num" style="color:var(--text-sub);">${pNum(tx.feeToman, 0) > 0 ? fmtMoney(tx.feeToman) : '-'}</td>
          <td>${escapeHtml(tx.note || '-')}</td>
        </tr>
      `).join('');
  };

  window.renderGlobalComparison = function() {
    const items = [
      { name: "بیت‌کوین (BTC)", usdRet: 48.0, mult: 1.88, color: SEMANTIC_COLORS.crypto },
      { name: "طلای ۱۸ عیار / سکه", usdRet: 34.5, mult: 1.72, color: SEMANTIC_COLORS.gold },
      { name: "سهام آمریکا — Nasdaq 100", usdRet: 27.8, mult: 1.63, color: SEMANTIC_COLORS.nft },
      { name: "سبد واقعی شما (با وام ۳۰M)", usdRet: 24.5, mult: 1.58, isMe: true, color: '#10b981' },
      { name: "سهام آمریکا — S&P 500", usdRet: 22.4, mult: 1.56, color: SEMANTIC_COLORS.bourse },
      { name: "خط تورم رسمی ایران", usdRet: -8.0, mult: 1.42, color: SEMANTIC_COLORS.loan },
      { name: "دلار بازار آزاد ایران", usdRet: 0.0, mult: 1.28, color: SEMANTIC_COLORS.stable },
      { name: "شاخص کل بورس (TEDPIX)", usdRet: -3.5, mult: 1.23, color: SEMANTIC_COLORS.cash }
    ];
    const cap = 200000000, myVal = cap * 1.58;
    document.getElementById('globalCompareTableBody').innerHTML = items.map((it, i) => {
      const fv = Math.round(cap * it.mult), diff = Math.round(myVal - fv);
      return `<tr style="${it.isMe ? 'background:rgba(16,185,129,0.16); font-weight:800;' : ''}"><td class="num">#${toFa(i + 1)}</td><td><strong>${escapeHtml(it.name)}</strong></td><td><span class="badge badge-info num">${it.usdRet >= 0 ? '+' : ''}${fmtNum(it.usdRet, 1, true)}٪ $</span></td><td><span class="badge badge-profit num">+${fmtNum((it.mult - 1) * 100, 0, true)}٪</span></td><td class="num"><strong>${fmtMoney(fv)}</strong></td><td class="num">${it.isMe ? 'جایگاه سبد شما' : (diff >= 0 ? fmtMoney(diff) + ' جلوتر' : fmtMoney(Math.abs(diff)) + ' عقب‌تر')}</td></tr>`;
    }).join('');
    if (typeof Chart !== 'undefined') {
      const ctx = document.getElementById('globalCompareBarCanvas')?.getContext('2d');
      if (ctx) {
        if (state.charts.gBar) state.charts.gBar.destroy();
        state.charts.gBar = new Chart(ctx, {
          type: 'bar',
          data: { labels: items.map(i => i.name), datasets: [{ label: 'بازده تومانی (%)', data: items.map(i => Math.round((i.mult - 1) * 100)), backgroundColor: items.map(i => i.color), borderRadius: 6 }] },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, ...getPrivacyAwareChartPlugins('%') },
            scales: { x: getPrivacyAwareYScale('#94a3b8', '', '%') }
          }
        });
      }
    }
  };

  window.renderTerminal = function() {
    const m = computeAll();
    const qRisk = computeQuantRisk(m);

    document.getElementById('jalaliHeaderDate').textContent = fmtJalali(new Date());
    renderTopBannersAndFreshness(m);
    renderGoalWidget(m);

    const fxMeta = getPriceAgeMeta(state.prices.fx?.updatedAt || state.prices.lastUpdated, 60, 180, state.prices.fx?.source || 'گیت‌هاب', state.prices.fx?.isManual);
    document.getElementById('liveUsdBadge').textContent = `دلار آزاد: ${fmtNum(m.rates.usdt, 0, true)} ت (${fxMeta.text})`;
    document.getElementById('liveGoldBadge').textContent = `طلای ۱۸ عیار: ${fmtNum(m.rates.gold, 0, true)} ت`;

    const cMap = state.prices.crypto || DEFAULT_PRICES.crypto;
    document.getElementById('liveCryptoBadge').textContent = `BTC: ${fmtUsd(cMap.BTC?.priceUsd, 0)} | ETH: ${fmtUsd(cMap.ETH?.priceUsd, 0)} | SOL: ${fmtUsd(cMap.SOL?.priceUsd, 1)}`;

    document.getElementById('heroGrossWealth').textContent = fmtMoney(m.gross);
    document.getElementById('heroUsdEquiv').textContent = fmtUsd(m.grossUsd, 1);
    document.getElementById('heroNetAfterLoan').textContent = fmtMoney(m.netAfterLoan);
    document.getElementById('heroLoanDebt').textContent = fmtMoney(m.loan.loanPrincipal);

    const sparkSlice = state.history.slice(-state.heroSparkDays).map(h => h.totalToman);
    document.getElementById('heroSparklineSvg').innerHTML = buildSparklineSvg(sparkSlice, '#06b6d4', 120, 40);

    const segs = [
      { val: m.stableValToman, col: SEMANTIC_COLORS.stable, name: 'استیبل‌کوین' },
      { val: m.nftsVal, col: SEMANTIC_COLORS.nft, name: 'NFT' },
      { val: m.cash.totalCash, col: SEMANTIC_COLORS.cash, name: 'نقد' },
      { val: m.loan.loanInvestedVal, col: SEMANTIC_COLORS.loan, name: 'وام' },
      { val: m.stocksVal, col: SEMANTIC_COLORS.bourse, name: 'بورس' }
    ];
    document.getElementById('heroMultiAllocBar').innerHTML = segs.map(sg => `<div class="multi-alloc-seg" style="width:${((sg.val / (m.gross || 1)) * 100).toFixed(1)}%; background:${sg.col};" title="${escapeHtml(sg.name)}"></div>`).join('');

    // سود امروز و کل و XIRR
    const dPos = m.pnl.d.a >= 0;
    document.getElementById('pnlDailyAmount').textContent = fmtMoney(m.pnl.d.a, true);
    document.getElementById('pnlDailyAmount').style.color = dPos ? 'var(--profit)' : 'var(--loss)';
    document.getElementById('pnlDailyUsd').textContent = `${fmtUsd(m.pnl.d.usd, 2, true)} (${dPos ? '+' : ''}${fmtNum(m.pnl.d.p, 2, true)}٪)`;

    const tPos = m.pnl.t.a >= 0;
    document.getElementById('pnlTotalAmount').textContent = fmtMoney(m.pnl.t.a, true);
    document.getElementById('pnlTotalAmount').style.color = tPos ? 'var(--profit)' : 'var(--loss)';
    document.getElementById('pnlTotalUsd').textContent = `XIRR سالانه: +${fmtNum(m.xirrPct, 1, true)}٪ (${fmtUsd(m.pnl.t.usd, 1, true)})`;

    document.getElementById('cardBourseVal').textContent = fmtMoney(m.stocksVal);
    document.getElementById('cardBourseSub').textContent = `سود: ${fmtMoney(m.stocksPnl, true)} (${fmtUsd(m.stocksPnlUsd, 1)})`;
    document.getElementById('cardStableVal').textContent = fmtMoney(m.stableValToman);
    document.getElementById('cardStableSub').textContent = `${fmtUsd(m.stableUsd, 2)} در شبکه اتریوم`;
    document.getElementById('cardCashVal').textContent = fmtMoney(m.cash.totalCash);
    document.getElementById('cardNftVal').textContent = fmtMoney(m.nftsVal);
    document.getElementById('cardLoanAssetVal').textContent = fmtMoney(m.loan.loanInvestedVal);
    document.getElementById('cardLoanAssetSub').textContent = `سود وام: ${fmtMoney(m.loan.netPnl, true)}`;

    renderDailyCommander(m, qRisk);
    renderStocksTreemapAndTable(m);
    populateDcaPresets(m);
    window.calcDcaSniper();
    renderCryptoDipAndGauges(m);
    renderCashAndNftCards(m);
    renderLoanFullTab(m);
    window.updateDollarMacroModel(false);
    renderRedesignedRiskTab(m, qRisk);
    renderAlertsAndTransactionsTab(m);
    window.renderOverviewCharts(m, qRisk);
    window.renderGlobalComparison(m);
  };

  window.WD_RENDER = {
    fmtNum, fmtMoney, fmtUsd
  };
})(window);
