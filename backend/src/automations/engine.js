import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";
import {
  createContext,
  closeContext,
  forceCloseAllContexts,
} from "../browser.js";
import { getProvider, getService } from "./registry.js";
import logger from "../logger.js";

const tasks = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(emitter, type, data = {}) {
  emitter.emit("event", { type, data, timestamp: new Date().toISOString() });
}

function log(emitter, message, level = "info") {
  emit(emitter, "log", { message, level });
  (logger[level] ?? logger.info).call(logger, message);
}

function buildRecord(service, email, src) {
  return {
    serviceId: service.meta.id,
    service: service.meta.name,
    email,
    username: src.username ?? null,
    password: src.password ?? null,
    tvPlaylist: src.tvPlaylist ?? null,
    vodPlaylist: src.vodPlaylist ?? null,
    duration: src.duration ?? null,
    expiresAt: src.expiresAt ?? null,
    allM3uLinks: src.allM3uLinks ?? (src.tvPlaylist ? [src.tvPlaylist] : []),
    status: src.status ?? "success",
    note: src.note ?? null,
    timestamp: new Date().toISOString(),
  };
}

function logPlaylists(emitter, record) {
  if (record.duration)
    log(
      emitter,
      `⏳ Duration: ${record.duration}${record.expiresAt ? ` · Expires: ${record.expiresAt}` : ""}`,
    );
  if (record.tvPlaylist) log(emitter, `📺 TV Playlist: ${record.tvPlaylist}`);
  if (record.vodPlaylist)
    log(emitter, `🍿 VOD Playlist: ${record.vodPlaylist}`);
  else log(emitter, "ℹ️ VOD Playlist: none");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createTask() {
  const taskId = uuidv4();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  tasks.set(taskId, {
    emitter,
    abortController: new AbortController(),
    status: "pending",
    results: [],
  });

  return { taskId, emitter };
}

export function getTask(taskId) {
  return tasks.get(taskId) ?? null;
}

export async function cancelTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || !["running", "pending"].includes(task.status)) return;
  task.abortController.abort();
  task.status = "cancelling";
  await forceCloseAllContexts();
}

export async function runTask(
  taskId,
  providerId,
  serviceIds,
  { headless } = {},
) {
  const task = tasks.get(taskId);
  if (!task) return;

  const {
    emitter,
    abortController: { signal },
  } = task;
  task.status = "running";

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

  let context = null;

  try {
    log(emitter, `Launching browser (${headless ? "headless" : "visible"})...`);
    context = await createContext({ headless });
    if (signal.aborted) throw new DOMException("", "AbortError");

    const emailPage = await context.newPage();
    const email = await provider.createEmail(emailPage);
    emit(emitter, "email_created", { email, provider: provider.meta.name });
    log(emitter, `Temporary email ready: ${email}`);

    for (const service of services) {
      if (signal.aborted) break;

      log(emitter, `Starting registration on ${service.meta.name}...`);
      emit(emitter, "service_start", {
        serviceId: service.meta.id,
        name: service.meta.name,
      });

      const regPage = await context.newPage();

      try {
        let result;

        if (typeof service.execute === "function") {
          result = await service.execute({
            page: regPage,
            emailPage,
            provider,
            email,
            log: (msg, level = "info") => log(emitter, msg, level),
          });
        } else {
          result = await service.register(regPage, email);

          // register() only submits the form — poll inbox for M3U links
          log(
            emitter,
            `📬 Checking inbox for ${service.meta.name} confirmation & playlists...`,
          );
          await emailPage.bringToFront().catch(() => {});

          const playlists = await provider
            .waitForEmailAndExtractPlaylists(emailPage, {
              filterText:
                service.meta.id === "rutv" ? "ru-tv" : service.meta.name,
              timeout: 60_000,
            })
            .catch((e) => {
              log(emitter, `Notice: ${e.message}`, "warn");
              return {};
            });

          result = {
            ...result,
            ...playlists,
            note: playlists.tvPlaylist
              ? playlists.duration
                ? `${playlists.duration}${playlists.expiresAt ? ` (Expires: ${playlists.expiresAt})` : ""}`
                : "IPTV playlists collected successfully!"
              : (result.note ?? "Registered — check inbox for playlist links."),
          };
        }

        const record = buildRecord(service, email, result);
        task.results.push(record);
        emit(emitter, "result", record);
        logPlaylists(emitter, record);
      } catch (err) {
        const status = err.type === "CAPTCHA" ? "captcha" : "failed";
        const record = buildRecord(service, email, {
          status,
          note: err.message,
        });
        task.results.push(record);
        emit(emitter, "result", record);
        log(
          emitter,
          `${status === "captcha" ? "🛡️" : "❌"} ${service.meta.name}: ${err.message}`,
          "warn",
        );
      }
    }

    task.status = signal.aborted ? "cancelled" : "done";
    log(
      emitter,
      signal.aborted
        ? "Task was cancelled by user."
        : `Automation complete. ${task.results.length} service(s) processed.`,
    );
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
