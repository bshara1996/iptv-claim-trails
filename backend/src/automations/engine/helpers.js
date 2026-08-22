/**
 * Shared helpers used across the engine.
 *
 * Exports:
 *   emit(emitter, type, data)        – fires a typed SSE event
 *   log(emitter, message, level)     – SSE log + server logger
 *   makeApiPageStub()                – no-op page for API-based providers
 *   buildRecord(service, email, src) – normalises a result into a UI record
 *   logPlaylists(emitter, record)    – logs playlist + duration info
 */
import logger from "../../logger.js";

export function emit(emitter, type, data = {}) {
  emitter.emit("event", { type, data, timestamp: new Date().toISOString() });
}

export function log(emitter, message, level = "info") {
  emit(emitter, "log", { message, level });
  (logger[level] ?? logger.info).call(logger, message);
}

// Returns a no-op page stub for API-based providers that don't use a browser
// page. Satisfies calls like bringToFront() and frames() made by services.
export function makeApiPageStub() {
  const noop = () => Promise.resolve();
  return { bringToFront: noop, waitForTimeout: noop, close: noop, frames: () => [] };
}

// Normalises a raw service result into a consistent shape for storage and the UI
export function buildRecord(service, email, src) {
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

export function logPlaylists(emitter, record) {
  if (record.duration)
    log(emitter, `⏳ Duration: ${record.duration}${record.expiresAt ? ` · Expires: ${record.expiresAt}` : ""}`);
  if (record.tvPlaylist)  log(emitter, `📺 TV Playlist: ${record.tvPlaylist}`);
  if (record.vodPlaylist) log(emitter, `🍿 VOD Playlist: ${record.vodPlaylist}`);
  else                    log(emitter, "ℹ️ VOD Playlist: none");
}
