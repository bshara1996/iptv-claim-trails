/**
 * Temp-Mail.app disposable email provider (internal Next.js API).
 *
 * Creates a temporary mailbox and reads its inbox through the Temp-Mail.app internal API.
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
import { makeGetReader, createProviderMethods, joinFields } from "./base.js";

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://temp-mail.app";
const TAG = "Temp-Mail.app";

// ── HTTP helper ───────────────────────────────────────────────────────────────

// GETs a JSON endpoint, injecting the per-session visitor-id header.
async function get(path, visitorId) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json", "visitor-id": visitorId },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`[${TAG}] ${path} → HTTP ${res.status}`);
  return res.json();
}

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ visitorId }) {
  let messages = [];

  return {
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

    async readMessage(id) {
      const msg = messages.find((m) => String(m.id) === id);
      return joinFields(msg, "content subject preview");
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
