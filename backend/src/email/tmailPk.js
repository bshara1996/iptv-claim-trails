/**
 * Tmail.pk disposable email provider.
 *
 * API:
 *   POST /api/mailbox/generate                 → { email, password, token }
 *   GET  /api/emails/list?recipient={address}  → { emails: [{ id, from_address, subject, body_html, body_text }] }
 *
 * Auth: `Authorization: Bearer <token>` header on mailbox endpoints.
 */
import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://www.tmail.pk";
const TAG = "Tmail.pk";

// Active domain pool used for instant mailbox generation without pre-fetching.
const DOMAINS = [
  "gemail.pk",
  "yaho.pk",
  "claude.pk",
  "qamify.net",
  "haygien.com",
  "mevday.com",
];
const api = makeApi(BASE_URL);

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ address, token }) {
  let messages = [];

  return {
    // Queries inbox messages with Bearer auth and maps to poller previews.
    async fetchMessages() {
      const data = await api(
        `/api/emails/list?recipient=${encodeURIComponent(address)}`,
        { token },
      );
      messages = data?.emails ?? [];
      return messages.map((msg, index) => ({
        id: String(msg.id ?? msg._id ?? index),
        preview: [msg.from_name || msg.from_address, msg.subject, msg.body_text]
          .filter(Boolean)
          .join(" · "),
      }));
    },

    // Returns combined HTML, plaintext, and subject content for verification parsing.
    async readMessage(id) {
      const msg = messages.find(
        (m, index) => String(m.id ?? m._id ?? index) === id,
      );
      return [msg?.body_html, msg?.body_text, msg?.subject]
        .filter(Boolean)
        .join("\n");
    },
  };
}

const getReader = makeGetReader("_tmailPkCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tmail-pk",
    name: TAG,
    url: BASE_URL,
    description: "@.pk",
    apiOnly: true,
  },

  // Creates a guest mailbox, caches auth token & password on store, and returns address.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const {
      email: address,
      token,
      password,
    } = await api("/api/mailbox/generate", {
      method: "POST",
      body: { domains: DOMAINS },
    });

    if (!address || !token)
      throw new Error(`[${TAG}] Incomplete mailbox returned from API.`);

    store._tmailPkCredential = { address, token, password };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
