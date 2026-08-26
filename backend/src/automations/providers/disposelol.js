/**
 * Dispose.lol disposable email provider.
 *
 * Opens dispose.lol, waits for a temporary email address to be generated,
 * then exposes inbox polling via the shared browser poller helpers.
 * Swapping providers only requires updating the import in registry.js.
 */
import {
  createBrowserProvider,
  readEmailFromBody,
} from "./base/browserProvider.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  url: "https://dispose.lol/",

  selectors: {
    // The generated address lives in a <p> inside this aria-live container.
    // The same container shows "Loading" while the address is still being generated.
    addressContainer: '[aria-live="polite"] p',

    // Sentinel text visible while the address is still loading.
    loadingText: "Loading",
  },

  timeouts: {
    pageLoad: 20_000,
    addressPoll: 15_000,
    pollInterval: 800,
  },
};

// ── DOM reader ────────────────────────────────────────────────────────────────

// Reads the address from the aria-live container, skipping it while "Loading" is shown.
// Falls back to a full body scan if the container is missing or still loading.
async function readEmailFromPage(page) {
  try {
    const el = await page.$(CONFIG.selectors.addressContainer);
    if (!el) return null;
    const text = (await el.innerText().catch(() => "")).trim();
    if (
      text &&
      !text.toLowerCase().startsWith(CONFIG.selectors.loadingText.toLowerCase())
    )
      return text;
  } catch (_) {}

  return readEmailFromBody(page);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export default createBrowserProvider(
  {
    id: "disposelol",
    name: "Dispose.lol",
    url: CONFIG.url,
    description: "Disposable temporary email via dispose.lol",
  },
  readEmailFromPage,
  CONFIG.timeouts,
);
