/**
 * TMaily disposable email provider (REST API).
 *
 * Uses tmaily.com's web API:
 *   GET /domains                   → Lists active domains
 *   GET /generate?prefix=&domain=  → Generates custom temporary email & TMaily_sid cookie
 *   GET /emails?address=<encoded>  → Polls received messages
 *   GET /message/<id>              → Reads full message content
 */
import logger from "../../logger.js";
import { makeGetReader, createProviderMethods } from "./base/apiProvider.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = "https://tmaily.com";
const TAG = "TMaily";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

/**
 * Optional static domain override (e.g. "10timer.com", "hqpdf.com", "smaau.com").
 * Set to `null` to automatically pick a random domain from https://tmaily.com/domains.
 */
export const STATIC_DOMAIN = null;

const headers = (cookie = "") => ({
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  Referer: `${BASE_URL}/`,
  "sec-ch-ua-platform": '"Windows"',
  "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130"',
  "sec-ch-ua-mobile": "?0",
  ...(cookie ? { Cookie: cookie } : {}),
});

// ── Domain & Prefix Helpers ───────────────────────────────────────────────────

async function getDomain() {
  if (STATIC_DOMAIN) return STATIC_DOMAIN;
  try {
    const res = await fetch(`${BASE_URL}/domains`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      const list = data?.domains || (Array.isArray(data) ? data : []);
      if (list.length) return list[Math.floor(Math.random() * list.length)];
    }
  } catch {}
  return "10timer.com";
}

function generatePrefix() {
  return (
    Math.random().toString(36).substring(2, 9) +
    Math.floor(Math.random() * 900 + 100)
  );
}

// ── Inbox Reader ──────────────────────────────────────────────────────────────

function buildReader({ address, cookie }) {
  const req = (path) =>
    fetch(`${BASE_URL}${path}`, { headers: headers(cookie) });

  return {
    async fetchMessages() {
      const res = await req(
        `/emails?address=${encodeURIComponent(address)}`,
      ).catch(() => null);
      if (!res?.ok) return [];
      const list = await res.json().catch(() => []);
      return (Array.isArray(list) ? list : []).map((m) => ({
        id: m.id,
        preview: [m.sender, m.from, m.subject, m.preview]
          .filter(Boolean)
          .join(" ")
          .trim(),
        subject: m.subject ?? "",
        sender: m.sender || m.from || "",
      }));
    },

    async readMessage(id) {
      try {
        const listRes = await req(
          `/emails?address=${encodeURIComponent(address)}`,
        );
        if (listRes.ok) {
          const list = await listRes.json();
          const item = Array.isArray(list)
            ? list.find((m) => String(m.id) === String(id))
            : null;
          const body =
            item?.html ||
            item?.text ||
            item?.body ||
            item?.content ||
            item?.preview ||
            item?.subject;
          if (body) return body;
        }

        const msgRes = await req(`/message/${encodeURIComponent(id)}`);
        if (msgRes.ok) return await msgRes.text();
      } catch {}
      return "";
    },
  };
}

const getReader = makeGetReader("_tmailyCredential", TAG, buildReader);
const FAST = { pollDelay: 800, readDelay: 300 };

// ── Provider Interface ────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tmaily",
    name: "TMaily",
    url: BASE_URL,
    description: "Disposable temporary email via tmaily.com (API)",
    apiOnly: true,
  },

  async createEmail(page) {
    logger.info(`[${TAG}] Generating disposable email address via API...`);
    const domain = "aiqseo.com"; // await getDomain()
    /*
    "hqpdf.com",
    "2048unblocked.com",
    "watersoftenersystemcost.com",
    "10timer.com",
    "manglgih.com",
    "amgld.com",
    "smaau.com",
    "aiqseo.com"
    */
    const prefix = generatePrefix();

    const res = await fetch(
      `${BASE_URL}/generate?prefix=${encodeURIComponent(prefix)}&domain=${encodeURIComponent(domain)}&force=true`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`[${TAG}] /generate failed: ${res.status}`);

    const data = await res.json();
    const address = data?.address;
    if (!address)
      throw new Error(`[${TAG}] No address returned from /generate.`);

    const match = (res.headers.get("set-cookie") || "").match(
      /TMaily_sid=[^;]+/,
    );
    page._tmailyCredential = { address, cookie: match ? match[0] : "" };

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, FAST),
};

////////////////////////////////////////////////////////////////////////////////////

// /**
//  * TMaily disposable email provider.
//  *
//  * Opens tmaily.com, waits for a temporary email address to be generated,
//  * then exposes inbox polling via the shared browser poller helpers.
//  * Swapping providers only requires updating the import in registry.js.
//  */
// import {
//   createBrowserProvider,
//   readEmailFromBody,
// } from "./base/browserProvider.js";

// // ── Config ────────────────────────────────────────────────────────────────────

// const CONFIG = {
//   url: "https://tmaily.com/",

//   selectors: {
//     // Ordered from most specific to most generic — first match wins.
//     emailCandidates: [
//       "#email-address",
//       "#email",
//       "#temp-email",
//       "#mailbox",
//       ".email-address",
//       ".temp-email",
//       ".mailbox-address",
//       ".address",
//       ".email",
//       "input[readonly]",
//       'input[type="email"][readonly]',
//       "[data-email]",
//       "[data-address]",
//       '[class*="email"]',
//       '[class*="address"]',
//       '[id*="email"]',
//     ],

//     // Visible while the page is still generating the address.
//     generatingMarker: ':text("generating")',
//   },

//   timeouts: {
//     pageLoad: 20_000,
//     addressPoll: 10_000,
//     pollInterval: 800,
//   },
// };

// // ── DOM reader ────────────────────────────────────────────────────────────────

// // Tries each candidate selector in order to find the generated address.
// // Falls back to a full body scan if all selectors fail.
// async function readEmailFromPage(page) {
//   for (const sel of CONFIG.selectors.emailCandidates) {
//     try {
//       const el = await page.$(sel);
//       if (!el) continue;
//       const text = (
//         (await el.innerText().catch(() => "")) ||
//         (await el.inputValue().catch(() => "")) ||
//         (await el.getAttribute("data-email").catch(() => ""))
//       ).trim();
//       if (text) return text;
//     } catch (_) {}
//   }

//   return readEmailFromBody(page);
// }

// // ── beforePoll hook ───────────────────────────────────────────────────────────

// // Waits for the "generating" loading marker to disappear before the address poll loop starts.
// async function beforePoll(page) {
//   await page
//     .waitForSelector(CONFIG.selectors.generatingMarker, {
//       state: "hidden",
//       timeout: 10_000,
//     })
//     .catch(() => {}); // marker may not appear at all — that's fine
// }

// // ── Provider ──────────────────────────────────────────────────────────────────

// export default createBrowserProvider(
//   {
//     id: "tmaily",
//     name: "TMaily",
//     url: CONFIG.url,
//     description: "Disposable temporary email via tmaily.com",
//   },
//   readEmailFromPage,
//   CONFIG.timeouts,
//   beforePoll,
// );
