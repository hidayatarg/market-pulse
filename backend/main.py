import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from market import ALIASES, CRYPTO, get_regime, load_market

load_dotenv()

INSTRUCTIONS = """You are MarketPulse, a concise and careful financial research assistant.
Use only the supplied, timestamped market snapshot for prices and technical indicators.
Never invent a live price, SMA, RSI, target, news item, or data source.
Distinguish overall market regime from the selected asset's trend.
Explain whether the setup is a BUY CANDIDATE, HOLD/WAIT, or CAUTION/REDUCE RISK,
not a guaranteed trade or personalized financial advice. Note that SMA200 is a
technical heuristic, not the official definition of a bull or bear market.
Use a friendly tone, short paragraphs, and explain one major risk.
When no market snapshot is provided, ask for a ticker or answer general questions.
"""

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    symbol: str | None = None
    asset_type: Literal["auto", "stock", "crypto"] = "auto"

class AnalyzeRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=18)
    asset_type: Literal["auto", "stock", "crypto"] = "auto"

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="MarketPulse API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/analyze")
async def analyze(request: AnalyzeRequest):
    try:
        asset = await load_market(request.symbol, request.asset_type)
        regime = await get_regime(asset["asset_type"])
        return {"asset": asset, "regime": regime}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Market data provider unavailable. Try again shortly.") from exc

KNOWN = set(CRYPTO) | {"AAPL", "NVDA", "MSFT", "GOOGL", "GOOG", "AMZN", "TSLA", "META", "AVGO", "MU", "NBIS", "CRWV", "SPY", "QQQ", "AMD", "ORCL", "PLTR", "NFLX", "COIN", "MSTR", "INTC", "TSM", "JPM", "V", "MA", "BRK.B", "XRP", "DOGE"}

def detect_symbol(message: str) -> str | None:
    upper = message.upper()
    for alias in sorted(ALIASES, key=len, reverse=True):
        if re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", upper):
            return ALIASES[alias]
    for match in re.findall(r"(?<![A-Z0-9])\$?([A-Z][A-Z0-9.]{0,7})(?![A-Z0-9])", upper):
        if match in KNOWN:
            return match
    explicit = re.search(r"(?:TICKER|SYMBOL)\s*[:=]?\s*\$?([A-Z][A-Z0-9.]{0,7})", upper)
    return explicit.group(1) if explicit else None

async def explain(message: str, data: dict | None) -> str:
    if not os.getenv("OPENAI_API_KEY"):
        if not data:
            return "Welcome! Ask me about a ticker such as BTC, NVDA, SOL, or AAPL. I can show its price, 50/200-day averages, RSI, market regime, and a chart."
        a = data["asset"]; r = data["regime"]
        return (f"{a['symbol']} is {a['trend'].lower()} relative to its 200-day trend: ${a['price']:,.2f} versus SMA200 ${a['sma200']:,.2f}. "
                f"The broader market regime is {r['label'].lower()}; the technical assessment is {a['action']}. "
                "This is based on delayed daily data, not a live executable quote. A 200-day trend alone is not sufficient for a trading decision.")
    try:
        from agents import Agent, Runner, ModelSettings
        agent = Agent(name="market_analyst", model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"), instructions=INSTRUCTIONS,
                      model_settings=ModelSettings(max_tokens=550))
        prompt = f"User: {message}\nSnapshot (authoritative for numerical claims): {data if data is None else {'asset': {k:v for k,v in data['asset'].items() if k != 'history'}, 'regime': data['regime']}}"
        result = await Runner.run(agent, prompt)
        return str(result.final_output)
    except Exception:
        return await explain_fallback(data)

async def explain_fallback(data: dict | None) -> str:
    if not data:
        return "Tell me which ticker you want to analyze (for example, NVDA, BTC, or SOL)."
    a = data["asset"]; r = data["regime"]
    return (f"{a['symbol']} trades at ${a['price']:,.2f} on the latest available daily bar ({a['last_daily_bar']}). "
            f"Asset trend: {a['trend']}. Broader market: {r['label']}. Technical assessment: {a['action']}. "
            "Prices can be delayed, and this is not a personalized recommendation.")

@app.post("/api/chat")
async def chat(request: ChatRequest):
    symbol = request.symbol or detect_symbol(request.message)
    data = None
    if symbol:
        try:
            asset = await load_market(symbol, request.asset_type)
            regime = await get_regime(asset["asset_type"])
            data = {"asset": asset, "regime": regime}
        except (ValueError, Exception):
            return {"reply": f"I couldn't retrieve sufficient market data for {symbol}. Check the ticker and try again.", "analysis": None}
    reply = await explain(request.message, data)
    return {"reply": reply, "analysis": data, "generated_at": datetime.now(timezone.utc).isoformat()}
