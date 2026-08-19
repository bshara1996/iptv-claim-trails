import "dotenv/config";
import express from "express";
import cors from "cors";
import automationRoutes from "./routes.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/automation", automationRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

process.on("uncaughtException", (err) => {
  console.error("⚠ [Process] Uncaught Exception:", err.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠ [Process] Unhandled Rejection:", reason?.message || reason);
});

app.listen(PORT, () => {
  console.log(`\n🚀  IPTV Automation backend  →  http://localhost:${PORT}\n`);
});
