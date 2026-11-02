# MarketPulse FastAPI backend

Managed with [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Set `OPENAI_API_KEY` in `.env` for optional AI explanations. See the root README for API examples.
