# MarketPulse Node.js / TypeScript backend

Requires Node.js 22+ and npm.

```bash
cd backend
npm ci
cp .env.example .env
npm run dev
```

Set `OPENAI_API_KEY` in `.env` for optional AI explanations using the TypeScript OpenAI Agents SDK. Without a key, summaries are deterministic. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Existing `.env` files remain compatible.

- `npm run dev`: watch TypeScript source with tsx
- `npm run build`: compile to `dist/`
- `npm start`: run compiled server
- `npm run typecheck`: check strict TypeScript types
- `npm test`: offline indicator and HTTP regression tests

The server defaults to `HOST=127.0.0.1`, `PORT=8000`, with credentialed CORS for `FRONTEND_ORIGIN=http://localhost:5173`.

## API

- `GET /api/health` returns `{ "status": "ok" }`.
- `POST /api/analyze` accepts `{ "symbol": "BTC", "asset_type": "auto" }`, returning `{ "asset": ..., "regime": ... }`.
- `POST /api/chat` accepts `{ "message": "Should I buy NVDA?", "symbol": null, "asset_type": "auto" }`, returning `reply`, `analysis`, and `generated_at`. Market retrieval failures return a friendly reply and null analysis.

`asset_type` is `auto`, `stock`, or `crypto` (default: `auto`). Analyze symbols are 1–18 characters; chat messages are 1–2000 characters. Invalid requests return HTTP 422 with `detail`; unavailable market providers return HTTP 503 from analyze. The JSON fields used by the existing React frontend are preserved. There is no generated FastAPI `/docs` route.

Yahoo Finance daily adjusted closes feed SMA50, SMA200, Wilder-style RSI14, daily change, and up to 260 chart points. At least 200 valid daily closes are required. Benchmark regime uses SPY/QQQ for stocks and BTC/ETH for crypto, with UNKNOWN when either benchmark fails. History dates use the exchange timezone. Results are cached for 90 seconds per ticker and asset type, with concurrent request deduplication.

The Yahoo provider is unofficial and may be delayed or rate limited. Tests use injected histories and do not require network access or an OpenAI key.
