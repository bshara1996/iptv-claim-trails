/**
 * result.js
 *
 * Single place that constructs the service result object.
 * Every service calls buildResult() instead of manually building
 * the same { username, password, tvPlaylist, ... status: "success" } shape.
 *
 * Convenience inputs (pick one):
 *   hours      — trial hours  → duration + expiresAt computed automatically
 *   expiryDate — Date object  → duration + expiresAt computed automatically
 *
 * Direct overrides (take precedence over hours/expiryDate):
 *   duration, expiresAt — pass pre-formatted strings to skip computation
 *
 * allM3uLinks is auto-derived from tvPlaylist when not provided.
 *
 * Exports:
 *   buildResult(fields) — returns a normalised service result object
 */

import { computeExpiresAt, formatDuration } from "./generators.js";

const TZ = "Asia/Jerusalem";

// Builds a normalised service result object.
// Services only pass the fields they know — everything else defaults to null.
export function buildResult({
  username = null,
  password = null,
  tvPlaylist = null,
  vodPlaylist = null,
  allM3uLinks = null,
  hours = null,
  expiryDate = null,
  duration = null,
  expiresAt = null,
  note = null,
} = {}) {
  // Derive allM3uLinks from tvPlaylist when not explicitly provided.
  const links = allM3uLinks ?? (tvPlaylist ? [tvPlaylist] : []);

  // Resolve duration: prefer explicit string, then Date, then hours.
  const resolvedDuration =
    duration ??
    (expiryDate
      ? formatDuration(expiryDate)
      : hours != null
        ? `${hours} Hours`
        : null);

  // Resolve expiresAt: prefer explicit string, then Date, then hours offset.
  const resolvedExpiresAt =
    expiresAt ??
    (expiryDate
      ? computeExpiresAt(expiryDate, { timeZone: TZ })
      : hours != null
        ? computeExpiresAt(hours * 3_600_000, { timeZone: TZ })
        : null);

  return {
    username,
    password,
    tvPlaylist,
    vodPlaylist,
    allM3uLinks: links,
    duration: resolvedDuration,
    expiresAt: resolvedExpiresAt,
    status: "success",
    note,
  };
}
