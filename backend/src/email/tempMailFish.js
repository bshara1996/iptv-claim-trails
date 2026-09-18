/**
 * TempMail.fish disposable email provider.
 *
 * API:
 *   POST /emails/new-email                       → { email, authKey }
 *   GET  /emails/emails?emailAddress={address}   → [{ id, from, subject, htmlBody, textBody }]
 *
 * Auth: `Authorization: <authKey>` header on subsequent requests.
 */
import logger from "../logger.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.tempmail.fish";
const TAG = "TempMail.fish";

// ── HTTP helper ───────────────────────────────────────────────────────────────

// Performs API requests with JSON headers and optional mailbox authKey.
const request = (path, { method = "GET", authKey } = {}) =>
  fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(authKey
        ? { Authorization: authKey }
        : { "Content-Type": "application/json" }),
    },
    signal: AbortSignal.timeout(20_000),
  }).then((r) => {
    if (!r.ok) throw new Error(`[${TAG}] ${path} → HTTP ${r.status}`);
    return r.json();
  });

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ address, authKey }) {
  let messages = [];

  return {
    // Fetches inbox messages and maps them to poller previews.
    async fetchMessages() {
      const data = await request(
        `/emails/emails?emailAddress=${encodeURIComponent(address)}`,
        { authKey },
      );
      messages = Array.isArray(data) ? data : (data?.emails ?? []);
      return messages.map((msg, index) => ({
        id: String(msg.id ?? msg._id ?? index),
        preview: [msg.from, msg.subject, msg.textBody]
          .filter(Boolean)
          .join(" · "),
      }));
    },

    // Returns full searchable message content (body + subject) by id.
    async readMessage(id) {
      const msg = messages.find(
        (m, index) => String(m.id ?? m._id ?? index) === id,
      );
      return [msg?.htmlBody, msg?.textBody, msg?.subject]
        .filter(Boolean)
        .join("\n");
    },
  };
}

const getReader = makeGetReader("_tempMailFishCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tempmail-fish",
    name: TAG,
    url: "https://tempmail.fish",
    description: "@frostypeak.info",
    apiOnly: true,
  },

  // Generates a disposable mailbox, saves authKey to store, and returns address.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const { email: address, authKey } = await request("/emails/new-email", {
      method: "POST",
    });

    if (!address || !authKey)
      throw new Error(`[${TAG}] Incomplete mailbox returned from API.`);

    store._tempMailFishCredential = { address, authKey };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
