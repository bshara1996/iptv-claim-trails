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

export async function pollApi(
  { fetchMessages, readMessage },
  { filterText = "", seenIds = new Set(), timeout = 120_000 },
  onRow,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    let messages = [];
    try {
      messages = await fetchMessages();
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

      let content = "";
      try {
        content = await readMessage(id);
      } catch (err) {
        logger.warn(
          `[InboxPoller/API] Could not read message ${id}: ${err.message}`,
        );
        continue;
      }

      const result = await onRow(content, preview);
      if (result != null) return result;
    }

    await new Promise((r) => setTimeout(r, 4_000));
  }

  return null;
}
