/**
 * 5minMail disposable email provider (website API).
 *
 * Generates a temporary address and reads its inbox through the public
 * 5minMail website endpoints. No account, token, or hardcoded mailbox is used.
 *
 * API:
 *   POST /generate          → { email, expires_in_minutes, session_id }
 *   GET  /inbox/{email}     → { value: [{ sender, subject, body, ... }] }
 */
import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://5minmail.com";
const TAG = "5minMail";
const api = makeApi(BASE_URL);

const previewFields =
  "sender from to subject preview snippet body body_html body_text html text content";
const contentFields = "body body_html body_text html text content subject";

// ── Message helpers ───────────────────────────────────────────────────────────

// Returns the message array from either supported inbox response shape.
const messagesFrom = (data) =>
  Array.isArray(data) ? data : Array.isArray(data?.value) ? data.value : [];

// Combines selected message fields into searchable or readable text.
const text = (message, fields) =>
  fields
    .split(" ")
    .map((field) => message?.[field])
    .filter(Boolean)
    .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
    .join("\n")
    .trim();

// Returns a stable identifier for a message when the API omits an id.
const messageId = (message, index) =>
  message?.id ??
  message?._id ??
  message?.message_id ??
  message?.received_at ??
  index;

// ── Inbox reader ─────────────────────────────────────────────────────────────

function buildReader(address) {
  let messages = [];
  const fetchMessages = () => api(`/inbox/${encodeURIComponent(address)}`);

  // Finds a message in the response cached by fetchMessages().
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
        preview: text(message, previewFields),
      }));
    },

    // Returns the full content of one cached inbox message.
    async readMessage(id) {
      let message = findMessage(id);

      // Read the same payload that produced the poll result. Some mailbox
      // implementations reorder or omit messages between two requests.
      if (!message) {
        messages = messagesFrom(await fetchMessages());
        message = findMessage(id);
      }

      return text(message, contentFields);
    },
  };
}

const getReader = makeGetReader("_fiveMinMailAddress", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "5minmail",
    name: "5minMail",
    url: BASE_URL,
    description: "@zelnro.com",
    apiOnly: false,
  },

  // Creates a mailbox through the 5minMail website.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const { email: address, expires_in_minutes: expires } = await api(
      "/generate",
      { method: "POST" },
    );
    if (!address) throw new Error(`[${TAG}] No email returned from /generate.`);

    store._fiveMinMailAddress = address;
    logger.info(
      `[${TAG}] Email ready: ${address} (expires in ${expires ?? "unknown"} minutes)`,
    );
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
