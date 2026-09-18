/**
 * TempMailC disposable email provider.
 *
 * API:
 *   GET /api/v1/inbox?email={address}&code={apiCode} → { status: "ok", email, sender, subject, date, message }
 *   GET /api/v1/html?email={address}&code={apiCode}  → Raw HTML string
 *   GET /api/v1/code?email={address}&code={apiCode}  → { status: "ok", code: "123456" }
 */
import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";
import { generateUsername } from "../parsing/generators.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://private.tempmailc.com";
const TAG = "TempMailC";
const DOMAIN = process.env.TEMPMAILC_DOMAIN || "deiras.com";
const API_CODE = process.env.TEMPMAILC_API_CODE || "DPt8ez_7DLk";

const api = makeApi(BASE_URL);

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ address, code }) {
  // Keep the latest response so the poller can read the matching message.
  let messages = [];

  const inboxUrl = `/api/v1/inbox?email=${encodeURIComponent(
    address,
  )}&code=${encodeURIComponent(code)}`;
  const htmlUrl = `/api/v1/html?email=${encodeURIComponent(
    address,
  )}&code=${encodeURIComponent(code)}`;
  // TempMailC returns one message, so use its timestamp as the stable ID.
  const messageId = (message, index) =>
    String(message.date ?? message.id ?? index);

  return {
    async fetchMessages() {
      const data = await api(inboxUrl);
      // Normalize the provider response to the shared poller format.
      messages = data?.status === "ok" && data.message ? [data] : [];
      return messages.map((message, index) => ({
        id: messageId(message, index),
        preview: [message.sender, message.subject, message.message]
          .filter(Boolean)
          .join(" · "),
      }));
    },

    async readMessage(id) {
      const message = messages.find(
        (item, index) => messageId(item, index) === String(id),
      );
      try {
        // The HTML endpoint contains links that may not be in the JSON body.
        const response = await fetch(`${BASE_URL}${htmlUrl}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          return [message?.message, message?.subject, await response.text()]
            .filter(Boolean)
            .join("\n");
        }
      } catch (error) {
        logger.warn(`[${TAG}] Failed to fetch message HTML: ${error.message}`);
      }
      return [message?.message, message?.subject].filter(Boolean).join("\n");
    },
  };
}

const getReader = makeGetReader("_tempMailCCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tempmailc",
    name: TAG,
    url: BASE_URL,
    description: `@${DOMAIN}`,
    apiOnly: true,
  },

  // Generates a unique address on the assigned private domain.
  async createEmail(store) {
    logger.info(`[${TAG}] Generating email address on @${DOMAIN}...`);
    const address = `${generateUsername()}@${DOMAIN}`;
    store._tempMailCCredential = { address, code: API_CODE };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
