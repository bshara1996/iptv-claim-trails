/**
 * Temp Mail LOL disposable email provider.
 *
 * Addresses are generated locally from one of the site's supported domains.
 * The provider exposes inbox messages through its public web API:
 *   GET /api/web/get/{email} → [{ subject, ...message body fields }]
 */
import logger from "../logger.js";
import { generateUsername } from "../parsing/generators.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const API_URL = "https://temp-mail-server.xm4n1d.easypanel.host";
const BASE_URL = "https://temp-mail.lol";
const TAG = "TempMailLol";
const api = makeApi(API_URL);

const messageId = (message, index) =>
  message._id ??
  message.id ??
  message.message_id ??
  message.date ??
  String(index);

const messageContent = (message) =>
  [
    message.message,
    message.text,
    message.html,
    message.body,
    message.content,
    message.subject,
  ]
    .filter(Boolean)
    .join("\n");

// Builds an inbox reader bound to a generated address.
function buildReader(address) {
  const fetchMessages = () =>
    api(`/api/web/get/${encodeURIComponent(address)}`);

  return {
    async fetchMessages() {
      const messages = await fetchMessages();
      return (Array.isArray(messages) ? messages : []).map(
        (message, index) => ({
          id: messageId(message, index),
          preview: [
            message.from,
            message.sender,
            message.receiver,
            message.subject,
            message.preview,
            message.intro,
            message.message,
          ]
            .filter(Boolean)
            .join(" ")
            .trim(),
        }),
      );
    },

    async readMessage(id) {
      const messages = await fetchMessages();
      const message = (Array.isArray(messages) ? messages : []).find(
        (item, index) => String(messageId(item, index)) === String(id),
      );
      return message ? messageContent(message) : "";
    },
  };
}

const getReader = makeGetReader("_tempMailLolAddress", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tempmail-lol",
    name: "Temp Mail LOL",
    url: BASE_URL,
    description: "@temp-mail.lol",
    apiOnly: true,
  },

  async createEmail(store) {
    logger.info(`[${TAG}] Fetching supported domains...`);
    const data = await api("/api/domains/website");
    const domains = (data?.domains ?? []).filter(
      (domain) => domain.status === "online" && !domain.appOnly,
    );
    if (!domains.length)
      throw new Error(`[${TAG}] No online domains available.`);

    const domain = domains[Math.floor(Math.random() * domains.length)].domain;
    const address = `${generateUsername()}@${domain}`;
    store._tempMailLolAddress = address;

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 1000, readDelay: 300 }),
};
