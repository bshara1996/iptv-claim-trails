/**
 * Shared reCAPTCHA handler.
 *
 * Works for image and audio challenges: both flows ultimately populate
 * `textarea#g-recaptcha-response` with the token, so polling that single
 * element covers every CAPTCHA variant without needing challenge-type detection.
 *
 * The handler waits indefinitely with no timeout ceiling. It polls every 500 ms
 * and resolves the instant the token is present. The submit button is clicked
 * immediately after — no delay, no extra condition, no polling cycle.
 *
 * Handles the case where the user leaves the browser and returns later:
 * - reCAPTCHA tokens expire (~2 min) and the widget may reset entirely.
 * - Frame references go stale after a reset — we re-resolve the anchor frame
 *   on every poll iteration so a reset never causes a missed solve.
 * - If the checkbox needs to be re-clicked after a reset, we do so automatically.
 *
 * Usage:
 *   import { solveAndSubmit } from "../captcha.js";
 *
 *   await solveAndSubmit(page, {
 *     submitSelectors: ['button[name="submit"][type="submit"]', 'button[type="submit"]'],
 *     log,
 *     tag: "MyService",
 *   });
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the first visible element matching any of the given selectors, or null.
 */
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

/**
 * Resolves when textarea#g-recaptcha-response on the host page contains a
 * non-empty token. Polls every 500 ms with no timeout ceiling.
 *
 * On each iteration we also re-check the anchor frame to ensure the checkbox
 * stays clicked — if reCAPTCHA resets (e.g. token expired while user was away)
 * the checkbox goes back to unchecked and needs to be clicked again.
 */
async function waitForToken(page, log, tag) {
  let lastCheckedState = false; // tracks whether we clicked the checkbox

  while (true) {
    // ── Check if the token is already present ─────────────────────────────────
    // This is the completion signal for both image and audio CAPTCHA.
    const tokenPresent = await page
      .evaluate(() => {
        const ta = document.querySelector("textarea#g-recaptcha-response");
        return !!(ta && ta.value.length > 0);
      })
      .catch(() => false);

    if (tokenPresent) return; // solved — return immediately

    // ── Re-resolve the anchor frame on every iteration ────────────────────────
    // Frame references become stale if reCAPTCHA resets. Re-finding it every
    // cycle means a reset never causes us to miss the checkbox state.
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

      // If the checkbox is unchecked (initial state or after a reset/expiry),
      // click it. We only log when the state changes to avoid log spam.
      if (!isChecked && lastCheckedState) {
        log(`[${tag}] reCAPTCHA reset detected — re-clicking checkbox...`);
      }
      if (!isChecked) {
        const checkbox = await anchorFrame
          .$("#recaptcha-anchor")
          .catch(() => null);
        if (checkbox) await checkbox.click().catch(() => {});
      }

      lastCheckedState = isChecked;
    }

    await page.waitForTimeout(500);
  }
}

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Clicks the reCAPTCHA checkbox, waits indefinitely for the challenge to be
 * fully solved (token populated), then immediately locates and clicks the
 * submit button.
 *
 * @param {import('playwright').Page} page
 * @param {{
 *   submitSelectors: string[],
 *   log?: (msg: string) => void,
 *   tag?: string,
 * }} options
 */
export async function solveAndSubmit(
  page,
  { submitSelectors, log = () => {}, tag = "CAPTCHA" } = {},
) {
  // ── 1. Locate the reCAPTCHA anchor frame ────────────────────────────────────
  const anchorFrame = page
    .frames()
    .find((f) => f.url().includes("google.com/recaptcha/api2/anchor"));

  if (!anchorFrame) {
    log(`[${tag}] No reCAPTCHA frame found — skipping CAPTCHA step.`);
    return;
  }

  const checkbox = await anchorFrame
    .waitForSelector("#recaptcha-anchor", { timeout: 5_000 })
    .catch(() => null);

  if (!checkbox) {
    log(`[${tag}] reCAPTCHA checkbox not found — skipping CAPTCHA step.`);
    return;
  }

  // ── 2. Click the checkbox ───────────────────────────────────────────────────
  await checkbox.click();
  log(
    `[${tag}] reCAPTCHA checkbox clicked — waiting for CAPTCHA to be solved...`,
  );

  // ── 3. Wait for the token — indefinitely, surviving resets ──────────────────
  //
  // waitForToken polls every 500 ms with no timeout. On each cycle it:
  //   a) checks if the response token is present → returns immediately if so
  //   b) re-resolves the anchor frame (stale after a reset)
  //   c) re-clicks the checkbox if reCAPTCHA reset while the user was away
  //
  // This means it doesn't matter how long the user takes — even if they leave
  // the browser for an extended period and the CAPTCHA expires and resets,
  // the next time they solve it the token will be detected and we continue.
  await waitForToken(page, log, tag);
  log(`[${tag}] CAPTCHA solved — locating submit button...`);

  // ── 4. Immediately click the submit button ──────────────────────────────────
  //
  // We attempt the click up to 5 times with a 300 ms gap. The button can be
  // briefly non-interactive immediately after CAPTCHA completes (e.g. the page
  // runs its own validation callback), so a single attempt can miss a narrow
  // window. Five fast retries cover that without adding noticeable delay.
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
