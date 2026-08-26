/**
 * TMaily disposable email provider.
 *
 * Opens tmaily.com, waits for a temporary email address to be generated,
 * then exposes inbox polling via the shared browser poller helpers.
 * Swapping providers only requires updating the import in registry.js.
 */
import {
  createBrowserProvider,
  readEmailFromBody,
} from "./base/browserProvider.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  url: "https://tmaily.com/",

  selectors: {
    // Ordered from most specific to most generic — first match wins.
    emailCandidates: [
      "#email-address",
      "#email",
      "#temp-email",
      "#mailbox",
      ".email-address",
      ".temp-email",
      ".mailbox-address",
      ".address",
      ".email",
      "input[readonly]",
      'input[type="email"][readonly]',
      "[data-email]",
      "[data-address]",
      '[class*="email"]',
      '[class*="address"]',
      '[id*="email"]',
    ],

    // Visible while the page is still generating the address.
    generatingMarker: ':text("generating")',
  },

  timeouts: {
    pageLoad: 20_000,
    addressPoll: 10_000,
    pollInterval: 800,
  },
};

// ── DOM reader ────────────────────────────────────────────────────────────────

// Tries each candidate selector in order to find the generated address.
// Falls back to a full body scan if all selectors fail.
async function readEmailFromPage(page) {
  for (const sel of CONFIG.selectors.emailCandidates) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const text = (
        (await el.innerText().catch(() => "")) ||
        (await el.inputValue().catch(() => "")) ||
        (await el.getAttribute("data-email").catch(() => ""))
      ).trim();
      if (text) return text;
    } catch (_) {}
  }

  return readEmailFromBody(page);
}

// ── beforePoll hook ───────────────────────────────────────────────────────────

// Waits for the "generating" loading marker to disappear before the address poll loop starts.
async function beforePoll(page) {
  await page
    .waitForSelector(CONFIG.selectors.generatingMarker, {
      state: "hidden",
      timeout: 10_000,
    })
    .catch(() => {}); // marker may not appear at all — that's fine
}

// ── Provider ──────────────────────────────────────────────────────────────────

export default createBrowserProvider(
  {
    id: "tmaily",
    name: "TMaily",
    url: CONFIG.url,
    description: "Disposable temporary email via tmaily.com",
  },
  readEmailFromPage,
  CONFIG.timeouts,
  beforePoll,
);
