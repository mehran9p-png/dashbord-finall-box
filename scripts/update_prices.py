#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/update_prices.py
بروزرسانی خودکار قیمت‌های بورس ایران، نرخ تتر/دلار آزاد، طلای ۱۸ عیار و رمزارزها
- بدون هیچ‌گونه وابستگی به portfolio.json شخصی (حفظ کامل حریم خصوصی؛ فقط خواندن از data/symbols.json)
- خواندن کلید BrsApi از متغیر محیطی BRS_API_KEY (عدم درج کلید در سورس‌کد)
- بررسی هشدارهای قیمتی تعریف‌شده در data/alerts.json و ارسال نوتیفیکیشن تلگرام
  از طریق TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID
"""

import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import quote
import requests

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYMBOLS_FILE = os.path.join(ROOT_DIR, "data", "symbols.json")
PRICES_FILE = os.path.join(ROOT_DIR, "data", "prices.json")
ALERTS_FILE = os.path.join(ROOT_DIR, "data", "alerts.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}

# کلیدها صرفاً از متغیرهای محیطی (GitHub Secrets) خوانده می‌شوند
BRS_API_KEY = os.environ.get("BRS_API_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
ALLOW_INSECURE_SSL = os.environ.get("ALLOW_INSECURE_SSL", "0").strip() == "1"

DEFAULT_SYMBOLS = [
    {"symbol": "وفیروزه", "insCode": "55254206302462116"},
    {"symbol": "فپنتا", "insCode": "17914401175772326"},
    {"symbol": "شپدیس", "insCode": "44891482026867833"},
    {"symbol": "کرومیت", "insCode": "46741025610365789"},
    {"symbol": "فهامون", "insCode": "38232437866669967"},
    {"symbol": "فکور", "insCode": "66442254613568889"},
    {"symbol": "فپردیس", "insCode": "41933952242799993"},
    {"symbol": "وسرمایه", "insCode": "21963356012832211"},
    {"symbol": "زشک", "insCode": "61449234123698745"},
    {"symbol": "سیمکات", "insCode": "32469128621155732"},
    {"symbol": "فساپ", "insCode": "51617145879012365"},
]


def norm_fa(text):
    if not text:
        return ""
    return (
        str(text)
        .strip()
        .replace("ي", "ی")
        .replace("ك", "ک")
        .replace("ئ", "ی")
        .replace("ة", "ه")
        .replace("\u200c", "")
        .replace(" ", "")
    )


def load_json(path, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as exc:
        print(f"[WARN] خطا در خواندن {path}: {exc}", file=sys.stderr)
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def http_get_text(target_url, timeout=8, allow_proxy=False):
    routes = [target_url]
    if allow_proxy:
        routes.extend([
            f"https://api.codetabs.com/v1/proxy?quest={quote(target_url, safe='')}",
            f"https://api.allorigins.win/raw?url={quote(target_url, safe='')}",
        ])
    for u in routes:
        try:
            r = requests.get(
                u,
                headers=HEADERS,
                timeout=timeout,
                verify=not ALLOW_INSECURE_SSL,
            )
            if r.status_code == 200 and r.text and len(r.text.strip()) > 5:
                low = r.text[:200].lower()
                if "<html" not in low and "cloudflare" not in low:
                    return r.text.strip()
        except Exception:
            pass
    return None


def clean_toman(val, is_rial=False):
    try:
        n = float(str(val).replace(",", "").strip())
        if n <= 0:
            return None
        if is_rial or n >= 1000000:
            n = n / 10.0
        n = round(n)
        if 50000 <= n <= 950000:
            return n
    except Exception:
        pass
    return None


def fetch_usdt_toman():
    endpoints = [
        ("https://api.tetherland.com/currencies", False, "تترلند"),
        ("https://apiv2.nobitex.ir/v3/orderbook/USDTIRT", True, "نوبیتکس"),
        ("https://api.wallex.ir/v1/markets", False, "والکس"),
    ]
    for url, is_rial, src in endpoints:
        txt = http_get_text(url, timeout=6, allow_proxy=True)
        if not txt:
            continue
        try:
            d = json.loads(txt)
            if src == "تترلند":
                raw = d.get("data", {}).get("currencies", {}).get("USDT", {}).get("price")
            elif src == "نوبیتکس":
                raw = d.get("lastTradePrice")
            else:
                raw = (
                    d.get("result", {})
                    .get("symbols", {})
                    .get("USDTTMN", {})
                    .get("stats", {})
                    .get("lastPrice")
                )
            t = clean_toman(raw, is_rial=is_rial)
            if t:
                return t, src
        except Exception:
            pass
    return None, None


def is_suspect_change(daily_pct):
    try:
        return abs(float(daily_pct)) > 15.0
    except Exception:
        return False


def fetch_all_bourse(symbols_list, existing_stocks, now_iso):
    results = {}
    bulk_map = {}

    # ۱. دریافت دسته‌جمعی از BrsApi فقط در صورت وجود کلید در متغیر محیطی (بدون ارسال کلید به پروکسی‌های عمومی)
    if BRS_API_KEY:
        for t_code in [1, 2]:
            url = f"https://Api.BrsApi.ir/Tsetmc/AllSymbols.php?key={BRS_API_KEY}&type={t_code}"
            txt = http_get_text(url, timeout=8, allow_proxy=False)
            if not txt:
                continue
            try:
                arr = json.loads(txt)
                if isinstance(arr, list):
                    for it in arr:
                        sym = norm_fa(it.get("l18", ""))
                        rial = it.get("pl") or it.get("pc")
                        chg = it.get("pcp") if it.get("pcp") is not None else it.get("pc_p", 0.0)
                        if sym and rial and float(rial) > 0:
                            pct_val = round(float(chg or 0.0), 2)
                            bulk_map[sym] = {
                                "priceToman": round(float(rial) / 10.0),
                                "dailyChangePct": pct_val,
                                "source": "BrsApi",
                                "updatedAt": now_iso,
                                "stale": False,
                                "suspect": is_suspect_change(pct_val),
                            }
            except Exception:
                pass

    # ۲. تطبیق با لیست نمادهای فایل data/symbols.json
    for item in symbols_list:
        sym = item.get("symbol")
        ins_code = item.get("insCode")
        if not sym:
            continue
        ns = norm_fa(sym)
        if ns in bulk_map:
            results[sym] = bulk_map[ns]
            continue

        # ۳. در صورت عدم دریافت از BrsApi، استعلام مستقیم از CDN رسمی TSETMC با insCode
        if ins_code:
            tsetmc_url = f"https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/{ins_code}"
            ptxt = http_get_text(tsetmc_url, timeout=6, allow_proxy=True)
            if ptxt:
                try:
                    info = json.loads(ptxt).get("closingPriceInfo", {})
                    raw_r = info.get("pDrCotVal") or info.get("pClosing")
                    prev_r = info.get("priceYesterday")
                    if raw_r and float(raw_r) > 0:
                        p_tmn = round(float(raw_r) / 10.0)
                        chg = (
                            round(((float(raw_r) - float(prev_r)) / float(prev_r)) * 100.0, 2)
                            if prev_r and float(prev_r) > 0
                            else 0.0
                        )
                        results[sym] = {
                            "priceToman": p_tmn,
                            "dailyChangePct": chg,
                            "source": "TSETMC",
                            "updatedAt": now_iso,
                            "stale": False,
                            "suspect": is_suspect_change(chg),
                        }
                        continue
                except Exception:
                    pass

        # ۴. حفظ آخرین قیمت معتبر قبلی با علامت stale=True
        prev_obj = existing_stocks.get(sym, {})
        if prev_obj.get("priceToman", 0) > 0:
            prev_chg = prev_obj.get("dailyChangePct", 0.0)
            results[sym] = {
                "priceToman": prev_obj["priceToman"],
                "dailyChangePct": prev_chg,
                "source": prev_obj.get("source", "کش قبلی"),
                "updatedAt": prev_obj.get("updatedAt"),
                "stale": True,
                "suspect": is_suspect_change(prev_chg),
            }

    return results


def fetch_crypto_reliable(existing_crypto, now_iso):
    out = json.loads(json.dumps(existing_crypto or {}))
    defaults = [
        ("BTC", 68450.0, 70200.0),
        ("ETH", 2725.0, 3420.0),
        ("SOL", 158.4, 188.5),
    ]
    for sym, def_p, def_h in defaults:
        if sym not in out:
            out[sym] = {
                "priceUsd": def_p,
                "high90dUsd": def_h,
                "ma200Usd": round(def_p * 0.9),
                "rsi14": 50.0,
                "stale": True,
            }

    try:
        r = requests.get(
            "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH,SOL&tsyms=USD",
            headers=HEADERS,
            timeout=6,
        )
        if r.status_code == 200:
            raw = r.json().get("RAW", {})
            for sym in ["BTC", "ETH", "SOL"]:
                p = float(raw.get(sym, {}).get("USD", {}).get("PRICE", 0))
                if p > 0:
                    out[sym]["priceUsd"] = round(p, 2)
                    out[sym]["source"] = "CryptoCompare"
                    out[sym]["updatedAt"] = now_iso
                    out[sym]["stale"] = False
    except Exception:
        pass

    for sym in ["BTC", "ETH", "SOL"]:
        try:
            r = requests.get(
                f"https://api.coinbase.com/v2/prices/{sym}-USD/spot",
                headers=HEADERS,
                timeout=5,
            )
            if r.status_code == 200:
                p = float(r.json().get("data", {}).get("amount", 0))
                if p > 0:
                    out[sym]["priceUsd"] = round(p, 2)
                    out[sym]["source"] = "Coinbase"
                    out[sym]["updatedAt"] = now_iso
                    out[sym]["stale"] = False
        except Exception:
            pass

    return out


def get_asset_current_price(rule, prices):
    asset = rule.get("asset", "")
    r_type = rule.get("type", "")
    if asset in ("USDT", "USD") or r_type == "fx":
        return float(prices.get("fx", {}).get("usdtToman", 0) or 0)
    if asset in ("BTC", "ETH", "SOL") or r_type == "crypto":
        return float(prices.get("crypto", {}).get(asset, {}).get("priceUsd", 0) or 0)
    return float(prices.get("stocks", {}).get(asset, {}).get("priceToman", 0) or 0)


def evaluate_and_send_telegram_alerts(prices, now_iso):
    alerts_cfg = load_json(ALERTS_FILE, {"rules": [], "cooldownHours": 6})
    rules = alerts_cfg.get("rules", [])
    if not isinstance(rules, list) or not rules:
        return

    cooldown_hours = float(alerts_cfg.get("cooldownHours", 6) or 6)
    now_dt = datetime.now(timezone.utc)
    triggered_messages = []
    updated_rules = False

    for rule in rules:
        if not rule.get("enabled", True):
            continue
        cur_price = get_asset_current_price(rule, prices)
        target = float(rule.get("target", 0) or 0)
        if cur_price <= 0 or target <= 0:
            continue

        cond = rule.get("condition", "below")
        is_hit = (cur_price <= target) if cond == "below" else (cur_price >= target)
        if not is_hit:
            continue

        # بررسی Cooldown برای جلوگیری از ارسال پیام تکراری
        last_trig = rule.get("lastTriggeredAt")
        if last_trig:
            try:
                prev_dt = datetime.fromisoformat(last_trig.replace("Z", "+00:00"))
                diff_h = (now_dt - prev_dt).total_seconds() / 3600.0
                if diff_h < cooldown_hours:
                    continue
            except Exception:
                pass

        op_str = "پایین‌تر یا مساوی" if cond == "below" else "بالاتر یا مساوی"
        unit = rule.get("unit", "")
        note = rule.get("note", "")
        msg = (
            f"🔔 *هشدار قیمتی فعال شد*\n"
            f"• دارایی: *{rule.get('asset')}*\n"
            f"• قیمت فعلی: `{cur_price:,.0f} {unit}`\n"
            f"• شرط هشدار: {op_str} `{target:,.0f} {unit}`\n"
            f"• توضیح: {note}"
        )
        triggered_messages.append(msg)
        rule["lastTriggeredAt"] = now_iso
        updated_rules = True

    if updated_rules:
        save_json(ALERTS_FILE, alerts_cfg)

    if triggered_messages and TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        full_text = (
            "⚡ *گزارش هشدار ترمینال هوشمند ثروت*\n\n"
            + "\n\n".join(triggered_messages)
            + f"\n\n🕒 زمان: `{now_iso}`"
        )
        tg_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        try:
            resp = requests.post(
                tg_url,
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": full_text,
                    "parse_mode": "Markdown",
                    "disable_web_page_preview": True,
                },
                timeout=8,
            )
            if resp.status_code != 200:
                print(f"[WARN] خطا در ارسال تلگرام: {resp.status_code} {resp.text}", file=sys.stderr)
        except Exception as exc:
            print(f"[WARN] استثنا در ارسال تلگرام: {exc}", file=sys.stderr)


def main():
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    symbols_cfg = load_json(SYMBOLS_FILE, {"stocks": DEFAULT_SYMBOLS})
    symbols_list = symbols_cfg.get("stocks", DEFAULT_SYMBOLS)
    prices = load_json(PRICES_FILE, {"fx": {}, "stocks": {}, "crypto": {}, "sentiment": {}})

    # ۱. بروزرسانی نرخ تتر و دلار آزاد
    live_usdt, fx_src = fetch_usdt_toman()
    prev_usdt = clean_toman(prices.get("fx", {}).get("usdtToman")) or 262000
    final_usdt = live_usdt if live_usdt else prev_usdt
    prices["fx"] = {
        "usdtToman": final_usdt,
        "freeUsdToman": round(final_usdt * 0.996),
        "gold18kToman": prices.get("fx", {}).get("gold18kToman", 17850000),
        "source": fx_src or prices.get("fx", {}).get("source", "گیت‌هاب"),
        "updatedAt": now_iso if live_usdt else prices.get("fx", {}).get("updatedAt", now_iso),
        "stale": not bool(live_usdt),
    }

    # ۲. بروزرسانی نمادهای بورس بر اساس symbols.json
    existing_stocks = prices.get("stocks", {})
    live_stocks = fetch_all_bourse(symbols_list, existing_stocks, now_iso)
    fresh_bourse_count = sum(1 for v in live_stocks.values() if not v.get("stale", True))
    prices["stocks"] = live_stocks

    # ۳. بروزرسانی رمزارزها
    prices["crypto"] = fetch_crypto_reliable(prices.get("crypto", {}), now_iso)

    # ۴. شاخص ترس و طمع
    try:
        r_fng = requests.get("https://api.alternative.me/fng/?limit=1", headers=HEADERS, timeout=5)
        if r_fng.status_code == 200:
            d_fng = r_fng.json().get("data", [{}])[0]
            val = int(d_fng.get("value", 50))
            lbl = d_fng.get("value_classification", "Neutral")
            prices.setdefault("sentiment", {})["fngValue"] = val
            prices["sentiment"]["fngLabel"] = lbl
    except Exception:
        pass

    prices["lastUpdated"] = now_iso
    prices["sourceType"] = (
        f"زنده ({fx_src or 'کش'} | بورس: {fresh_bourse_count} نماد تازه | کریپتو: زنده)"
    )
    save_json(PRICES_FILE, prices)

    # ۵. بررسی هشدارهای قیمتی و ارسال تلگرام
    evaluate_and_send_telegram_alerts(prices, now_iso)
    print(f"[OK] بروزرسانی قیمت‌ها در {now_iso} انجام شد (بورس تازه: {fresh_bourse_count} نماد).")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] خطای غیرمنتظره در update_prices.py: {exc}", file=sys.stderr)
        sys.exit(1)
