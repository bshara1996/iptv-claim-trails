/**
 * TempMail.ing disposable email provider (website API).
 *
 * Generates a temporary address and reads its inbox through the public API.
 * No account, token, or hardcoded mailbox is used.
 *
 * API:
 *   POST /api/generate             -> { success, email: { address, ... } }
 *   GET  /api/emails/{email}      -> { success, emails: [{ id, content, ... }] }
 */
import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.tempmail.ing";
const SITE_URL = "https://tempmail.ing";
const TAG = "TempMail.ing";
const api = makeApi(BASE_URL);

// ── Message helpers ───────────────────────────────────────────────────────────

// Returns the messages from the inbox response.
const messagesFrom = (data) => (Array.isArray(data?.emails) ? data.emails : []);

// Returns a stable message identifier.
const messageId = (message, index) =>
  message?.id ?? message?.message_id ?? message?.received_at ?? index;

// Combines message fields into searchable text.
const text = (message) =>
  [
    message?.from_address,
    message?.sender,
    message?.to_address,
    message?.subject,
    message?.preview,
    message?.text,
    message?.content,
    message?.html,
  ]
    .filter(Boolean)
    .join("\n");

// ── Inbox reader ─────────────────────────────────────────────────────────────

// Builds a reader for the generated mailbox address.
function buildReader(address) {
  let messages = [];
  const fetchMessages = () => api(`/api/emails/${encodeURIComponent(address)}`);

  // Finds a message in the cached inbox response.
  const findMessage = (id) =>
    messages.find(
      (message, index) => String(messageId(message, index)) === String(id),
    );

  return {
    // Fetches inbox messages and creates poller previews.
    async fetchMessages() {
      messages = messagesFrom(await fetchMessages());
      return messages.map((message, index) => ({
        id: messageId(message, index),
        preview: text(message),
      }));
    },

    // Returns the full content of one cached inbox message.
    async readMessage(id) {
      let message = findMessage(id);
      if (!message) {
        messages = messagesFrom(await fetchMessages());
        message = findMessage(id);
      }
      return text(message);
    },
  };
}

const getReader = makeGetReader("_tempmailIngAddress", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tempmail-ing",
    name: "TempMail.ing",
    url: SITE_URL,
    description: "@.com",
    apiOnly: false,
  },

  // Creates a mailbox through the TempMail.ing website API.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const data = await api("/api/generate", { method: "POST", body: {} });
    const address = data?.email?.address;
    if (!address)
      throw new Error(`[${TAG}] No email returned from /api/generate.`);

    store._tempmailIngAddress = address;
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
