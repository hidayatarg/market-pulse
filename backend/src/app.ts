import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { z } from "zod";
import {
  createMarketService,
  MarketInputError,
  type Analysis,
  type MarketService,
} from "./market.js";
import { detectSymbol, explain } from "./analyst.js";
const assetType = z.enum(["auto", "stock", "crypto"]).default("auto");
const analyzeSchema = z.object({
  symbol: z.string().min(1).max(18),
  asset_type: assetType,
});
const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  symbol: z.string().nullable().optional(),
  asset_type: assetType,
});
export function createApp(
  service: MarketService = createMarketService(),
  explainReply = explain,
) {
  const app = express();
  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/api/analyze", async (req, res) => {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    try {
      const asset = await service.loadMarket(
        parsed.data.symbol,
        parsed.data.asset_type,
      );
      res.json({ asset, regime: await service.getRegime(asset.asset_type) });
    } catch (error) {
      res.status(error instanceof MarketInputError ? 422 : 503).json({
        detail:
          error instanceof MarketInputError
            ? error.message
            : "Market data provider unavailable. Try again shortly.",
      });
    }
  });
  app.post("/api/chat", async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    const request = parsed.data,
      symbol = request.symbol || detectSymbol(request.message);
    let data: Analysis | null = null;
    if (symbol) {
      try {
        const asset = await service.loadMarket(symbol, request.asset_type);
        data = { asset, regime: await service.getRegime(asset.asset_type) };
      } catch {
        res.json({
          reply: `I couldn't retrieve sufficient market data for ${symbol}. Check the ticker and try again.`,
          analysis: null,
        });
        return;
      }
    }
    res.json({
      reply: await explainReply(request.message, data),
      analysis: data,
      generated_at: new Date().toISOString(),
    });
  });
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 422
          : 500;
    res.status(status).json({
      detail:
        status === 413
          ? "Request body too large."
          : status === 422
            ? "Invalid JSON request body."
            : "Internal server error.",
    });
  };
  app.use(onError);
  return app;
}
