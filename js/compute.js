/**
 * js/compute.js — موتور محاسبات مالی، بازده واقعی XIRR، شبیه‌ساز تسویه زودهنگام وام،
 * بررسی وضعیت ساعات بازار و کهنگی قیمت‌ها (> ۶ ساعت یا نماد مشکوک)
 */
(function(window) {
  'use strict';

  const { state, pNum, normFa, fmtJalali, DEFAULT_PORTFOLIO, KEY_HIST, safeSetStorage } = window.WD_DATA;

  function autoDetectAssetCategory(nameStr) {
    const s = normFa(nameStr).toLowerCase();
    if (s.includes('بیت') || s.includes('btc') || s.includes('اتریوم') || s.includes('eth') || s.includes('سولانا') || s.includes('تتر')) return 'رمزارز و کریپتو';
    if (s.includes('طلا') || s.includes('سکه') || s.includes('عیار') || s.includes('کهربا')) return 'طلا و صندوق طلا';
    if (s.includes('ثابت') || s.includes('بانک')) return 'درآمد ثابت';
    return 'سهام و صندوق بورسی';
  }

  function getStockLiveObj(symbol) {
    const map = state.prices.stocks || {};
    if (map[symbol] && pNum(map[symbol].priceToman, 0) > 0) return map[symbol];
    const target = normFa(symbol);
    for (const [k, v] of Object.entries(map)) {
      if (normFa(k) === target && pNum(v?.priceToman, 0) > 0) return v;
    }
    return null;
  }

  // تشخیص ساعات کاری بورس تهران (شنبه تا چهارشنبه، ۰۹:۰۰ تا ۱۲:۳۰ به وقت تهران UTC+03:30)
  function getTehranMarketSchedule() {
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const tehranDate = new Date(utcMs + (3.5 * 3600000));
    const day = tehranDate.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const hours = tehranDate.getHours() + (tehranDate.getMinutes() / 60);
    const isTradingDay = [6, 0, 1, 2, 3].includes(day);
    const isMarketOpen = isTradingDay && hours >= 9.0 && hours <= 12.5;
    return {
      isTradingDay,
      isMarketOpen,
      statusText: isMarketOpen ? 'بازار بورس باز است' : 'بازار بورس بسته است (رمزارز ۲۴ ساعته)'
    };
  }

  // بررسی کهنگی قیمت بورس (> ۶ ساعت در روز کاری) و نمادهای مشکوک (تغییر روزانه غیرعادی > ۱۵٪)
  function checkStaleAndSuspectStatus(stocksComputed) {
    const sched = getTehranMarketSchedule();
    const lastUpIso = state.prices?.lastUpdated;
    let ageHours = 0;
    if (lastUpIso) {
      ageHours = Math.max(0, (Date.now() - new Date(lastUpIso).getTime()) / 3600000);
    }
    const ageMinutes = Math.round(ageHours * 60);
    const suspectSymbols = [];
    let staleCount = 0;

    stocksComputed.forEach(s => {
      const liveObj = getStockLiveObj(s.symbol);
      if (liveObj?.stale) staleCount++;
      if (liveObj?.suspect || Math.abs(pNum(s.dailyChangePct, 0)) > 15) {
        suspectSymbols.push(`${s.symbol} (${s.dailyChangePct >= 0 ? '+' : ''}${s.dailyChangePct.toFixed(1)}٪)`);
      }
    });

    const isStaleAlert = (sched.isTradingDay && ageHours > 6) || (ageHours > 24);
    return {
      ageHours,
      ageMinutes,
      marketStatusText: sched.statusText,
      isMarketOpen: sched.isMarketOpen,
      isStaleAlert,
      staleCount,
      suspectSymbols,
      hasWarningBanner: isStaleAlert || suspectSymbols.length > 0
    };
  }

  // محاسبه بازده واقعی سالانه (XIRR) به روش نیوتن-رافسون با احتساب جریان‌های نقدی (واریز/برداشت/سود سهام)
  function computeXirrAnnualPct(transactions, currentNetWorthToman) {
    const flows = [];
    const nowDate = new Date();

    (transactions || []).forEach(tx => {
      const amt = pNum(tx.amountToman, 0);
      if (amt <= 0) return;
      const d = tx.isoDate ? new Date(tx.isoDate) : new Date(Date.now() - 30 * 86400000);
      if (isNaN(d.getTime())) return;

      if (tx.type === 'واریز') {
        flows.push({ amount: -amt, date: d });
      } else if (tx.type === 'برداشت' || tx.type === 'سود نقدی') {
        flows.push({ amount: amt, date: d });
      }
    });

    if (flows.length === 0) {
      const firstH = state.history[0];
      const baseVal = pNum(firstH?.totalToman, 240000000);
      const baseDate = firstH?.date ? new Date(firstH.date) : new Date(Date.now() - 38 * 86400000);
      flows.push({ amount: -baseVal, date: baseDate });
    }

    flows.push({ amount: Math.max(1, currentNetWorthToman), date: nowDate });
    flows.sort((a, b) => a.date - b.date);

    const t0 = flows[0].date.getTime();
    const totalDays = Math.max(1, (nowDate.getTime() - t0) / 86400000);
    if (totalDays < 1) return 0;

    let rate = 0.25; // حدس اولیه ۲۵٪ سالانه
    for (let iter = 0; iter < 50; iter++) {
      let fVal = 0;
      let dfVal = 0;
      for (const cf of flows) {
        const yrs = Math.max(0, (cf.date.getTime() - t0) / (365.0 * 86400000));
        const base = Math.max(0.05, 1 + rate);
        fVal += cf.amount / Math.pow(base, yrs);
        if (yrs > 0) {
          dfVal -= (yrs * cf.amount) / Math.pow(base, yrs + 1);
        }
      }
      if (Math.abs(fVal) < 1) break;
      if (Math.abs(dfVal) < 1e-9) break;
      const nextRate = rate - (fVal / dfVal);
      rate = Math.min(5.0, Math.max(-0.90, nextRate));
    }

    return Number((rate * 100).toFixed(2));
  }

  // شبیه‌ساز تسویه زودهنگام وام (Early Loan Payoff Simulator)
  function simulateLoanEarlyPayoff(loanObj, payoffAfterMonth, penaltyDiscountPct) {
    const P = Math.max(1, pNum(loanObj.principalToman, 30000000));
    const annualRate = Math.max(0, pNum(loanObj.annualRatePct, 23));
    const n = Math.max(1, pNum(loanObj.months, 12));
    const k = Math.min(n - 1, Math.max(1, Math.round(pNum(payoffAfterMonth, 6))));
    const discPct = Math.min(100, Math.max(0, pNum(penaltyDiscountPct, 90)));

    const r = (annualRate / 100) / 12;
    const monthlyInst = r > 0 ? (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : P / n;

    let remPrincipal = P;
    let paidInterestSoFar = 0;
    for (let m = 1; m <= k; m++) {
      const interestPart = remPrincipal * r;
      const principalPart = monthlyInst - interestPart;
      paidInterestSoFar += interestPart;
      remPrincipal = Math.max(0, remPrincipal - principalPart);
    }

    const remainingMonths = n - k;
    const remainingTotalPayments = monthlyInst * remainingMonths;
    const remainingFutureInterest = Math.max(0, remainingTotalPayments - remPrincipal);
    const interestSavedToman = Math.round(remainingFutureInterest * (discPct / 100));
    const lumpSumPayoffToman = Math.round(remPrincipal + (remainingFutureInterest - interestSavedToman));

    return {
      payoffMonth: k,
      remainingMonths,
      remainingPrincipalToman: Math.round(remPrincipal),
      remainingFutureInterestToman: Math.round(remainingFutureInterest),
      interestSavedToman,
      lumpSumPayoffToman
    };
  }

  function computeAll() {
    const p = state.portfolio;
    const pr = state.prices;
    const usdt = Math.max(55000, pNum(pr.fx?.usdtToman, 270100));
    const freeUsd = Math.max(55000, pNum(pr.fx?.freeUsdToman, Math.round(usdt * 0.996)));
    const gold = Math.max(2000000, pNum(pr.fx?.gold18kToman, 17850000));
    const feeRatio = pNum(p.riskSettings?.bourseFeePct, 0.88) / 100;

    let stocksVal = 0, stocksCost = 0;
    const stocks = (p.stocks || []).map((s, origIdx) => {
      const qty = pNum(s.qty, 0);
      const buy = pNum(s.avgBuyToman, 0);
      const liveObj = getStockLiveObj(s.symbol);
      const cur = liveObj ? pNum(liveObj.priceToman, buy) : buy;
      const chg = liveObj ? pNum(liveObj.dailyChangePct, 0) : 0;
      const val = Math.round(qty * cur * (1 - feeRatio));
      const cost = Math.round(qty * buy);
      const pnlToman = val - cost;
      stocksVal += val;
      stocksCost += cost;
      return {
        ...s,
        origIdx,
        qty,
        avgBuyToman: buy,
        currentPriceToman: cur,
        dailyChangePct: chg,
        valueToman: val,
        costToman: cost,
        pnlToman,
        pnlUsd: pnlToman / usdt,
        pnlPct: cost > 0 ? (pnlToman / cost) * 100 : 0,
        suspect: Boolean(liveObj?.suspect || Math.abs(chg) > 15)
      };
    });

    let stableUsd = 0;
    const stablecoins = (p.stablecoins || []).map(st => {
      const u = pNum(st.amount, 0) * pNum(st.pegUsd, 1);
      stableUsd += u;
      return { ...st, usdValue: u, valueFreeToman: u * freeUsd, valueUsdtToman: u * usdt };
    });
    const stableValToman = stableUsd * usdt;

    const bankCash = pNum(p.cash?.amountToman, 46000000);
    const brokerCash = pNum(p.cash?.brokerPowerToman, 978278);
    const totalCash = bankCash + brokerCash;
    const targetUsdt = Math.max(55000, pNum(p.cash?.targetUsdtToman, 248000));

    let nftsVal = 0, nftsCost = 0;
    const nfts = (p.nfts || []).map(nf => {
      const b = pNum(nf.buyToman, 0);
      const floor = pNum(nf.floorToman !== undefined ? nf.floorToman : nf.currentToman, b);
      nftsVal += floor;
      nftsCost += b;
      return { ...nf, buyToman: b, floorToman: floor, pnlToman: floor - b, pnlPct: b > 0 ? ((floor - b) / b) * 100 : 0 };
    });

    const l = p.loan || DEFAULT_PORTFOLIO.loan;
    const loanPrincipal = pNum(l.principalToman, 30000000);
    const loanRate = pNum(l.annualRatePct, 23);
    const loanMonths = Math.max(1, pNum(l.months, 12));
    const loanItems = Array.isArray(l.items) ? l.items : DEFAULT_PORTFOLIO.loan.items;

    let loanInvestedVal = 0, goldInLoan = 0, cryptoInLoan = 0, bourseInLoan = 0;
    const enrichedLoanItems = loanItems.map(it => {
      const b = pNum(it.buyToman, 0), c = pNum(it.currentToman, b);
      const cat = it.category || autoDetectAssetCategory(it.name);
      loanInvestedVal += c;
      if (cat.includes('طلا')) goldInLoan += c;
      else if (cat.includes('رمزارز')) cryptoInLoan += c;
      else bourseInLoan += c;
      return { ...it, category: cat, buyToman: b, currentToman: c, pnl: c - b, pct: b > 0 ? ((c - b) / b) * 100 : 0 };
    });
    if (loanInvestedVal === 0) loanInvestedVal = loanPrincipal;

    const mRate = (loanRate / 100) / 12;
    const monthlyInst = mRate > 0 ? (loanPrincipal * mRate * Math.pow(1 + mRate, loanMonths)) / (Math.pow(1 + mRate, loanMonths) - 1) : loanPrincipal / loanMonths;
    const totalRepayment = monthlyInst * loanMonths;
    const totalInterest = totalRepayment - loanPrincipal;

    const gross = stocksVal + stableValToman + totalCash + nftsVal + loanInvestedVal;
    const netAfterLoan = gross - loanPrincipal;
    const totalCost = stocksCost + (stableUsd * 235000) + totalCash + nftsCost + loanPrincipal;
    const unrealizedPnl = gross - totalCost;
    const realizedPnl = pNum(p.realizedPnlToman, 0);

    // محاسبه جمع سود سهام/صندوق و کارمزد از دفتر کل
    let totalDividends = 0;
    let totalFees = 0;
    (p.transactions || []).forEach(tx => {
      if (tx.type === 'سود نقدی') totalDividends += pNum(tx.amountToman, 0);
      totalFees += pNum(tx.feeToman, 0);
      if (tx.type === 'کارمزد') totalFees += pNum(tx.amountToman, 0);
    });

    // ثبت اسنپ‌شات روزانه همراه با نرخ دلار برای نمودار دوگانه تومانی/دلاری
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayJalali = fmtJalali(new Date());
    const snapshotPoint = {
      date: todayIso,
      jalaliDate: todayJalali,
      isRealSnapshot: true,
      totalToman: Math.round(gross),
      netAfterLoanToman: Math.round(netAfterLoan),
      usdRate: usdt,
      totalUsd: Number((gross / freeUsd).toFixed(2)),
      netFlowToman: 0
    };

    const lastIdx = state.history.length - 1;
    if (lastIdx >= 0 && (state.history[lastIdx].jalaliDate === todayJalali || state.history[lastIdx].date === todayIso)) {
      snapshotPoint.netFlowToman = state.history[lastIdx].netFlowToman || 0;
      state.history[lastIdx] = snapshotPoint;
    } else {
      state.history.push(snapshotPoint);
    }
    safeSetStorage(KEY_HIST, JSON.stringify(state.history));

    const prev1d = state.history[state.history.length - 2]?.totalToman || gross * 0.998;
    const prev7d = state.history[Math.max(0, state.history.length - 5)]?.totalToman || gross * 0.975;
    const prev30d = state.history[0]?.totalToman || gross * 0.91;

    const xirrPct = computeXirrAnnualPct(p.transactions, gross);
    const earlyPayoffSim = simulateLoanEarlyPayoff(
      l,
      l.earlyPayoffMonth || 6,
      l.earlyPenaltyDiscountPct !== undefined ? l.earlyPenaltyDiscountPct : 90
    );
    const freshness = checkStaleAndSuspectStatus(stocks);

    // هدف مالی (Goal Widget)
    const targetWealthToman = Math.max(1000000, pNum(p.wealthTargetToman, 400000000));
    const goalProgressPct = Math.min(100, Math.max(0, (gross / targetWealthToman) * 100));
    const goalRemainingToman = Math.max(0, targetWealthToman - gross);

    return {
      rates: { usdt, freeUsd, gold },
      freshness,
      goal: {
        title: p.wealthTargetTitle || 'هدف استقلال مالی اول',
        targetToman: targetWealthToman,
        targetUsd: targetWealthToman / freeUsd,
        progressPct: goalProgressPct,
        remainingToman: goalRemainingToman
      },
      stocks: stocks.map(s => ({ ...s, sharePct: gross > 0 ? (s.valueToman / gross) * 100 : 0 })),
      stocksVal, stocksCost, stocksPnl: stocksVal - stocksCost, stocksPnlUsd: (stocksVal - stocksCost) / usdt, stocksPnlPct: stocksCost > 0 ? ((stocksVal - stocksCost) / stocksCost) * 100 : 0,
      stablecoins, stableUsd, stableValToman,
      cash: { bankCash, brokerCash, totalCash, targetUsdt, buysNow: totalCash / usdt, buysTarget: totalCash / targetUsdt },
      nfts, nftsVal, nftsCost, nftsPnl: nftsVal - nftsCost,
      loan: {
        ...l,
        items: enrichedLoanItems,
        loanPrincipal,
        loanInvestedVal,
        loanRate,
        loanMonths,
        monthlyInst,
        totalRepayment,
        totalInterest,
        netPnl: loanInvestedVal - loanPrincipal,
        breakEvenTargetToman: loanPrincipal + totalInterest,
        earlyPayoffSim
      },
      classTotals: { bourse: stocksVal + bourseInLoan, crypto: cryptoInLoan, stable: stableValToman, cash: totalCash, nft: nftsVal, gold: goldInLoan },
      gross, netAfterLoan, grossUsd: gross / freeUsd,
      unrealizedPnl, realizedPnl,
      totalDividends, totalFees,
      xirrPct,
      pnl: {
        d: { a: gross - prev1d, usd: (gross - prev1d) / usdt, p: ((gross - prev1d) / prev1d) * 100 },
        w: { a: gross - prev7d, usd: (gross - prev7d) / usdt, p: ((gross - prev7d) / prev7d) * 100 },
        m: { a: gross - prev30d, usd: (gross - prev30d) / usdt, p: ((gross - prev30d) / prev30d) * 100 },
        t: { a: unrealizedPnl + realizedPnl + totalDividends - totalFees, usd: (unrealizedPnl + realizedPnl + totalDividends - totalFees) / usdt, p: ((unrealizedPnl + realizedPnl + totalDividends - totalFees) / totalCost) * 100 }
      }
    };
  }

  function computeQuantRisk(m) {
    const hist = state.history;
    const rf = pNum(state.portfolio.riskSettings?.riskFreeRatePct, 23) / 100;
    const rets = [];
    let twrProd = 1.0;
    for (let i = 1; i < hist.length; i++) {
      const prev = hist[i - 1].totalToman || 1;
      const r = (hist[i].totalToman - prev - (hist[i].netFlowToman || 0)) / prev;
      rets.push(r);
      twrProd *= (1 + r);
    }
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0.002;
    const variance = rets.length > 1 ? rets.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / (rets.length - 1) : 0.0001;
    const dailyStd = Math.max(0.005, Math.sqrt(variance));
    const nftPenalty = m.gross > 0 ? 1 + (m.nftsVal / m.gross) * 0.25 : 1;
    const annualVolPct = dailyStd * Math.sqrt(252) * 100 * nftPenalty;
    const sharpe = ((mean * 252 - rf) / (annualVolPct / 100));

    let peak = hist[0]?.totalToman || m.gross, peakD = hist[0]?.date || '', maxDd = 0, ddStart = peakD, ddEnd = peakD;
    hist.forEach(h => {
      if (h.totalToman >= peak) { peak = h.totalToman; peakD = h.date; }
      const dd = ((h.totalToman - peak) / peak) * 100;
      if (dd < maxDd) { maxDd = dd; ddStart = peakD; ddEnd = h.date; }
    });
    const healthScore = Math.min(98, Math.max(35, Math.round(82 - (m.nftsVal / m.gross) * 35 + Math.min(15, sharpe * 5))));
    return { annualVolPct, sharpe, maxDdPct: maxDd, ddStartDate: ddStart, ddEndDate: ddEnd, twrPct: (twrProd - 1) * 100, healthScore };
  }

  window.WD_COMPUTE = {
    autoDetectAssetCategory,
    getStockLiveObj,
    getTehranMarketSchedule,
    checkStaleAndSuspectStatus,
    computeXirrAnnualPct,
    simulateLoanEarlyPayoff,
    computeAll,
    computeQuantRisk
  };
})(window);
