/**
 * Emailnator disposable email provider.
 *
 * Uses the Emailnator web API (https://www.emailnator.com).
 * Generates GoogleMail (@gmail.com) addresses only.
 * Mailbox UI: https://www.emailnator.com/mailbox#<address>
 *
 * API flow:
 *   GET  /                           → session cookies + XSRF-TOKEN
 *   POST /generate-email             → { email: ["googleMail"] } → address
 *   POST /message-list  { email }    → message list
 *   POST /message-list  { email, messageID } → message HTML
 */
import logger from "../../logger.js";
import { makeGetReader, createProviderMethods } from "./base/apiProvider.js";

const BASE_URL = "https://www.emailnator.com";
const TAG = "Emailnator";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Session ───────────────────────────────────────────────────────────────────

// GETs the homepage to acquire session cookies and the XSRF token required for all POSTs.
async function acquireSession() {
  const res = await fetch(BASE_URL, { headers: { "User-Agent": UA } });

  const rawCookies = res.headers.getSetCookie?.() ?? [];
  const cookieHeader =
    rawCookies.length > 0
      ? rawCookies.map((c) => c.split(";")[0]).join("; ")
      : (res.headers.get("set-cookie") ?? "");

  const xsrfMatch = cookieHeader.match(/XSRF-TOKEN=([^;,\s]+)/);
  if (!xsrfMatch) throw new Error(`[${TAG}] Could not extract XSRF-TOKEN.`);

  return { cookies: cookieHeader, xsrf: decodeURIComponent(xsrfMatch[1]) };
}

function authHeaders({ cookies, xsrf }) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    Cookie: cookies,
    "x-xsrf-token": xsrf,
    "x-requested-with": "XMLHttpRequest",
    "User-Agent": UA,
    Referer: BASE_URL,
  };
}

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader({ address, cookies, xsrf }) {
  let session = { cookies, xsrf };

  // POSTs to an Emailnator endpoint; refreshes the session once on 401/419.
  async function post(path, body) {
    let res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 419) {
      logger.warn(`[${TAG}] Session expired (${res.status}), re-acquiring...`);
      session = await acquireSession();
      res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) throw new Error(`[${TAG}] POST ${path} → ${res.status}`);
    return res;
  }

  return {
    // Fetches the inbox; filters out the synthetic "ADSVPN" ad entry.
    async fetchMessages() {
      const data = await (
        await post("/message-list", { email: address })
      ).json();
      return (data?.messageData ?? [])
        .filter((m) => m.messageID !== "ADSVPN")
        .map((m) => ({
          id: m.messageID,
          preview: [m.from ?? "", m.subject ?? ""].join(" ").trim(),
        }));
    },

    // Fetches the full message HTML by ID.
    async readMessage(id) {
      return (
        await post("/message-list", { email: address, messageID: id })
      ).text();
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
    logger.info(`[${TAG}] Acquiring session...`);
    const session = await acquireSession();

    logger.info(`[${TAG}] Generating GoogleMail address...`);
    const res = await fetch(`${BASE_URL}/generate-email`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ email: ["dotGmail"] }), // ["googleMail", "dotGmail", "plusGmail", "domain"]
    });

    if (!res.ok) throw new Error(`[${TAG}] generate-email → ${res.status}`);

    const data = await res.json();
    const address = Array.isArray(data?.email) ? data.email[0] : null;
    if (!address)
      throw new Error(`[${TAG}] No address returned from generate-email.`);

    page._emailnatorCredential = { address, ...session };

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, FAST),
};
