/**
 * Temp-Mail.app disposable email provider (internal Next.js API).
 *
 * API:
 *   GET /api/mail/address?refresh=false&expire=1440&part=main
 *       → { address, expire, remainingTime }
 *   GET /api/mail/list?part=main
 *       → { message: [{ id, content, fromName, fromAddress, from, subject, preview }] }
 *
 * Auth: `visitor-id` header — a UUID generated once per mailbox session.
 */
import logger from "../logger.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://temp-mail.app";
const TAG = "Temp-Mail.app";

// ── HTTP helper ───────────────────────────────────────────────────────────────

// GETs a JSON endpoint, injecting the per-session visitor-id header.
const get = (path, visitorId) =>
  fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json", "visitor-id": visitorId },
    signal: AbortSignal.timeout(20_000),
  }).then((r) => {
    if (!r.ok) throw new Error(`[${TAG}] ${path} → HTTP ${r.status}`);
    return r.json();
  });

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ visitorId }) {
  let messages = [];

  return {
    // Fetches the inbox and returns normalised message previews for the poller.
    async fetchMessages() {
      const data = await get("/api/mail/list?part=main", visitorId);
      messages = data?.message?.filter(Boolean) ?? [];
      return messages.map((msg) => ({
        id: String(msg.id),
        preview: [msg.fromName || msg.from, msg.subject, msg.preview]
          .filter(Boolean)
          .join(" · "),
      }));
    },

    // Returns the full content of a cached message by id.
    async readMessage(id) {
      const msg = messages.find((m) => String(m.id) === id);
      return [msg?.content, msg?.subject, msg?.preview]
        .filter(Boolean)
        .join("\n");
    },
  };
}

const getReader = makeGetReader("_tempMailAppCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tempmail-app",
    name: "Temp-Mail.app",
    url: BASE_URL,
    description: "@minitts.net",
    apiOnly: true,
  },

  // Generates a visitor UUID, fetches a fresh address, and stores both on the store.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const visitorId = crypto.randomUUID();
    const { address } = await get(
      "/api/mail/address?refresh=false&expire=1440&part=main",
      visitorId,
    );

    if (!address)
      throw new Error(`[${TAG}] No address returned from /api/mail/address.`);

    store._tempMailAppCredential = { address, visitorId };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
