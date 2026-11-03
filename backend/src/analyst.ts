import { Agent, run } from "@openai/agents";
import { ALIASES, CRYPTO, type Analysis } from "./market.js";
const KNOWN = new Set([
  ...CRYPTO,
  ..."AAPL NVDA MSFT GOOGL GOOG AMZN TSLA META AVGO MU NBIS CRWV SPY QQQ AMD ORCL PLTR NFLX COIN MSTR INTC TSM JPM V MA BRK.B".split(
    " ",
  ),
]);
export function detectSymbol(message: string): string | undefined {
  const upper = message.toUpperCase();
  for (const alias of Object.keys(ALIASES).sort(
    (a, b) => b.length - a.length,
  )) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<!\\w)${escaped}(?!\\w)`).test(upper))
      return ALIASES[alias];
  }
  for (const match of upper.matchAll(
    /(?<![A-Z0-9])\$?([A-Z][A-Z0-9.]{0,7})(?![A-Z0-9])/g,
  )) {
    if (KNOWN.has(match[1])) return match[1];
  }
  return /(?:TICKER|SYMBOL)\s*[:=]?\s*\$?([A-Z][A-Z0-9.]{0,7})/.exec(
    upper,
  )?.[1];
}
const instructions = `You are MarketPulse, a concise and careful financial research assistant.
Use only the supplied, timestamped market snapshot for prices and technical indicators.
Never invent a live price, SMA, RSI, target, news item, or data source.
Distinguish overall market regime from the selected asset's trend.
Explain whether the setup is a BUY CANDIDATE, HOLD/WAIT, or CAUTION/REDUCE RISK,
not a guaranteed trade or personalized financial advice. Note that SMA200 is a
technical heuristic, not the official definition of a bull or bear market.
Use a friendly tone, short paragraphs, and explain one major risk.
When no market snapshot is provided, ask for a ticker or answer general questions.`;
const money = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export async function explain(
  message: string,
  data: Analysis | null,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    if (!data)
      return "Welcome! Ask me about a ticker such as BTC, NVDA, SOL, or AAPL. I can show its price, 50/200-day averages, RSI, market regime, and a chart.";
    const { asset: a, regime: r } = data;
    return `${a.symbol} is ${a.trend.toLowerCase()} relative to its 200-day trend: $${money(a.price)} versus SMA200 $${money(a.sma200)}. The broader market regime is ${r.label.toLowerCase()}; the technical assessment is ${a.action}. This is based on delayed daily data, not a live executable quote. A 200-day trend alone is not sufficient for a trading decision.`;
  }
  try {
    const agent = new Agent({
      name: "market_analyst",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions,
      modelSettings: { maxTokens: 550 },
    });
    let snapshot = null;
    if (data) {
      const { history: _history, ...asset } = data.asset;
      snapshot = { asset, regime: data.regime };
    }
    const result = await run(
      agent,
      `User: ${message}\nSnapshot (authoritative for numerical claims): ${JSON.stringify(snapshot)}`,
    );
    if (!result.finalOutput) throw new Error("Empty AI response");
    return result.finalOutput;
  } catch {
    if (!data)
      return "Tell me which ticker you want to analyze (for example, NVDA, BTC, or SOL).";
    const { asset: a, regime: r } = data;
    return `${a.symbol} trades at $${money(a.price)} on the latest available daily bar (${a.last_daily_bar}). Asset trend: ${a.trend}. Broader market: ${r.label}. Technical assessment: ${a.action}. Prices can be delayed, and this is not a personalized recommendation.`;
  }
}
