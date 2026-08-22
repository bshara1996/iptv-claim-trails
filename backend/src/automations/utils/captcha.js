/**
 * Shared reCAPTCHA handler.
 *
 * Polls `textarea#g-recaptcha-response` for a token — this covers both image
 * and audio challenges without needing to detect which type is active.
 * Waits indefinitely (no timeout), re-resolves the anchor frame each cycle so
 * stale references after a reset never cause a missed solve, and re-clicks the
 * checkbox automatically if reCAPTCHA expires while the user is away.
 *
 * Usage:
 *   import { solveAndSubmit } from "../utils/captcha.js";
 *   await solveAndSubmit(page, { submitSelectors: ['button[type="submit"]'], log, tag: "MyService" });
 */

import { findVisible } from "./pageUtils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Polls every 500 ms until the reCAPTCHA response token is present.
// Re-resolves the anchor frame and re-clicks the checkbox each cycle to survive
// token expiry and widget resets while the user is away.
async function waitForToken(page, log, tag) {
  let lastCheckedState = false;

  while (true) {
    const tokenPresent = await page
      .evaluate(() => {
        const ta = document.querySelector("textarea#g-recaptcha-response");
        return !!(ta && ta.value.length > 0);
      })
      .catch(() => false);

    if (tokenPresent) return;

    // Re-resolve each cycle — frame refs go stale after a reCAPTCHA reset
    const anchorFrame = page
      .frames()
      .find((f) => f.url().includes("google.com/recaptcha/api2/anchor"));

    if (anchorFrame) {
      const isChecked = await anchorFrame
        .evaluate(() => {
          const anchor = document.querySelector("#recaptcha-anchor");
          return anchor?.getAttribute("aria-checked") === "true";
        })
        .catch(() => false);

      // Log only on state change to avoid spam
      if (!isChecked && lastCheckedState)
        log(`[${tag}] reCAPTCHA reset detected — re-clicking checkbox...`);

      if (!isChecked) {
        const checkbox = await anchorFrame
          .$("#recaptcha-anchor")
          .catch(() => null);
        // dispatchEvent avoids Playwright scrolling the page while the challenge is open
        if (checkbox) await checkbox.dispatchEvent("click").catch(() => {});
      }

      lastCheckedState = isChecked;
    }

    await page.waitForTimeout(500);
  }
}

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Clicks the reCAPTCHA checkbox, waits for the challenge to be solved,
 * then clicks the submit button.
 */
export async function solveAndSubmit(
  page,
  { submitSelectors, log = () => {}, tag = "CAPTCHA" } = {},
) {
  // 1. Wait for the reCAPTCHA anchor frame to appear — it may load after the page
  const anchorFrame = await (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const frame = page
        .frames()
        .find((f) => f.url().includes("google.com/recaptcha/api2/anchor"));
      if (frame) return frame;
      await page.waitForTimeout(300);
    }
    return null;
  })();

  if (!anchorFrame) {
    log(`[${tag}] No reCAPTCHA frame found — skipping CAPTCHA step.`);
    return;
  }

  const checkbox = await anchorFrame
    .waitForSelector("#recaptcha-anchor", { timeout: 10_000, state: "visible" })
    .catch(() => null);

  if (!checkbox) {
    log(`[${tag}] reCAPTCHA checkbox not found — skipping CAPTCHA step.`);
    return;
  }

  // 2. Click the checkbox — dispatch the click directly to avoid Playwright
  // scrolling the page into position, which would interfere with manual solving
  await checkbox.dispatchEvent("click");
  log(
    `[${tag}] reCAPTCHA checkbox clicked — waiting for CAPTCHA to be solved...`,
  );

  // 3. Wait for the token — indefinitely, surviving resets
  await waitForToken(page, log, tag);
  log(`[${tag}] CAPTCHA solved — locating submit button...`);

  // 4. Click the submit button — retry up to 5 times with a short gap
  // because the button can be briefly non-interactive right after the CAPTCHA callback
  let clicked = false;
  for (let i = 0; i < 5; i++) {
    const submitBtn = await findVisible(page, submitSelectors);
    if (submitBtn) {
      await submitBtn.click().catch(() => {});
      log(`[${tag}] Submit button clicked.`);
      clicked = true;
      break;
    }
    await page.waitForTimeout(300);
  }

  if (!clicked) {
    log(
      `[${tag}] Submit button not found via selectors — pressing Enter as fallback.`,
    );
    await page.keyboard.press("Enter");
  }
}
