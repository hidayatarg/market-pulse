import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  calculateMarket,
  createMarketService,
  normalizeSymbol,
  MarketInputError,
  type DailyClose,
} from "../src/market.js";
import { detectSymbol, explain } from "../src/analyst.js";
import { createApp } from "../src/app.js";
const bars = (fn: (i: number) => number): DailyClose[] =>
  Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
    close: fn(i),
  }));
test("normalizes aliases, explicit stocks, and crypto", () => {
  assert.deepEqual(normalizeSymbol(" $bitcoin "), {
    ticker: "BTC-USD",
    display: "BTC",
    kind: "crypto",
  });
  assert.equal(normalizeSymbol("BTC", "stock").ticker, "BTC");
  assert.equal(normalizeSymbol("ETH-USD").kind, "crypto");
  assert.throws(() => normalizeSymbol("../invalid"), MarketInputError);
  assert.equal(detectSymbol("Should I buy NVIDIA?"), "NVDA");
  assert.equal(detectSymbol("symbol: XYZ"), "XYZ");
  assert.equal(detectSymbol("pineapple"), undefined);
});
test("SMA, Wilder RSI initialization, trend, history, and insufficient data", () => {
  const up = calculateMarket(
    "AAPL",
    "auto",
    bars((i) => i + 100),
  );
  assert.equal(up.sma50, 374.5);
  assert.equal(up.sma200, 299.5);
  assert.equal(up.rsi14, 100);
  assert.equal(up.trend, "BULLISH");
  assert.equal(up.action, "HOLD / WAIT");
  assert.equal(up.history.length, 260);
  assert.equal(up.history[0].sma50, null);
  const down = calculateMarket(
    "AAPL",
    "stock",
    bars((i) => 500 - i),
  );
  assert.equal(down.rsi14, 0);
  assert.equal(down.action, "CAUTION / REDUCE RISK");
  assert.equal(
    calculateMarket(
      "BTC",
      "crypto",
      bars(() => 100),
    ).rsi14,
    50,
  );
  // Reference pandas ewm(alpha=1/14, adjust=False), with first delta as seed.
  assert.equal(
    calculateMarket(
      "AAPL",
      "auto",
      bars((i) => 100 + (i % 2)),
    ).rsi14,
    51.85,
  );
  assert.throws(
    () => calculateMarket("AAPL", "auto", bars(() => 100).slice(0, 199)),
    MarketInputError,
  );
});
test("cache deduplicates requests and benchmark failures give UNKNOWN", async () => {
  let calls = 0;
  const service = createMarketService(async (ticker) => {
    calls++;
    if (ticker === "QQQ") throw new Error("offline");
    return bars((i) => i + 100);
  });
  await Promise.all([service.loadMarket("AAPL"), service.loadMarket("AAPL")]);
  await service.loadMarket("AAPL");
  assert.equal(calls, 1);
  const regime = await service.getRegime("stock");
  assert.equal(regime.label, "UNKNOWN");
  assert.equal(regime.benchmarks.length, 1);
});
test("HTTP contract: health, analysis, chat, validation, and provider errors", async (t) => {
  const service = createMarketService(async (ticker) => {
    if (ticker === "FAIL") throw new Error("provider failed");
    if (ticker === "SHORT") return [];
    return bars((i) => 100 + i);
  });
  const server = createApp(service, async (_message, data) =>
    data ? `Analysis: ${data.asset.symbol}` : "Welcome",
  ).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify(body),
    });
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), {
    status: "ok",
  });
  const response = await post("analyze", { symbol: "BTC" });
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  const analysis = await response.json();
  assert.equal(analysis.asset.provider_symbol, "BTC-USD");
  assert.equal(analysis.regime.label, "BULL");
  assert.equal(analysis.asset.history.length, 260);
  const chat = await (await post("chat", { message: "Analyze Apple" })).json();
  assert.equal(chat.analysis.asset.symbol, "AAPL");
  assert.ok(chat.generated_at);
  assert.equal(
    (await (await post("chat", { message: "hello" })).json()).analysis,
    null,
  );
  for (const body of [
    {},
    { symbol: "" },
    { symbol: "AAPL", asset_type: "bad" },
    { symbol: 12 },
  ])
    assert.equal((await post("analyze", body)).status, 422);
  assert.equal((await post("chat", { message: "" })).status, 422);
  assert.equal((await post("analyze", { symbol: "FAIL" })).status, 503);
  assert.equal((await post("analyze", { symbol: "SHORT" })).status, 422);
  assert.equal(
    (await (await post("chat", { message: "x", symbol: "FAIL" })).json())
      .analysis,
    null,
  );
  assert.equal(
    (
      await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    ).status,
    422,
  );
});
test("summary works without an API key", async () => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.match(await explain("hello", null), /Welcome/);
    const service = createMarketService(async () => bars((i) => i + 100));
    const asset = await service.loadMarket("NVDA");
    assert.match(
      await explain("NVDA", {
        asset,
        regime: await service.getRegime("stock"),
      }),
      /NVDA.*SMA200/,
    );
  } finally {
    if (old !== undefined) process.env.OPENAI_API_KEY = old;
  }
});
