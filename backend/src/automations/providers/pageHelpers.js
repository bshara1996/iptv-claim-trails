/**
 * Shared helpers for browser-based email providers.
 *
 * Exports:
 *   readEmailFromBody(page) – last-resort body scan for an email-shaped string
 */

// Scans the full page body text for the first email-shaped string.
// Used as a last resort when provider-specific selectors all fail.
export async function readEmailFromBody(page) {
  try {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const m = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m) return m[0];
  } catch (_) {}
  return null;
}
