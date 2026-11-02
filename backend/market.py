import asyncio
import math
import time
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import yfinance as yf

CRYPTO = {"BTC", "ETH", "SOL", "DOGE", "ADA", "XRP", "AVAX", "LINK", "BNB", "DOT"}
ALIASES = {
    "BITCOIN": "BTC", "ETHEREUM": "ETH", "SOLANA": "SOL", "DOGECOIN": "DOGE",
    "NVIDIA": "NVDA", "APPLE": "AAPL", "MICROSOFT": "MSFT", "GOOGLE": "GOOGL",
    "ALPHABET": "GOOGL", "AMAZON": "AMZN", "TESLA": "TSLA", "META": "META",
    "BROADCOM": "AVGO", "MICRON": "MU", "NEBIUS": "NBIS", "SP500": "SPY",
    "NASDAQ": "QQQ", "S&P 500": "SPY", "S&P500": "SPY",
}
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
CACHE_SECONDS = 90


def normalize_symbol(symbol: str, asset_type: str = "auto") -> tuple[str, str, str]:
    raw = symbol.strip().upper().replace("$", "")
    raw = ALIASES.get(raw, raw)
    if not raw or len(raw) > 18 or not all(c.isalnum() or c in '.-^=' for c in raw):
        raise ValueError("Please enter a valid stock or cryptocurrency ticker.")
    is_crypto = asset_type == "crypto" or (asset_type == "auto" and (raw in CRYPTO or raw.endswith("-USD")))
    if is_crypto:
        ticker = raw if raw.endswith("-USD") else f"{raw}-USD"
        display = raw.removesuffix("-USD")
        return ticker, display, "crypto"
    return raw, raw, "stock"


def safe_number(value: Any, digits: int = 4) -> float | None:
    try:
        n = float(value)
        return round(n, digits) if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def _load(symbol: str, asset_type: str) -> dict[str, Any]:
    yf_symbol, display, kind = normalize_symbol(symbol, asset_type)
    cache_key = f"{yf_symbol}:{kind}"
    hit = _cache.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]

    frame = yf.Ticker(yf_symbol).history(period="2y", interval="1d", auto_adjust=True)
    if frame.empty or len(frame) < 200:
        raise ValueError(f"Insufficient historical price data for {display} (need at least 200 daily closes).")
    close = frame["Close"].dropna()
    if len(close) < 200:
        raise ValueError("Insufficient valid daily closes to compute SMA200.")
    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    rs = gain / loss.replace(0, float('nan'))
    rsi = 100 - 100 / (1 + rs)
    if loss.iloc[-1] == 0:
        rsi.iloc[-1] = 100 if gain.iloc[-1] > 0 else 50

    last = float(close.iloc[-1]); prev = float(close.iloc[-2])
    m50 = float(sma50.iloc[-1]); m200 = float(sma200.iloc[-1])
    if last > m200 * 1.01 and m50 > m200:
        trend = "BULLISH"
    elif last < m200 * 0.99 and m50 < m200:
        trend = "BEARISH"
    else:
        trend = "NEUTRAL"
    # Technical assessment, not a personalized instruction.
    if trend == "BULLISH" and (safe_number(rsi.iloc[-1]) or 100) < 70:
        action = "BUY CANDIDATE"
    elif trend == "BEARISH":
        action = "CAUTION / REDUCE RISK"
    else:
        action = "HOLD / WAIT"

    series = []
    for idx in range(max(0, len(close)-260), len(close)):
        date = close.index[idx]
        series.append({
            "date": date.strftime("%Y-%m-%d"),
            "close": safe_number(close.iloc[idx]),
            "sma50": safe_number(sma50.iloc[idx]),
            "sma200": safe_number(sma200.iloc[idx]),
        })
    result = {
        "symbol": display, "provider_symbol": yf_symbol, "asset_type": kind,
        "name": display, "currency": "USD", "price": safe_number(last),
        "change_pct": safe_number((last / prev - 1) * 100, 2),
        "sma50": safe_number(m50), "sma200": safe_number(m200),
        "rsi14": safe_number(rsi.iloc[-1], 2),
        "trend": trend, "action": action,
        "above_sma200": last > m200,
        "last_daily_bar": close.index[-1].strftime("%Y-%m-%d"),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance (via yfinance; delayed/daily data)",
        "history": series,
    }
    _cache[cache_key] = (time.time(), result)
    return result


async def load_market(symbol: str, asset_type: str = "auto") -> dict[str, Any]:
    return await asyncio.to_thread(_load, symbol, asset_type)


async def get_regime(asset_type: str) -> dict[str, Any]:
    symbols = ["BTC", "ETH"] if asset_type == "crypto" else ["SPY", "QQQ"]
    results = await asyncio.gather(*(load_market(s) for s in symbols), return_exceptions=True)
    benchmarks = []
    for result in results:
        if not isinstance(result, BaseException):
            benchmarks.append({k: result[k] for k in ("symbol", "price", "sma200", "trend", "above_sma200")})
    if len(benchmarks) != 2:
        return {"label": "UNKNOWN", "benchmarks": benchmarks, "note": "One or more benchmarks unavailable"}
    positives = sum(x["above_sma200"] for x in benchmarks)
    label = "BULL" if positives == 2 else "BEAR" if positives == 0 else "MIXED"
    return {"label": label, "benchmarks": benchmarks, "note": "200-day technical regime, not an official bull/bear definition"}
