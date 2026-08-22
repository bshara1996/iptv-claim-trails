/**
 * Email content extractors — pure functions with no side effects.
 *
 * Exports:
 *   extractLinks(content)     – collects all URLs from href attributes and bare links
 *   extractDuration(content)  – parses a subscription duration and computes expiry
 *   extractPlaylists(content) – parses M3U links and classifies TV/VOD playlists
 */

// ─── Duration units ───────────────────────────────────────────────────────────

const DURATION_UNITS = [
  { pattern: /дней|день|дня|days?/i, label: "Days", ms: 864e5 },
  { pattern: /месяцев|месяца|месяц|months?/i, label: "Months", ms: 2592e6 },
  { pattern: /часов|часа|час|hours?/i, label: "Hours", ms: 36e5 },
];

// ─── Exports ──────────────────────────────────────────────────────────────────

// Collects all URLs from href attributes and bare links in the email content
export function extractLinks(content) {
  const hrefs = [...content.matchAll(/href=["']([^"']+)["']/gi)].map(
    (m) => m[1],
  );
  const bare = [...content.matchAll(/https?:\/\/[^\s"'<>\]]+/gi)].map(
    (m) => m[0],
  );
  return [...new Set([...hrefs, ...bare])];
}

// Parses a duration string and computes an expiry timestamp
export function extractDuration(content) {
  const m = content.match(
    /(\d+)\s*(дней|день|дня|месяцев|месяца|месяц|часов|часа|час|days?|months?|hours?)/i,
  );
  if (!m) return { duration: null, expiresAt: null };
  const n = parseInt(m[1], 10);
  const unit = DURATION_UNITS.find((u) => u.pattern.test(m[2]));
  return {
    duration: unit
      ? `${n} ${n === 1 ? unit.label.slice(0, -1) : unit.label}`
      : `${n} ${m[2]}`,
    expiresAt: unit
      ? new Date(Date.now() + n * unit.ms).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : null,
  };
}

// Shared empty result for when no playlists are found
export const EMPTY_PLAYLISTS = {
  tvPlaylist: null,
  vodPlaylist: null,
  allM3uLinks: [],
  duration: null,
  expiresAt: null,
};

// Extracts and classifies M3U playlist links from email content.
// Returns null when no M3U links are found.
export function extractPlaylists(content) {
  const unique = [
    ...new Set(
      [
        ...content.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8?[^\s"'<>]*/gi),
        ...content.matchAll(/https?:\/\/[^\s"'<>]*[?&]type=m3u[^\s"'<>]*/gi),
      ].map((m) => m[0].replace(/&(?:lt|gt|amp|quot|apos);.*/i, "")),
    ),
  ];

  if (!unique.length) return null;

  const tv =
    unique.find((u) => /type=m3u|\/tv\.|\/playlist|live/i.test(u)) ?? unique[0];
  const vod =
    unique.find((u) => /\/vod\.|type=m3u8/i.test(u) && u !== tv) ??
    unique[1] ??
    null;
  const { duration, expiresAt } = extractDuration(content);

  return {
    tvPlaylist: tv,
    vodPlaylist: vod,
    allM3uLinks: unique,
    duration,
    expiresAt,
  };
}
