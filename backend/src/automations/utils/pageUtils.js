/**
 * Shared Playwright page helpers used across services and providers.
 *
 * Exports:
 *   findVisible(page, selectors)          – first visible element from a selector list
 *   clickFirst(page, selectors)           – click the first visible element
 *   fillInstant(page, fields)             – instantly fill multiple fields via native setter (kcccam-style)
 *   extractM3u(page)                      – extract an M3U get.php URL from page text
 */

// Returns the first visible element matching any selector in the array, or null.
export async function findVisible(page, selectors) {
  const list = Array.isArray(selectors)
    ? selectors
    : selectors.split(", ").map((s) => s.trim());
  for (const sel of list) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

// Clicks the first visible element matching any selector. Returns true if clicked.
export async function clickFirst(page, selectors) {
  const el = await findVisible(page, selectors);
  if (el) {
    await el.click();
    return true;
  }
  return false;
}

// Instantly fills one or more fields in a single page.evaluate() call using the
// native HTMLInputElement setter so React/Vue framework listeners fire correctly.
// Accepts a plain object of { selector: value } pairs — all fields are filled
// in one synchronous DOM batch with no typing delay.
export async function fillInstant(page, fields) {
  await page.evaluate((entries) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    const dispatch = (el, val) => {
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (const [sel, val] of entries) {
      const el = document.querySelector(sel);
      if (el) dispatch(el, val);
    }
  }, Object.entries(fields));
}

// Scans the page text for an M3U get.php URL and returns it, or null if not found.
export async function extractM3u(page) {
  const text = await page
    .evaluate(() => document.body?.innerText ?? "")
    .catch(() => "");
  const match = text.match(
    /https?:\/\/[^\s]+\/get\.php\?[^\s]+type=m3u[^\s]*/i,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}
