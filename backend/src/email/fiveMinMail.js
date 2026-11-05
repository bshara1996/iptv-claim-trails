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
import { makeGetReader, createProviderMethods, messageIdOf, joinFields } from "./base.js";

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://5minmail.com";
const TAG = "5minMail";
const api = makeApi(BASE_URL);

const PREVIEW_FIELDS = "sender from to subject preview snippet body body_html body_text html text content";
const CONTENT_FIELDS = "body body_html body_text html text content subject";

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader(address) {
  let messages = [];
  const fetchInbox = () => api(`/inbox/${encodeURIComponent(address)}`);
  // Normalises the two inbox response shapes: bare array or { value: [...] }.
  const toList = (data) =>
    Array.isArray(data) ? data : Array.isArray(data?.value) ? data.value : [];
  const find = (id) =>
    messages.find((m, i) => String(messageIdOf(m, i)) === String(id));

  return {
    async fetchMessages() {
      messages = toList(await fetchInbox());
      return messages.map((m, i) => ({
        id: messageIdOf(m, i),
        preview: joinFields(m, PREVIEW_FIELDS),
      }));
    },

    async readMessage(id) {
      let msg = find(id);
      if (!msg) {
        messages = toList(await fetchInbox());
        msg = find(id);
      }
      return joinFields(msg, CONTENT_FIELDS);
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
