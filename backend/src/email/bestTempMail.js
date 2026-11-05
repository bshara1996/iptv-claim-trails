/**
 * Best Temp Mail disposable email provider.
 *
 * Creates a temporary mailbox and reads its inbox through the Best Temp Mail API.
 *
 * API:
 *   POST /api/v3/createEmail  → { status, data: { address, id, update_tag } }
 *   POST /api/v3/getEmailList → { status, data: { emailList, update_tag } }
 */

import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods, joinFields } from "./base.js";

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://best-temp-mail.com";
const TAG = "Best Temp Mail";
const api = makeApi(`${BASE_URL}/api/v3`);

// ── HTTP helper ───────────────────────────────────────────────────────────────

// Sends a POST request and returns the API data.
async function request(path, body) {
  const response = await api(path, { method: "POST", body });
  if (response?.status !== "success")
    throw new Error(`[${TAG}] ${path} returned an unsuccessful response.`);
  return response.data;
}

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader(credential) {
  // Empty refreshes omit emailList, so retain the previous list.
  let messages = [];
  // send_time_by_sender is a provider-specific fallback not in the shared messageIdOf.
  const msgId = (msg, i) => msg?.id ?? msg?.send_time_by_sender ?? String(i);
  const find = (sid) =>
    messages.find((msg, i) => String(msgId(msg, i)) === String(sid));

  return {
    async fetchMessages() {
      const data = await request("/getEmailList", { ...credential, update_tag: credential.updateTag });
      credential.updateTag = data?.update_tag ?? credential.updateTag;
      if (data?.hasNewEmail) messages = data.emailList ?? [];
      return messages.map((msg, i) => ({
        id: msgId(msg, i),
        preview: joinFields(msg, "from_address subject text"),
      }));
    },

    async readMessage(sid) {
      const msg = find(sid);
      return msg ? joinFields(msg, "html text subject") : "";
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

  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const intToken = crypto.randomUUID();
    const { address, id, update_tag: updateTag } =
      (await request("/createEmail", { intToken })) ?? {};

    if (!address || !id || !updateTag)
      throw new Error(`[${TAG}] Incomplete mailbox returned from API.`);

    store._bestTempMailCredential = { address, id, updateTag, intToken };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
