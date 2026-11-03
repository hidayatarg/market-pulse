# MarketPulse — AI Stock & Crypto Market Analyst

Full-stack starter: **Node.js/TypeScript + Express + React/Vite + Recharts + OpenAI Agents SDK (optional)**.

## Features
- Welcome screen, prompt suggestions, ticker quick-access and chat interface
- Stock and cryptocurrency support: e.g. `NVDA`, `AAPL`, `AVGO`, `BTC`, `ETH`, `SOL`
- Real historical daily closing prices from Yahoo Finance via `yahoo-finance2`
- Deterministic SMA50, SMA200, RSI14 and daily change calculations
- Interactive chart showing close/SMA50/SMA200 for ~260 sessions
- Market regime from SPY+QQQ (stocks) or BTC+ETH (crypto)
- Optional OpenAI Agents SDK response; works without an API key using a deterministic summary
- Separate `/api/chat`, `/api/analyze`, and `/api/health` endpoints

## Requirements
- Node.js 22+ and npm
- Internet connection for market data and optional OpenAI calls

## Run backend

```bash
cd backend
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env for AI-written explanations (optional)
npm run dev
```

The API listens on http://127.0.0.1:8000 by default. Set `HOST` and `PORT` to override.
For production, run `npm run build` then `npm start`. Run `npm test` for regression checks.
See [backend/README.md](backend/README.md) for endpoint and validation details.

## Run frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173

## API examples

```bash
curl -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Should I buy NVDA?"}'

curl -X POST http://localhost:8000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTC","asset_type":"crypto"}'
```

## Architecture

`React chat → POST /api/chat → ticker extraction → yahoo-finance2 history → TypeScript indicators → benchmark regime → optional OpenAI agent → structured JSON → Recharts dashboard`

### Limitations and production improvements
- Yahoo Finance is an unofficial, potentially rate-limited/delayed source. The price is the **latest daily bar close**, not a guaranteed instant executable quote. For production use licensed real-time quote and OHLCV feeds (e.g. Polygon, Twelve Data, exchange APIs).
- The sample ticker extraction recognizes popular assets and explicit `ticker: XYZ` or `symbol: XYZ`. Extend it with instrument search and ticker disambiguation for arbitrary names, especially cryptocurrencies with duplicate symbols.
- The 200-day price rule is a **technical trend heuristic**, not an official bull/bear market classification. No SMA signal guarantees an investment outcome.
- AI explanation is generated from structured numbers; it does **not** currently search for recent news. Add a news provider or WebSearchTool if needed, with explicit citations and timestamps.
- Add authentication, persistence, API rate limiting, Redis cache, integration tests, streaming, market calendars, data vendor agreements, and portfolio/risk preferences before production deployment.
- For crypto, daily candles cover calendar days; for stocks, they cover trading sessions.
- Market data is fetched asynchronously with a 90-second in-memory cache and concurrent request deduplication. For multiple server instances, add shared caching.
