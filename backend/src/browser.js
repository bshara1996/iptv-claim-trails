import { chromium } from "playwright";
import logger from "./logger.js";

let browser = null;
let currentBrowserHeadless = null;
let activeSessions = 0;
const openContexts = new Set();

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_BROWSERS || "5", 10);

async function getBrowser(headlessMode) {
  const isHeadless =
    typeof headlessMode === "boolean"
      ? headlessMode
      : process.env.HEADLESS === "true";

  if (
    browser &&
    browser.isConnected() &&
    currentBrowserHeadless !== isHeadless
  ) {
    logger.info(
      `Switching browser mode (was headless=${currentBrowserHeadless}, now headless=${isHeadless})...`,
    );
    for (const ctx of openContexts) {
      await ctx.close().catch(() => {});
    }
    openContexts.clear();
    activeSessions = 0;
    try {
      await browser.close();
    } catch (_) {}
    browser = null;
    currentBrowserHeadless = null;
  }

  if (!browser || !browser.isConnected()) {
    logger.info(`Launching browser (headless=${isHeadless})...`);
    browser = await chromium.launch({
      headless: isHeadless,
      slowMo: isHeadless ? 0 : 250,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--start-maximized",
        "--no-viewport",
      ],
    });
    currentBrowserHeadless = isHeadless;

    browser.on("disconnected", () => {
      logger.warn("Browser disconnected — resetting session counter.");
      browser = null;
      currentBrowserHeadless = null;
      openContexts.clear();
      activeSessions = 0;
    });
  }
  return browser;
}

export async function createContext({ headless } = {}) {
  const isHeadless =
    typeof headless === "boolean" ? headless : process.env.HEADLESS === "true";

  // Clean up contexts whose pages were all closed manually
  for (const ctx of [...openContexts]) {
    try {
      if (ctx.pages().length === 0) {
        openContexts.delete(ctx);
        activeSessions = Math.max(0, activeSessions - 1);
      }
    } catch (_) {
      openContexts.delete(ctx);
      activeSessions = Math.max(0, activeSessions - 1);
    }
  }

  // Recycle oldest context if at the concurrency limit
  if (activeSessions >= MAX_CONCURRENT) {
    const oldest = openContexts.values().next().value;
    if (oldest) {
      logger.info(
        "Auto-recycling oldest browser context to make room for new task...",
      );
      await closeContext(oldest).catch(() => {});
    }
  }

  const b = await getBrowser(isHeadless);
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: isHeadless ? { width: 1280, height: 720 } : null,
    locale: "en-US",
  });

  activeSessions++;
  openContexts.add(context);
  logger.info(`Browser context created (active sessions: ${activeSessions})`);
  return context;
}

export async function closeContext(context) {
  if (!context) return;
  openContexts.delete(context);
  activeSessions = Math.max(0, activeSessions - 1);
  try {
    await context.close();
  } catch (e) {
    logger.warn(`Notice closing context: ${e.message}`);
  }
  logger.info(`Browser context closed (active sessions: ${activeSessions})`);
}

export async function forceCloseAllContexts() {
  logger.info(
    `[Browser] Force-closing all ${openContexts.size} open contexts...`,
  );
  for (const ctx of openContexts) {
    await ctx.close().catch(() => {});
  }
  openContexts.clear();
  activeSessions = 0;
  logger.info("[Browser] All sessions cleared. Ready for new tasks.");
}

export function getActiveSessions() {
  return activeSessions;
}
