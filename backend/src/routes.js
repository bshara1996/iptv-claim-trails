import { Router } from "express";
import {
  emailProviders,
  registrationServices,
} from "./automations/registry.js";
import {
  createTask,
  runTask,
  cancelTask,
  getTask,
} from "./automations/engine.js";
import logger from "./logger.js";

const router = Router();

// ─── GET /api/automation/info ─────────────────────────────────────────────────
// Returns all available providers and services for the UI to display.
router.get("/info", (_req, res) => {
  res.json({
    providers: emailProviders.map((p) => p.meta),
    services: registrationServices.map((s) => s.meta),
  });
});

// ─── POST /api/automation/start ───────────────────────────────────────────────
// Body: { providerId: string, serviceIds: string[], headless?: boolean }
// Returns: { taskId: string }
router.post("/start", async (req, res) => {
  const { providerId, serviceIds, headless } = req.body;

  if (!providerId || !Array.isArray(serviceIds) || !serviceIds.length) {
    return res
      .status(400)
      .json({ error: "`providerId` and `serviceIds[]` are required." });
  }

  const { taskId } = createTask();
  logger.info(`[Route] Starting task ${taskId} (headless=${headless})`);

  runTask(taskId, providerId, serviceIds, { headless }).catch((err) =>
    logger.error(`[Route] Unhandled task error: ${err.message}`),
  );

  res.json({ taskId });
});

// ─── POST /api/automation/stop/:taskId ───────────────────────────────────────
router.post("/stop/:taskId", async (req, res) => {
  await cancelTask(req.params.taskId);
  res.json({ ok: true });
});

// ─── GET /api/automation/stream/:taskId  (SSE) ───────────────────────────────
router.get("/stream/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);

  const sendEvent = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const onDone = () => {
    clearInterval(keepAlive);
    res.write(`data: ${JSON.stringify({ type: "stream_end" })}\n\n`);
    res.end();
  };

  task.emitter.on("event", sendEvent);
  task.emitter.once("done", onDone);

  req.on("close", () => {
    clearInterval(keepAlive);
    task.emitter.off("event", sendEvent);
    task.emitter.off("done", onDone);
  });
});

// ─── GET /api/automation/results/:taskId ─────────────────────────────────────
router.get("/results/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ status: task.status, results: task.results });
});

export default router;
