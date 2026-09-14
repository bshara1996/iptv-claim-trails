/**
 * Pokemail disposable email provider (session-backed REST API).
 *
 * POST /api/address                 → creates a mailbox and session cookies
 * GET  /api/inbox                   → lists received messages
 * GET  /api/email/{id}              → fetches a message
 */
import logger from "../logger.js";
import {
  cookieStr,
  createJar,
  DEFAULT_UA,
  mergeCookies,
} from "../http/cookieClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://pokemail.app";
const API_URL = `${BASE_URL}/api`;
const TAG = "Pokemail";
const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  "User-Agent": DEFAULT_UA,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Keeps the Pokemail session alive by sending and refreshing its cookies.
async function api(path, jar, method = "GET", body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { ...headers, Cookie: cookieStr(jar) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  mergeCookies(jar, response);
  const data = await response.json();
  if (!response.ok || !data?.ok)
    throw new Error(
      `[${TAG}] ${method} ${path} failed: ${data?.error?.message ?? response.status}`,
    );
  return data.data;
}

// Pokemail uses different fields for list previews and full message bodies.
const value = (message, fields) =>
  fields
    .map((field) => message?.[field])
    .filter(Boolean)
    .join(" ")
    .trim();
const previewFields = ["from", "sender", "to", "subject", "preview", "snippet"];
const contentFields = [
  "bodyHtml",
  "htmlBody",
  "html",
  "bodyText",
  "text",
  "textBody",
  "body",
  "content",
  "subject",
];

// Binds inbox requests to the mailbox session created by createEmail().
function buildReader({ jar }) {
  return {
    async fetchMessages() {
      const { emails = [] } = await api("/inbox?offset=0&limit=20", jar);
      return emails.map((message, index) => ({
        id: message.id ?? message._id ?? message.message_id ?? String(index),
        preview: value(message, previewFields),
      }));
    },

    async readMessage(id) {
      const data = await api(`/email/${encodeURIComponent(id)}`, jar);
      const message = data?.email ?? data?.message ?? data;
      return value(message, contentFields);
    },
  };
}

const getReader = makeGetReader("_pokemailCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "pokemail",
    name: "Pokemail",
    url: BASE_URL,
    description: "@pokemail.app",
    apiOnly: true,
  },

  // Creates a mailbox and stores its cookie jar for later polling.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const jar = createJar();
    const data = await api("/address", jar, "POST", {});
    const address = data?.address;
    if (!address) throw new Error(`[${TAG}] No address returned from API.`);

    store._pokemailCredential = { jar };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 1000, readDelay: 300 }),
};
