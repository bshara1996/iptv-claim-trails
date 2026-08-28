/**
 * Emailnator disposable email provider.
 *
 * Uses the Emailnator web API (https://www.emailnator.com).
 * Generates Gmail addresses (dot-trick variant by default).
 * Mailbox UI: https://www.emailnator.com/inbox#<address>
 *
 * API flow (Next.js rewrite — no session/XSRF required):
 *   POST /api/generate-email  { ids: [<typeId>] }   → { email: "address", ... }
 *   POST /api/message-list    { email }              → { messages: [{id, from, subject, ...}], ... }
 *   GET  /api/message/:id                            → { id, from, subject, date, content }
 *
 * Email type IDs:
 *   domain   = 1
 *   plusGmail  = 2
 *   dotGmail   = 3  (default — dot-trick @gmail.com)
 *   googleMail = 8
 */
import logger from "../../logger.js";
import { makeGetReader, createProviderMethods } from "./base/apiProvider.js";

const BASE_URL = "https://www.emailnator.com";
const TAG = "Emailnator";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Email type IDs as defined by the Emailnator API
const EMAIL_TYPES = { domain: 1, plusGmail: 2, dotGmail: 3, googleMail: 8 };

// ── Shared headers (no auth required) ────────────────────────────────────────

function baseHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent": UA,
    Referer: `${BASE_URL}/`,
    Origin: BASE_URL,
    ...extra,
  };
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[${TAG}] POST ${path} → ${res.status} ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/html, */*",
      Referer: `${BASE_URL}/`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[${TAG}] GET ${path} → ${res.status} ${text.substring(0, 200)}`);
  }
  return res.json();
}

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ address }) {
  return {
    // Fetches the inbox message list.
    async fetchMessages() {
      const data = await apiPost("/api/message-list", { email: address });
      return (data?.messages ?? [])
        .filter((m) => !m.locked) // skip premium-locked entries
        .map((m) => ({
          id: m.id,
          preview: [m.from ?? "", m.subject ?? ""].join(" ").trim(),
        }));
    },

    // Fetches the full message content by ID.
    // The new API returns JSON: { id, from, subject, date, content (HTML string) }
    async readMessage(id) {
      const data = await apiGet(`/api/message/${encodeURIComponent(id)}`);
      return data?.content ?? "";
    },
  };
}

const getReader = makeGetReader("_emailnatorCredential", TAG, buildReader);

// Emailnator has no rate limit — poll faster than the shared defaults (800 ms / 1500 ms).
const FAST = { pollDelay: 300, readDelay: 500 };

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "emailnator",
    name: "Emailnator",
    url: BASE_URL,
    description:
      "Disposable dotGmail (@gmail.com) address via Emailnator (API)",
    apiOnly: true,
  },

  async createEmail(page) {
    logger.info(`[${TAG}] Generating dotGmail address...`);
    const data = await apiPost("/api/generate-email", {
      ids: [EMAIL_TYPES.dotGmail],
    });

    const address = typeof data?.email === "string" ? data.email : null;
    if (!address)
      throw new Error(`[${TAG}] No address returned from generate-email.`);

    page._emailnatorCredential = { address };

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, FAST),
};
