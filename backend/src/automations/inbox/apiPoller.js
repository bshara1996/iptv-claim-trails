/**
 * API-based inbox poll loop for REST-API providers (e.g. Mail.tm).
 *
 * Instead of driving a browser page, it accepts a reader object with two methods:
 *   fetchMessages() → [{ id, preview }]
 *   readMessage(id) → full email content string
 *
 * The same seenIds / filterText / timeout contract as the browser poll loop is
 * honoured, so callers work identically regardless of provider type.
 *
 * Exports:
 *   pollApi(reader, opts, onRow) – poll loop for REST-API inbox providers
 */

import logger from "../../logger.js";

// How long to wait between fetch-messages poll cycles.
// 800 ms keeps the loop responsive while staying well within the 100 req/min limit.
const POLL_DELAY = 800;

// How long to wait before reading an individual message (the second HTTP request).
// Kept higher to give Mail.tm's rate limiter breathing room when a new message is found.
const READ_DELAY = 1_500;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pollApi(
  { fetchMessages, readMessage },
  { filterText = "", seenIds = new Set(), timeout = 120_000 },
  onRow,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    let messages = [];
    try {
      messages = await fetchMessages(); // request 1
    } catch (err) {
      logger.warn(`[InboxPoller/API] Failed to fetch messages: ${err.message}`);
    }

    logger.info(`[InboxPoller/API] Inbox: ${messages.length} message(s).`);

    for (const { id, preview } of messages) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      if (
        filterText &&
        !preview.toLowerCase().includes(filterText.toLowerCase())
      )
        continue;

      await delay(READ_DELAY); // gap before request 2

      let content = "";
      try {
        content = await readMessage(id); // request 2
      } catch (err) {
        logger.warn(
          `[InboxPoller/API] Could not read message ${id}: ${err.message}`,
        );
        continue;
      }

      const result = await onRow(content, preview);
      if (result != null) return result;
    }

    await delay(POLL_DELAY); // gap before next fetchMessages
  }

  return null;
}
