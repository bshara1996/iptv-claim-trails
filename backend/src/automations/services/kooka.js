/**
 * kooka.tv — Free 12-Hour Trial Registration
 *
 * Flow:
 *   1. Navigate to https://kooka.tv/ and click "Start Free 12h Trial — No Card".
 *   2. Fill the registration modal with the temporary email and WhatsApp number.
 *   3. Submit and wait for the credentials section to appear.
 *   4. Extract server, username, password, and backup M3U URL from the page.
 *   5. Build a second M3U link from the primary server credentials.
 *
 * The temporary email is used for registration only — the inbox is never opened.
 */
import {
  generateUsername,
  generatePhone,
  computeTrialExpiry,
} from "../utils/generators.js";
import { fillFirst, clickFirst } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://kooka.tv";
const TAG = "Kooka";
const TRIAL_HOURS = 12;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  // CTA buttons that open the trial modal (multiple placements on the page)
  openModal: [
    '[data-testid="button-hero-trial"]',
    '[data-testid="button-mobile-trial"]',
    '[data-testid="button-how-start-trial"]',
    '[data-testid="button-cta-trial"]',
  ],
  email: '[data-testid="input-trial-email"]',
  whatsapp: '[data-testid="input-trial-whatsapp"]',
  submit: '[data-testid="button-trial-submit"]',
  server: '[data-testid="text-primary-server"]',
  username: '[data-testid="text-primary-username"]',
  passwordToggle: '[data-testid="button-toggle-primary-password"]',
  password: '[data-testid="text-primary-password"]',
  // Kooka labels this field "M3U URL (backup)"
  backupM3u: '[data-testid="text-backup-m3u"]',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const readText = (page, sel) =>
  page.$eval(sel, (el) => el.textContent?.trim() || null).catch(() => null);

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "kooka",
    name: "Kooka.TV",
    url: BASE_URL,
    description:
      "kooka.tv 12-hour free trial — registration + M3U extraction from website",
  },

  async execute({ page, email, log = () => {} }) {
    const whatsapp = generatePhone();
    const resolvedEmail = email ?? `${generateUsername()}@gmail.com`;

    // Step 1: Open the trial modal
    await page.goto(BASE_URL, GOTO_OPTS).catch(() => {});
    await page.waitForTimeout(2_000); // wait for React to hydrate

    await clickFirst(page, SELECTORS.openModal);
    await page
      .waitForSelector('[data-testid="modal-trial-signup"]', {
        state: "visible",
        timeout: 10_000,
      })
      .catch(() => {});

    // Step 2: Fill and submit the registration form
    await fillFirst(page, SELECTORS.email, resolvedEmail);
    await fillFirst(page, SELECTORS.whatsapp, whatsapp);
    await clickFirst(page, SELECTORS.submit);
    log(`[${TAG}] Registration submitted.`);

    // Step 3: Wait for the credentials section
    await page
      .waitForSelector('[data-testid="section-step-credentials"]', {
        state: "visible",
        timeout: 30_000,
      })
      .catch(() => {});

    // Step 4: Extract primary server credentials
    const server = await readText(page, SELECTORS.server);
    const username = await readText(page, SELECTORS.username);

    // Password is masked by default — reveal it before reading
    await clickFirst(page, SELECTORS.passwordToggle);
    const password = await readText(page, SELECTORS.password);

    // Step 5: Extract backup M3U and build a second link from credentials
    // textContent decodes HTML entities (e.g. &amp; → &) automatically
    const backupM3u = await readText(page, SELECTORS.backupM3u);

    const builtM3u =
      server && username && password
        ? `${server}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`
        : null;

    const allM3uLinks = [backupM3u, builtM3u].filter(Boolean);

    if (backupM3u) log(`[${TAG}] ✅ M3U extracted: ${backupM3u}`);
    if (builtM3u) log(`[${TAG}] ✅ M3U built: ${builtM3u}`);
    if (!allM3uLinks.length)
      log(`[${TAG}] M3U link not found on credentials page.`, "warn");

    return {
      username,
      password,
      // kooka provides two M3U links; join them so both are stored in tvPlaylist
      tvPlaylist: allM3uLinks.join("\n") || null,
      vodPlaylist: null,
      allM3uLinks,
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: allM3uLinks.length
        ? "kooka.tv 12-hour trial activated successfully."
        : "Registration submitted — M3U link not found on credentials page.",
    };
  },
};
