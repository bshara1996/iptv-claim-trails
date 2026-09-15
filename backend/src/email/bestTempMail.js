/**
 * Best Temp Mail disposable email provider.
 *
 * API:
 *   POST /api/v3/createEmail  → { status, data: { address, id, update_tag } }
 *   POST /api/v3/getEmailList → { status, data: { emailList, update_tag } }
 */
import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://best-temp-mail.com";
const TAG = "Best Temp Mail";
const api = makeApi(`${BASE_URL}/api/v3`);

// ── API helpers ───────────────────────────────────────────────────────────────

// Sends a POST request and returns the API data.
async function request(path, body) {
  const response = await api(path, { method: "POST", body });
  if (response?.status !== "success")
    throw new Error(`[${TAG}] ${path} returned an unsuccessful response.`);
  return response.data;
}

// Returns a stable message identifier.
const messageId = (message, index) =>
  message?.id ?? message?.send_time_by_sender ?? String(index);

// Combines the available message content fields.
const messageText = (message) =>
  [message?.html, message?.text, message?.subject].filter(Boolean).join("\n");

// Builds a short inbox preview.
const messagePreview = (message) =>
  [message?.from_address, message?.subject, message?.text]
    .filter(Boolean)
    .join(" ");

// ── Inbox reader ─────────────────────────────────────────────────────────────

function buildReader(credential) {
  // Empty refreshes omit emailList, so retain the previous list.
  let messages = [];

  // Fetches the current mailbox messages.
  const fetchMessages = () =>
    request("/getEmailList", {
      ...credential,
      update_tag: credential.updateTag,
    });

  return {
    // Lists messages for the poller.
    async fetchMessages() {
      const data = await fetchMessages();
      credential.updateTag = data?.update_tag ?? credential.updateTag;
      if (data?.hasNewEmail) messages = data.emailList ?? [];

      return messages.map((message, index) => ({
        id: messageId(message, index),
        preview: messagePreview(message),
      }));
    },

    // Returns the selected message content.
    async readMessage(id) {
      const message = messages.find(
        (item, index) => String(messageId(item, index)) === String(id),
      );
      return message ? messageText(message) : "";
    },
  };
}

const getReader = makeGetReader("_bestTempMailCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "best-temp-mail",
    name: TAG,
    url: BASE_URL,
    description: "@aabkmail.com",
    apiOnly: true,
  },

  // Creates a mailbox and stores its credentials.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const intToken = crypto.randomUUID();
    const {
      address,
      id,
      update_tag: updateTag,
    } = (await request("/createEmail", { intToken })) ?? {};

    if (!address || !id || !updateTag)
      throw new Error(`[${TAG}] Incomplete mailbox returned from API.`);

    store._bestTempMailCredential = { address, id, updateTag, intToken };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 1000, readDelay: 300 }),
};
