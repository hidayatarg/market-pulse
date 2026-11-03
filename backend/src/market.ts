import YahooFinance from "yahoo-finance2";

export type AssetType = "auto" | "stock" | "crypto";
export const CRYPTO = new Set([
  "BTC",
  "ETH",
  "SOL",
  "DOGE",
  "ADA",
  "XRP",
  "AVAX",
  "LINK",
  "BNB",
  "DOT",
]);
export const ALIASES: Record<string, string> = {
  BITCOIN: "BTC",
  ETHEREUM: "ETH",
  SOLANA: "SOL",
  DOGECOIN: "DOGE",
  NVIDIA: "NVDA",
  APPLE: "AAPL",
  MICROSOFT: "MSFT",
  GOOGLE: "GOOGL",
  ALPHABET: "GOOGL",
  AMAZON: "AMZN",
  TESLA: "TSLA",
  META: "META",
  BROADCOM: "AVGO",
  MICRON: "MU",
  NEBIUS: "NBIS",
  SP500: "SPY",
  NASDAQ: "QQQ",
  "S&P 500": "SPY",
  "S&P500": "SPY",
};
export class MarketInputError extends Error {}
export function normalizeSymbol(symbol: string, assetType: AssetType = "auto") {
  let raw = symbol.trim().toUpperCase().replaceAll("$", "");
  raw = ALIASES[raw] ?? raw;
  if (!/^[A-Z0-9.\-^=]{1,18}$/.test(raw)) {
    throw new MarketInputError(
      "Please enter a valid stock or cryptocurrency ticker.",
    );
  }
  const crypto =
    assetType === "crypto" ||
    (assetType === "auto" && (CRYPTO.has(raw) || raw.endsWith("-USD")));
  return {
    ticker: crypto && !raw.endsWith("-USD") ? `${raw}-USD` : raw,
    display: crypto ? raw.replace(/-USD$/, "") : raw,
    kind: crypto ? ("crypto" as const) : ("stock" as const),
  };
}
export const safeNumber = (value: number, digits = 4): number | null =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
export interface DailyClose {
  date: string;
  close: number;
}
export function calculateMarket(
  symbol: string,
  assetType: AssetType,
  bars: DailyClose[],
) {
  const { ticker, display, kind } = normalizeSymbol(symbol, assetType);
  const closes = bars.filter((bar) => Number.isFinite(bar.close));
  if (closes.length < 200)
    throw new MarketInputError(
      `Insufficient historical price data for ${display} (need at least 200 daily closes).`,
    );
  let gain = 0,
    loss = 0;
  const sma = (index: number, period: number) =>
    index + 1 < period
      ? NaN
      : closes
          .slice(index + 1 - period, index + 1)
          .reduce((sum, bar) => sum + bar.close, 0) / period;
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i].close - closes[i - 1].close;
    const up = Math.max(delta, 0),
      down = Math.max(-delta, 0);
    gain = i === 1 ? up : gain * (13 / 14) + up / 14;
    loss = i === 1 ? down : loss * (13 / 14) + down / 14;
  }
  const rsi =
    loss === 0 ? (gain > 0 ? 100 : 50) : 100 - 100 / (1 + gain / loss);
  const lastIndex = closes.length - 1;
  const last = closes[lastIndex].close,
    prev = closes[lastIndex - 1].close;
  const m50 = sma(lastIndex, 50),
    m200 = sma(lastIndex, 200);
  const trend =
    last > m200 * 1.01 && m50 > m200
      ? "BULLISH"
      : last < m200 * 0.99 && m50 < m200
        ? "BEARISH"
        : "NEUTRAL";
  const action =
    trend === "BULLISH" && rsi < 70
      ? "BUY CANDIDATE"
      : trend === "BEARISH"
        ? "CAUTION / REDUCE RISK"
        : "HOLD / WAIT";
  return {
    symbol: display,
    provider_symbol: ticker,
    asset_type: kind,
    name: display,
    currency: "USD",
    price: safeNumber(last)!,
    change_pct: safeNumber((last / prev - 1) * 100, 2),
    sma50: safeNumber(m50)!,
    sma200: safeNumber(m200)!,
    rsi14: safeNumber(rsi, 2),
    trend,
    action,
    above_sma200: last > m200,
    last_daily_bar: closes[lastIndex].date,
    retrieved_at: new Date().toISOString(),
    source: "Yahoo Finance (via yahoo-finance2; delayed/daily data)",
    history: closes.slice(-260).map((bar, offset) => {
      const i = Math.max(0, closes.length - 260) + offset;
      return {
        date: bar.date,
        close: safeNumber(bar.close),
        sma50: safeNumber(sma(i, 50)),
        sma200: safeNumber(sma(i, 200)),
      };
    }),
  };
}
export type Market = ReturnType<typeof calculateMarket>;
const yahoo = new YahooFinance();
export type HistoryProvider = (ticker: string) => Promise<DailyClose[]>;
const yahooHistory: HistoryProvider = async (ticker) => {
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  const result = await yahoo.chart(ticker, { period1: start, interval: "1d" });
  const timezone = result.meta.exchangeTimezoneName;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return result.quotes.flatMap((quote) => {
    // Adjusted close preserves yfinance's dividend/split-adjusted daily history.
    const close = quote.adjclose ?? quote.close;
    return typeof close === "number" && Number.isFinite(close)
      ? [{ date: formatter.format(quote.date), close }]
      : [];
  });
};
export function createMarketService(provider: HistoryProvider = yahooHistory) {
  const cache = new Map<string, { expires: number; value: Market }>();
  const pending = new Map<string, Promise<Market>>();
  async function loadMarket(
    symbol: string,
    assetType: AssetType = "auto",
  ): Promise<Market> {
    const { ticker, kind } = normalizeSymbol(symbol, assetType);
    const key = `${ticker}:${kind}`,
      hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (pending.has(key)) return pending.get(key)!;
    const task = (async () => {
      const result = calculateMarket(symbol, assetType, await provider(ticker));
      for (const [key, entry] of cache)
        if (entry.expires <= Date.now()) cache.delete(key);
      cache.set(key, { expires: Date.now() + 90_000, value: result });
      return result;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }
  async function getRegime(assetType: string) {
    const symbols = assetType === "crypto" ? ["BTC", "ETH"] : ["SPY", "QQQ"];
    const results = await Promise.allSettled(
      symbols.map((symbol) => loadMarket(symbol)),
    );
    const benchmarks = results.flatMap((result) =>
      result.status === "fulfilled"
        ? [
            {
              symbol: result.value.symbol,
              price: result.value.price,
              sma200: result.value.sma200,
              trend: result.value.trend,
              above_sma200: result.value.above_sma200,
            },
          ]
        : [],
    );
    const positives = benchmarks.filter((b) => b.above_sma200).length;
    return {
      label:
        benchmarks.length !== 2
          ? "UNKNOWN"
          : positives === 2
            ? "BULL"
            : positives === 0
              ? "BEAR"
              : "MIXED",
      benchmarks,
      note:
        benchmarks.length !== 2
          ? "One or more benchmarks unavailable"
          : "200-day technical regime, not an official bull/bear definition",
    };
  }
  return { loadMarket, getRegime };
}
export type MarketService = ReturnType<typeof createMarketService>;
export type Analysis = {
  asset: Market;
  regime: Awaited<ReturnType<MarketService["getRegime"]>>;
};
