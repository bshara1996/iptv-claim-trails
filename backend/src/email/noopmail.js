/**
 * Noopmail disposable email provider.
 *
 * Uses the public Noopmail API:
 *   GET  /api/rd      → { dm, exp, kept }
 *   POST /api/c       → [{ id, from, to, subject, date, text, html, ... }]
 */
import logger from "../logger.js";
import { generateUsername } from "../parsing/generators.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const API_URL = "https://noopmail.org/api";
const BASE_URL = "https://noopmail.org";
const TAG = "Noopmail";
const api = makeApi(API_URL);

const messageId = (message, index) =>
  message?.id ??
  message?._id ??
  message?.message_id ??
  message?.date ??
  String(index);

const messageContent = (message) =>
  [
    message?.text,
    message?.html,
    message?.message,
    message?.body,
    message?.content,
    message?.subject,
  ]
    .filter(Boolean)
    .join("\n");

// Builds an inbox reader bound to a generated address.
function buildReader(address) {
  const fetchMessages = async () => {
    const data = await api("/c", {
      method: "POST",
      body: { e: address.e, d: address.d },
    });
    return Array.isArray(data)
      ? data
      : Array.isArray(data?.messages)
        ? data.messages
        : [];
  };

  return {
    async fetchMessages() {
      return (await fetchMessages()).map((message, index) => ({
        id: messageId(message, index),
        preview: [
          message?.from,
          message?.sender,
          message?.to,
          message?.subject,
          message?.preview,
          message?.intro,
          message?.text,
          message?.message,
        ]
          .filter(Boolean)
          .join(" ")
          .trim(),
      }));
    },

    async readMessage(id) {
      const message = (await fetchMessages()).find(
        (item, index) => String(messageId(item, index)) === String(id),
      );
      return message ? messageContent(message) : "";
    },
  };
}

const getReader = makeGetReader("_noopmailAddress", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "noopmail",
    name: "Noopmail",
    url: BASE_URL,
    description: "@noopmail.org",
    apiOnly: true,
  },

  async createEmail(store) {
    logger.info(`[${TAG}] Fetching a mailbox domain...`);
    const data = await api("/rd");
    const domain = data?.dm;
    if (!domain) throw new Error(`[${TAG}] No domain returned from API.`);

    const localPart = generateUsername();
    const address = `${localPart}@${domain}`;
    store._noopmailAddress = { e: localPart, d: domain };

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 1000, readDelay: 300 }),
};
