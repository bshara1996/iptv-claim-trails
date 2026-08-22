/**
 * Task runner — orchestrates the full automation lifecycle for a single task.
 */
import { createContext, closeContext } from "../../browser.js";
import { getProvider, getService } from "../registry.js";
import logger from "../../logger.js";
import { tasks } from "./taskStore.js";
import { emit, log, makeApiPageStub, buildRecord, logPlaylists } from "./helpers.js";
import { runLegacyService } from "./legacy.js";

export async function runTask(taskId, providerId, serviceIds, { headless } = {}) {
  const task = tasks.get(taskId);
  if (!task) return;

  const { emitter, abortController: { signal } } = task;
  task.status = "running";

  // ── Validate inputs ───────────────────────────────────────────────────────

  const provider = getProvider(providerId);
  if (!provider) {
    log(emitter, `Unknown email provider: "${providerId}"`, "error");
    task.status = "error";
    emitter.emit("done");
    return;
  }

  const services = serviceIds.flatMap((id) => {
    const s = getService(id);
    if (!s) logger.warn(`[Engine] Unknown service id: "${id}" — skipped`);
    return s ? [s] : [];
  });

  if (!services.length) {
    log(emitter, "No valid registration services selected.", "error");
    task.status = "error";
    emitter.emit("done");
    return;
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  let context = null;

  try {
    log(emitter, `Launching browser (${headless ? "headless" : "visible"})...`);
    context = await createContext({ headless });
    if (signal.aborted) throw new DOMException("", "AbortError");

    // API-based providers don't navigate a real page — close the default blank
    // tab Chromium opens with every new context and use a no-op stub instead.
    if (provider.meta.apiOnly) {
      for (const p of context.pages()) await p.close().catch(() => {});
    }

    const emailPage = provider.meta.apiOnly
      ? makeApiPageStub()
      : await context.newPage();

    const email = await provider.createEmail(emailPage);
    emit(emitter, "email_created", { email, provider: provider.meta.name });
    log(emitter, `Temporary email ready: ${email}`);

    // Shared across all services so an email opened by one is never re-read
    // by the next one. The Set accumulates IDs by reference throughout the run.
    const inboxSeenIds = new Set();

    for (const service of services) {
      if (signal.aborted) break;

      log(emitter, `Starting registration on ${service.meta.name}...`);
      emit(emitter, "service_start", { serviceId: service.meta.id, name: service.meta.name });

      const regPage = await context.newPage();

      try {
        // Dispatch: execute() (current API) or register() (legacy)
        const result = typeof service.execute === "function"
          ? await service.execute({
              page: regPage, emailPage, provider, email, inboxSeenIds,
              log: (msg, level = "info") => log(emitter, msg, level),
            })
          : await runLegacyService(service, regPage, emailPage, provider, email, inboxSeenIds, emitter);

        const record = buildRecord(service, email, result);
        task.results.push(record);
        emit(emitter, "result", record);
        logPlaylists(emitter, record);
      } catch (err) {
        const status = err.type === "CAPTCHA" ? "captcha" : "failed";
        const record = buildRecord(service, email, { status, note: err.message });
        task.results.push(record);
        emit(emitter, "result", record);
        log(emitter, `${status === "captcha" ? "🛡️" : "❌"} ${service.meta.name}: ${err.message}`, "warn");
      }
    }

    task.status = signal.aborted ? "cancelled" : "done";
    log(emitter, signal.aborted
      ? "Task was cancelled by user."
      : `Automation complete. ${task.results.length} service(s) processed.`);
  } catch (err) {
    if (err.name === "AbortError") {
      task.status = "cancelled";
      log(emitter, "Task was cancelled by user.");
    } else {
      task.status = "error";
      log(emitter, `Fatal error: ${err.message}`, "error");
      emit(emitter, "error", { message: err.message });
    }
  } finally {
    emit(emitter, "done", { status: task.status, results: task.results });
    emitter.emit("done");
    if (task.status === "cancelled" && context)
      await closeContext(context).catch(() => {});
  }
}
