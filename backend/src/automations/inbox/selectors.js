/**
 * Inbox CSS selectors for browser-based temporary email providers.
 *
 * Listed from most specific to most generic so the first match always wins.
 * Add provider-specific selectors before the generic fallbacks.
 */

export const INBOX_SELECTORS = {
  messageRow: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    'section[aria-labelledby="inbox-heading"] button[aria-label^="View "]',
    'button[aria-label^="View "]',
    'section[aria-labelledby="inbox-heading"] button:has(time)',
    'section[aria-labelledby="inbox-heading"] button',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    "#email-list .email-item",
    "#email-list > div:not(.empty-state)",
    ".email-list .email-item",

    // ── Generic fallbacks ─────────────────────────────────────────────────────
    "#inbox .message",
    ".inbox-item",
    ".mail-item",
    ".message-item",
    "[data-id]",
    "[data-email-id]",
    "[data-message-id]",
    '[class*="email-item"]',
    '[class*="inbox-item"]',
  ].join(", "),

  refreshBtn: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    'section[aria-labelledby="inbox-heading"] button:has-text("Refresh")',
    "#inbox-heading + button",
    'button:has-text("Refresh")',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    "#refresh-btn",
    ".refresh-btn",

    // ── Generic fallbacks ─────────────────────────────────────────────────────
    "[data-refresh]",
    '[aria-label*="refresh" i]',
  ].join(", "),

  backToInbox: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    'button[aria-label="Close message detail"]',
    'button[aria-label*="Close" i]',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    'a:has-text("Back to Inbox")',
    "#back-to-inbox",
    ".back-to-inbox",

    // ── Generic fallbacks ─────────────────────────────────────────────────────
    'button:has-text("Back")',
    'a:has-text("Back")',
    'button:has-text("Inbox")',
    ".back",
    'a[href="/"]',
    '[aria-label*="back" i]',
  ].join(", "),
};
