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

const RATE_DELAY = 1_500; // 1 request per 1.5 s stays safely under Mail.tm rate limits

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

      await new Promise((r) => setTimeout(r, RATE_DELAY)); // gap before request 2

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

    await new Promise((r) => setTimeout(r, RATE_DELAY)); // gap before next fetchMessages
  }

  return null;
}
