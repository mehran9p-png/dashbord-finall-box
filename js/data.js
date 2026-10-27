/**
 * js/data.js — لایه مدیریت داده، امنیت (escapeHtml، اعتبارسنجی ساختار Import، قفل PIN)،
 * تقویم شمسی، ذخیره‌سازی محلی (localStorage) و پشته Undo
 * (بدون کلید API در سمت کلاینت و بدون وابستگی به portfolio.json عمومی)
 */
(function(window) {
  'use strict';

  const KEY_P = 'WEALTH_PRO_V20';
  const KEY_PR = 'WEALTH_PRICES_V20';
  const KEY_HIST = 'WEALTH_HISTORY_V20';
  const KEY_PRIVACY = 'WEALTH_PRIVACY_MASK_V20';
  const KEY_PIN = 'WEALTH_PIN_HASH_V20';
  const KEY_LAST_BACKUP = 'WEALTH_LAST_BACKUP_TS_V20';

  const SEMANTIC_COLORS = {
    bourse: '#3b82f6',
    crypto: '#f97316',
    stable: '#06b6d4',
    cash: '#94a3b8',
    nft: '#a855f7',
    gold: '#eab308',
    loan: '#fb7185'
  };

  const KNOWN_INSCODES = {
    "وفیروزه": "55254206302462116",
    "فپنتا": "17914401175772326",
    "شپدیس": "44891482026867833",
    "کرومیت": "46741025610365789",
    "فهامون": "38232437866669967",
    "فکور": "66442254613568889",
    "فپردیس": "41933952242799993",
    "وسرمایه": "21963356012832211",
    "زشک": "61449234123698745",
    "سیمکات": "32469128621155732",
    "فساپ": "51617145879012365"
  };

  // امنیت XSS: پاک‌سازی تمام رشته‌های متنی قبل از قرارگیری در innerHTML
  function escapeHtml(rawStr) {
    if (rawStr === null || rawStr === undefined) return '';
    return String(rawStr)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const faDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  const toFa = v => String(v ?? '۰').replace(/\d/g, d => faDigits[Number(d)]);

  const pNum = (v, fb = 0) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : fb;
    if (v === null || v === undefined) return fb;
    const map = {
      '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
      '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'
    };
    const clean = String(v)
      .replace(/[۰-۹٠-٩]/g, d => map[d] || d)
      .replace(/٫/g, '.')
      .replace(/[٬,]/g, '')
      .replace(/[^0-9.-]/g, '');
    const n = parseFloat(clean);
    return Number.isFinite(n) ? n : fb;
  };

  const normFa = s => String(s || '')
    .trim()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ئ/g, 'ی')
    .replace(/ة/g, 'ه')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, '');

  // تبدیل تاریخ میلادی به شمسی و بالعکس (الگوریتم دقیق جلالی)
  function gregorianToJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
    let jy = -1595 + (33 * Math.floor(days / 12053));
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return [jy, jm, jd];
  }

  function jalaliToGregorian(jy, jm, jd) {
    jy = pNum(jy, 1405);
    jm = pNum(jm, 7);
    jd = pNum(jd, 1);
    let jy1 = jy + 1595;
    let days = -355668 + (365 * jy1) + (Math.floor(jy1 / 33) * 8) + Math.floor(((jy1 % 33) + 3) / 4) + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
      gy += 100 * Math.floor(--days / 36524);
      days %= 36524;
      if (days >= 365) days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      gy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    let gd = days + 1;
    const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm;
    for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
    return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  }

  function isoToJalaliParts(isoStr) {
    try {
      const d = isoStr ? new Date(isoStr) : new Date();
      if (isNaN(d.getTime())) return { jy: 1405, jm: 8, jd: 5 };
      const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return { jy, jm, jd };
    } catch (_) {
      return { jy: 1405, jm: 8, jd: 5 };
    }
  }

  function fmtJalali(dIn) {
    try {
      const d = dIn ? new Date(dIn) : new Date();
      if (isNaN(d.getTime())) return escapeHtml(toFa(String(dIn)));
      return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch (_) {
      return '۱۴۰۵/۰۸/۰۵';
    }
  }

  const DEFAULT_PORTFOLIO = {
    wealthTargetToman: 400000000,
    wealthTargetTitle: "هدف استقلال مالی اول",
    stockSortMode: 'priceAsc',
    riskSettings: { riskFreeRatePct: 23, concThresholdPct: 30, bourseFeePct: 0.88 },
    rebalanceTargets: { bourse: 20, crypto: 10, stable: 30, cash: 15, nft: 10, gold: 15 },
    cfoConfig: {
      warScore: 65, sancScore: 60, infScore: 75, cbiScore: 45,
      wWar: 35, wSanc: 25, wInf: 25, wCbi: 15,
      step1Pct: 0, step2Pct: 2.5, step3Pct: 7.5,
      scoreHistory: [
        { date: "۰۷/۲۵", score: 54.2 },
        { date: "۰۷/۲۷", score: 56.8 },
        { date: "۰۷/۲۹", score: 58.1 },
        { date: "۰۸/۰۱", score: 59.7 }
      ]
    },
    stocks: [
      { symbol: "وفیروزه", name: "صندوق فیروزه موفقیت", qty: 17749, avgBuyToman: 565, insCode: "55254206302462116", note: "صندوق سهامی" },
      { symbol: "فپنتا", name: "صندوق سرمایه‌گذاری پنتا", qty: 1489, avgBuyToman: 4450, insCode: "17914401175772326", note: "صنعت فلزات" },
      { symbol: "شپدیس", name: "پتروشیمی پردیس", qty: 3139, avgBuyToman: 1180, insCode: "44891482026867833", note: "اوره صادراتی" },
      { symbol: "کرومیت", name: "فرآوری معدنی کرومیت", qty: 5000, avgBuyToman: 560, insCode: "46741025610365789", note: "کانه فلزی" },
      { symbol: "فهامون", name: "صندوق سرمایه‌گذاری هامون", qty: 3607, avgBuyToman: 610, insCode: "38232437866669967", note: "فلزات اساسی" },
      { symbol: "فکور", name: "صندوق سرمایه‌گذاری کوروش", qty: 1240, avgBuyToman: 590, insCode: "66442254613568889", note: "میان‌مدت" },
      { symbol: "فپردیس", name: "صندوق سرمایه‌گذاری پردیس", qty: 62, avgBuyToman: 8200, insCode: "41933952242799993", note: "کم‌ریسک" },
      { symbol: "وسرمایه", name: "صندوق سرمایه‌گذاری سرمایه", qty: 658, avgBuyToman: 430, insCode: "21963356012832211", note: "تنوع‌بخشی" },
      { symbol: "زشک", name: "کشاورزی و دامپروری زشک", qty: 211, avgBuyToman: 1190, insCode: "61449234123698745", note: "گروه غذایی" },
      { symbol: "سیمکات", name: "سیم و کابل تبریز", qty: 39, avgBuyToman: 105, insCode: "32469128621155732", note: "تجهیزات برقی" },
      { symbol: "فساپ", name: "صندوق سرمایه‌گذاری ساپ", qty: 212, avgBuyToman: 420, insCode: "51617145879012365", note: "صندوق بخشی" }
    ],
    stablecoins: [
      { symbol: "LUSD", network: "Ethereum", amount: 406.90, pegUsd: 1.004, note: "استیبل‌کوین غیرمتمرکز" },
      { symbol: "USDT", network: "Ethereum", amount: 5.49, pegUsd: 1.000, note: "موجودی خرد" }
    ],
    cash: { amountToman: 46000000, brokerPowerToman: 978278, targetUsdtToman: 248000 },
    nfts: [
      { name: "Plush Pepe Gift #104", buyToman: 24000000, floorToman: 27800000, note: "گیفت تلگرام" },
      { name: "Fragment Username @...", buyToman: 18000000, floorToman: 19000000, note: "یوزرنیم تلگرام" },
      { name: "Anonymous Number +888", buyToman: 14000000, floorToman: 14800000, note: "شماره مجازی" }
    ],
    nftSoldLogs: [],
    loan: {
      title: "وام ۳۰ میلیونی (۱۲ ماهه)",
      principalToman: 30000000,
      annualRatePct: 23,
      months: 12,
      startDate: "2026-09-23",
      paidInstallments: [1],
      earlyPayoffMonth: 6,
      earlyPenaltyDiscountPct: 90,
      items: [
        { name: "صندوق طلای بورس (عیار)", category: "طلا و صندوق طلا", buyToman: 14000000, currentToman: 16200000 },
        { name: "بیت کوین (BTC)", category: "رمزارز و کریپتو", buyToman: 10000000, currentToman: 11500000 },
        { name: "صندوق سهامی / فپنتا", category: "سهام و صندوق بورسی", buyToman: 6000000, currentToman: 6300000 }
      ]
    },
    realizedPnlToman: 0,
    dividendTotalToman: 1250000,
    feesTotalToman: 165000,
    transactions: [
      { id: "tx-1", date: "۱۴۰۵/۰۷/۰۱", isoDate: "2026-09-23", type: "واریز", asset: "سرمایه اولیه و وام", amountToman: 245000000, feeToman: 0, note: "ارزش پایه پورتفوی و وام" },
      { id: "tx-2", date: "۱۴۰۵/۰۷/۱۸", isoDate: "2026-10-10", type: "سود نقدی", asset: "شپدیس (DPS)", amountToman: 1250000, feeToman: 0, note: "سود نقدی مجمع سالانه" },
      { id: "tx-3", date: "۱۴۰۵/۰۷/۲۸", isoDate: "2026-10-20", type: "خرید", asset: "کرومیت و وفیروزه", amountToman: 10000000, feeToman: 88000, note: "کسر از نقدینگی و خرید بورس" }
    ],
    alerts: [
      { id: 1, asset: "USDT", cond: "below", target: 250000 },
      { id: 2, asset: "BTC", cond: "below", target: 62000 }
    ]
  };

  // استفاده از آخرین قیمت‌های واقعی موجود در prices.json پروژه (بدون تولید داده ساختگی)
  const DEFAULT_PRICES = {
    lastUpdated: "2026-10-27T13:24:43Z",
    sourceType: "کش محلی",
    fx: { usdtToman: 270100, freeUsdToman: 269020, gold18kToman: 17850000, source: "تترلند", isManual: false, updatedAt: "2026-10-27T13:24:43Z", stale: false },
    sentiment: { fngValue: 50, fngLabel: "Neutral", btcDominance: 57.4 },
    stocks: {
      "وفیروزه": { priceToman: 581, dailyChangePct: -2.01, source: "کش", stale: true },
      "فپنتا": { priceToman: 4704, dailyChangePct: 0.00, source: "کش", stale: true },
      "شپدیس": { priceToman: 1250, dailyChangePct: -2.95, source: "کش", stale: true },
      "کرومیت": { priceToman: 557, dailyChangePct: -2.96, source: "کش", stale: true },
      "فهامون": { priceToman: 718, dailyChangePct: 2.87, source: "کش", stale: true },
      "فکور": { priceToman: 689, dailyChangePct: 2.99, source: "کش", stale: true },
      "فپردیس": { priceToman: 9677, dailyChangePct: 2.99, source: "کش", stale: true },
      "وسرمایه": { priceToman: 504, dailyChangePct: 2.86, source: "کش", stale: true },
      "زشک": { priceToman: 1411, dailyChangePct: 2.99, source: "کش", stale: true },
      "سیمکات": { priceToman: 4584, dailyChangePct: 4310.70, source: "کش", stale: true, suspect: true },
      "فساپ": { priceToman: 497, dailyChangePct: 2.90, source: "کش", stale: true }
    },
    crypto: {
      BTC: { priceUsd: 80018.57, high90dUsd: 70200, ma200Usd: 63400, rsi14: 54.2, source: "Coinbase", updatedAt: "2026-10-27T13:24:43Z" },
      ETH: { priceUsd: 2321.75, high90dUsd: 3420, ma200Usd: 2980, rsi14: 46.8, source: "Coinbase", updatedAt: "2026-10-27T13:24:43Z" },
      SOL: { priceUsd: 100.37, high90dUsd: 188.5, ma200Usd: 151.2, rsi14: 51.5, source: "Coinbase", updatedAt: "2026-10-27T13:24:43Z" }
    }
  };

  // تاریخچه واقعی از history.json پروژه
  const DEFAULT_HISTORY = [
    { "date": "2026-09-18", "totalToman": 151200000, "usdRate": 248000 },
    { "date": "2026-09-22", "totalToman": 152900000, "usdRate": 249500 },
    { "date": "2026-09-26", "totalToman": 154200000, "usdRate": 251000 },
    { "date": "2026-09-30", "totalToman": 155800000, "usdRate": 252500 },
    { "date": "2026-10-04", "totalToman": 157500000, "usdRate": 254000 },
    { "date": "2026-10-08", "totalToman": 159200000, "usdRate": 256000 },
    { "date": "2026-10-12", "totalToman": 160700000, "usdRate": 258000 },
    { "date": "2026-10-16", "totalToman": 163800000, "usdRate": 260000 },
    { "date": "2026-10-19", "totalToman": 246927953, "usdRate": 262000 },
    { "date": "2026-10-21", "totalToman": 248461060, "usdRate": 263500 },
    { "date": "2026-10-24", "totalToman": 284269738, "usdRate": 266000 },
    { "date": "2026-10-26", "totalToman": 284725157, "usdRate": 268500 },
    { "date": "2026-10-27", "totalToman": 284787260, "usdRate": 270100 }
  ];

  const state = {
    unit: 'toman',
    isMasked: false,
    pinLocked: false,
    hasPin: false,
    heroSparkDays: 7,
    historyCurrencyMode: 'both', // 'toman' | 'usd' | 'both'
    syncStatus: 'idle', // 'idle' | 'loading' | 'success' | 'error'
    syncErrorMessage: '',
    resetConfirmStep: 0,
    expandedMobileStocks: {},
    undoStack: [],
    portfolio: JSON.parse(JSON.stringify(DEFAULT_PORTFOLIO)),
    prices: JSON.parse(JSON.stringify(DEFAULT_PRICES)),
    history: JSON.parse(JSON.stringify(DEFAULT_HISTORY)),
    charts: {}
  };

  function safeGetStorage(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function safeSetStorage(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }

  // هش ساده و سریع برای قفل PIN چهار رقمی در مرورگر
  function hashPin(pinStr) {
    const clean = String(pinStr || '').trim();
    let h = 2166136261;
    for (let i = 0; i < clean.length; i++) {
      h ^= clean.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'pin_' + (h >>> 0).toString(16);
  }

  // اعتبارسنجی دقیق ساختار JSON هنگام Import بکاپ
  function validateAndSanitizePortfolioJson(rawObj) {
    if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
      throw new Error('ساختار فایل بکاپ باید یک شیء JSON معتبر باشد.');
    }
    if (rawObj.stocks !== undefined && !Array.isArray(rawObj.stocks)) {
      throw new Error('فیلد stocks در فایل بکاپ باید آرایه باشد.');
    }
    if (rawObj.stablecoins !== undefined && !Array.isArray(rawObj.stablecoins)) {
      throw new Error('فیلد stablecoins در فایل بکاپ باید آرایه باشد.');
    }
    if (rawObj.nfts !== undefined && !Array.isArray(rawObj.nfts)) {
      throw new Error('فیلد nfts در فایل بکاپ باید آرایه باشد.');
    }

    const cleanStocks = (Array.isArray(rawObj.stocks) ? rawObj.stocks : DEFAULT_PORTFOLIO.stocks).map(s => ({
      symbol: String(s.symbol || 'نامشخص').slice(0, 30),
      name: String(s.name || s.symbol || '').slice(0, 80),
      qty: Math.max(0, pNum(s.qty, 0)),
      avgBuyToman: Math.max(0, pNum(s.avgBuyToman, 0)),
      insCode: String(s.insCode || KNOWN_INSCODES[normFa(s.symbol)] || '').replace(/[^0-9]/g, ''),
      note: String(s.note || '').slice(0, 120)
    }));

    const cleanStable = (Array.isArray(rawObj.stablecoins) ? rawObj.stablecoins : DEFAULT_PORTFOLIO.stablecoins).map(st => ({
      symbol: String(st.symbol || 'USDT').slice(0, 15),
      network: String(st.network || 'Ethereum').slice(0, 25),
      amount: Math.max(0, pNum(st.amount, 0)),
      pegUsd: Math.max(0.01, pNum(st.pegUsd, 1)),
      note: String(st.note || '').slice(0, 120)
    }));

    const cleanNfts = (Array.isArray(rawObj.nfts) ? rawObj.nfts : DEFAULT_PORTFOLIO.nfts).map(nf => ({
      name: String(nf.name || 'NFT').slice(0, 80),
      buyToman: Math.max(0, pNum(nf.buyToman, 0)),
      floorToman: Math.max(0, pNum(nf.floorToman !== undefined ? nf.floorToman : nf.currentToman, 0)),
      note: String(nf.note || '').slice(0, 120)
    }));

    const cleanTx = (Array.isArray(rawObj.transactions) ? rawObj.transactions : DEFAULT_PORTFOLIO.transactions).map((tx, idx) => ({
      id: String(tx.id || `tx-${Date.now()}-${idx}`),
      date: String(tx.date || fmtJalali(new Date())).slice(0, 25),
      isoDate: String(tx.isoDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      type: String(tx.type || 'خرید').slice(0, 20),
      asset: String(tx.asset || '-').slice(0, 60),
      amountToman: Math.max(0, pNum(tx.amountToman, 0)),
      feeToman: Math.max(0, pNum(tx.feeToman, 0)),
      note: String(tx.note || '').slice(0, 140)
    }));

    return {
      ...DEFAULT_PORTFOLIO,
      ...rawObj,
      wealthTargetToman: Math.max(1000000, pNum(rawObj.wealthTargetToman, DEFAULT_PORTFOLIO.wealthTargetToman)),
      wealthTargetTitle: String(rawObj.wealthTargetTitle || DEFAULT_PORTFOLIO.wealthTargetTitle).slice(0, 60),
      stocks: cleanStocks,
      stablecoins: cleanStable,
      nfts: cleanNfts,
      transactions: cleanTx,
      cash: {
        amountToman: Math.max(0, pNum(rawObj.cash?.amountToman, DEFAULT_PORTFOLIO.cash.amountToman)),
        brokerPowerToman: Math.max(0, pNum(rawObj.cash?.brokerPowerToman, DEFAULT_PORTFOLIO.cash.brokerPowerToman)),
        targetUsdtToman: Math.max(55000, pNum(rawObj.cash?.targetUsdtToman, DEFAULT_PORTFOLIO.cash.targetUsdtToman))
      },
      loan: {
        ...DEFAULT_PORTFOLIO.loan,
        ...(rawObj.loan || {}),
        title: String(rawObj.loan?.title || DEFAULT_PORTFOLIO.loan.title).slice(0, 60),
        principalToman: Math.max(0, pNum(rawObj.loan?.principalToman, DEFAULT_PORTFOLIO.loan.principalToman)),
        annualRatePct: Math.max(0, pNum(rawObj.loan?.annualRatePct, DEFAULT_PORTFOLIO.loan.annualRatePct)),
        months: Math.max(1, pNum(rawObj.loan?.months, DEFAULT_PORTFOLIO.loan.months)),
        earlyPayoffMonth: Math.max(1, pNum(rawObj.loan?.earlyPayoffMonth, 6)),
        earlyPenaltyDiscountPct: Math.min(100, Math.max(0, pNum(rawObj.loan?.earlyPenaltyDiscountPct, 90)))
      }
    };
  }

  function migrateStorage() {
    try {
      const savedMask = safeGetStorage(KEY_PRIVACY);
      state.isMasked = savedMask === 'true';
      document.body.classList.toggle('privacy-masked', state.isMasked);

      const savedPinHash = safeGetStorage(KEY_PIN);
      state.hasPin = Boolean(savedPinHash);
      state.pinLocked = Boolean(savedPinHash);

      const rawP = safeGetStorage(KEY_P) || safeGetStorage('WEALTH_PRO_V14') || safeGetStorage('WEALTH_PRO_V13');
      if (rawP) {
        const parsed = JSON.parse(rawP);
        state.portfolio = validateAndSanitizePortfolioJson(parsed);
      }

      const rawPr = safeGetStorage(KEY_PR) || safeGetStorage('WEALTH_PRICES_V18');
      if (rawPr) {
        const pObj = JSON.parse(rawPr);
        state.prices = {
          ...DEFAULT_PRICES,
          ...pObj,
          fx: { ...DEFAULT_PRICES.fx, ...(pObj.fx || {}) },
          stocks: { ...DEFAULT_PRICES.stocks, ...(pObj.stocks || {}) },
          crypto: { ...DEFAULT_PRICES.crypto, ...(pObj.crypto || {}) },
          sentiment: { ...DEFAULT_PRICES.sentiment, ...(pObj.sentiment || {}) }
        };
      }

      const rawHist = safeGetStorage(KEY_HIST) || safeGetStorage('WEALTH_HISTORY_V14');
      if (rawHist) {
        const parsedH = JSON.parse(rawHist);
        if (Array.isArray(parsedH) && parsedH.length > 0) {
          state.history = parsedH;
        }
      }
    } catch (_) {}
  }

  function saveP() {
    safeSetStorage(KEY_P, JSON.stringify(state.portfolio));
    safeSetStorage(KEY_HIST, JSON.stringify(state.history));
  }

  function pushUndoSnapshot(actionLabel) {
    state.undoStack.push({
      label: actionLabel,
      timestamp: Date.now(),
      portfolioCopy: JSON.parse(JSON.stringify(state.portfolio))
    });
    if (state.undoStack.length > 10) state.undoStack.shift();
  }

  function popUndoSnapshot() {
    if (state.undoStack.length === 0) return null;
    const snap = state.undoStack.pop();
    state.portfolio = snap.portfolioCopy;
    saveP();
    return snap;
  }

  function isWeeklyBackupDue() {
    const lastTs = pNum(safeGetStorage(KEY_LAST_BACKUP), 0);
    if (!lastTs) return true;
    const daysSince = (Date.now() - lastTs) / (1000 * 3600 * 24);
    return daysSince >= 7;
  }

  function markBackupDoneNow() {
    safeSetStorage(KEY_LAST_BACKUP, String(Date.now()));
  }

  window.WD_DATA = {
    KEY_P, KEY_PR, KEY_HIST, KEY_PRIVACY, KEY_PIN, KEY_LAST_BACKUP,
    SEMANTIC_COLORS, KNOWN_INSCODES,
    DEFAULT_PORTFOLIO, DEFAULT_PRICES, DEFAULT_HISTORY,
    state,
    escapeHtml, toFa, pNum, normFa,
    gregorianToJalali, jalaliToGregorian, isoToJalaliParts, fmtJalali,
    safeGetStorage, safeSetStorage,
    hashPin, validateAndSanitizePortfolioJson,
    migrateStorage, saveP,
    pushUndoSnapshot, popUndoSnapshot,
    isWeeklyBackupDue, markBackupDoneNow
  };
})(window);
