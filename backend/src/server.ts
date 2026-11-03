import "dotenv/config";
import { createApp } from "./app.js";
const port = Number(process.env.PORT || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer between 1 and 65535.");
const host = process.env.HOST || "127.0.0.1";
const server = createApp().listen(port, host, () =>
  console.log(`MarketPulse API listening on http://${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
