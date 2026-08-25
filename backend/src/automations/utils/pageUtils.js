/**
 * Shared Playwright page helpers used across services and providers.
 *
 * Exports:
 *   findVisible(page, selectors)          – first visible element from a selector list
 *   clickFirst(page, selectors)           – click the first visible element
 *   fillFirst(page, selectors, value)     – fill the first visible element
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

// Fills the first visible element. Falls back to simulated typing if fill() is rejected.
export async function fillFirst(page, selectors, value) {
  const el = await findVisible(page, selectors);
  if (!el) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.fill(value).catch(async () => {
    await el.click();
    await el.type(value, { delay: 40 });
  });
  return true;
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
