/**
 * kooka.tv — Free 12-Hour Trial Registration (API-based)
 *
 * Flow:
 *   1. Generates browser fingerprint hash (SHA-256) and visitor UUID.
 *   2. Directly calls POST https://kooka.tv/api/trial/signup with credentials.
 *   3. Extracts primary username, password, server, expiry, and direct M3U URL.
 *   4. Deterministically constructs the Xtream Codes backup playlist URL.
 */
import crypto from "crypto";
import {
  generateUsername,
  generatePhone,
  computeTrialExpiry,
} from "../utils/generators.js";

const BASE_URL = "https://kooka.tv";
const TAG = "Kooka";
const TRIAL_HOURS = 12;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export default {
  meta: {
    id: "kooka",
    name: "Kooka.TV",
    url: BASE_URL,
    description: "12 Hours",
  },

  async execute({ page, email, log = () => {} }) {
    if (page?.close) await page.close().catch(() => {});

    const resolvedEmail = email ?? `${generateUsername()}@gmail.com`;
    const whatsapp = generatePhone();
    const fpComponents = {
      tzOffset: "0",
      screen: "1920x1080x24",
      hwConcurrency: "8",
      platform: "Win32",
    };
    const fingerprintHash = crypto
      .createHash("sha256")
      .update(`${UA}|en-US|0|1920x1080x24|8|Win32`)
      .digest("hex");

    log(
      `[${TAG}] Submitting trial registration via API for ${resolvedEmail}...`,
    );

    const res = await fetch(`${BASE_URL}/api/trial/signup`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
      body: JSON.stringify({
        email: resolvedEmail,
        whatsappNumber: whatsapp,
        fingerprintHash,
        visitorId: crypto.randomUUID(),
        allowDuplicate: false,
        fpComponents,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.trial) {
      throw new Error(
        `Registration failed: ${data.displayMessage || data.reason || `HTTP ${res.status}`}`,
      );
    }

    const {
      username,
      password,
      primaryServer = BASE_URL,
      m3uUrl,
      expiresAt,
    } = data.trial;
    const builtM3u =
      username && password
        ? `${primaryServer}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`
        : null;
    const allM3uLinks = [m3uUrl, builtM3u].filter(Boolean);

    if (m3uUrl) log(`[${TAG}] ✅ M3U URL: ${m3uUrl}`);
    if (builtM3u) log(`[${TAG}] ✅ M3U Built: ${builtM3u}`);

    return {
      username: username || null,
      password: password || null,
      tvPlaylist: allM3uLinks.join("\n") || null,
      vodPlaylist: null,
      allM3uLinks,
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: expiresAt || computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: allM3uLinks.length
        ? "kooka.tv 12-hour trial activated successfully."
        : "Trial registered via API.",
    };
  },
};

///////////////////////////////////////////////////////////////////////

// /**
//  * kooka.tv — Free 12-Hour Trial Registration
//  *
//  * Flow:
//  *   1. Navigate to https://kooka.tv/ and click "Start Free 12h Trial — No Card".
//  *   2. Fill the registration modal with the temporary email and WhatsApp number.
//  *   3. Submit and wait for the credentials section to appear.
//  *   4. Extract server, username, password, and backup M3U URL from the page.
//  *   5. Build a second M3U link from the primary server credentials.
//  *
//  * The temporary email is used for registration only — the inbox is never opened.
//  */
// import {
//   generateUsername,
//   generatePhone,
//   computeTrialExpiry,
// } from "../utils/generators.js";
// import { fillInstant, clickFirst } from "../utils/pageUtils.js";

// // ── Config ────────────────────────────────────────────────────────────────────

// const BASE_URL = "https://kooka.tv";
// const TAG = "Kooka";
// const TRIAL_HOURS = 12;
// const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// // ── Selectors ─────────────────────────────────────────────────────────────────

// const SELECTORS = {
//   // CTA buttons that open the trial modal (multiple placements on the page)
//   openModal: [
//     '[data-testid="button-hero-trial"]',
//     '[data-testid="button-mobile-trial"]',
//     '[data-testid="button-how-start-trial"]',
//     '[data-testid="button-cta-trial"]',
//   ],
//   email: '[data-testid="input-trial-email"]',
//   whatsapp: '[data-testid="input-trial-whatsapp"]',
//   submit: '[data-testid="button-trial-submit"]',
//   server: '[data-testid="text-primary-server"]',
//   username: '[data-testid="text-primary-username"]',
//   passwordToggle: '[data-testid="button-toggle-primary-password"]',
//   password: '[data-testid="text-primary-password"]',
//   // Kooka labels this field "M3U URL (backup)"
//   backupM3u: '[data-testid="text-backup-m3u"]',
// };

// // ── Helpers ───────────────────────────────────────────────────────────────────

// const readText = (page, sel) =>
//   page.$eval(sel, (el) => el.textContent?.trim() || null).catch(() => null);

// // ── Service ───────────────────────────────────────────────────────────────────

// export default {
//   meta: {
//     id: "kooka",
//     name: "Kooka.TV",
//     url: BASE_URL,
//     description: "12 Hours",
//   },

//   async execute({ page, email, log = () => {} }) {
//     const whatsapp = generatePhone();
//     const resolvedEmail = email ?? `${generateUsername()}@gmail.com`;

//     // Step 1: Open the trial modal
//     await page.goto(BASE_URL, GOTO_OPTS).catch(() => {});
//     await page.waitForTimeout(2_000); // wait for React to hydrate

//     await clickFirst(page, SELECTORS.openModal);
//     await page
//       .waitForSelector('[data-testid="modal-trial-signup"]', {
//         state: "visible",
//         timeout: 10_000,
//       })
//       .catch(() => {});

//     // Step 2: Fill and submit the registration form
//     await fillInstant(page, {
//       [SELECTORS.email]: resolvedEmail,
//       [SELECTORS.whatsapp]: whatsapp,
//     });
//     await clickFirst(page, SELECTORS.submit);
//     log(`[${TAG}] Registration submitted.`);

//     // Step 3: Wait for the credentials section
//     await page
//       .waitForSelector('[data-testid="section-step-credentials"]', {
//         state: "visible",
//         timeout: 30_000,
//       })
//       .catch(() => {});

//     // Step 4: Extract primary server credentials
//     const server = await readText(page, SELECTORS.server);
//     const username = await readText(page, SELECTORS.username);

//     // Password is masked by default — reveal it before reading
//     await clickFirst(page, SELECTORS.passwordToggle);
//     const password = await readText(page, SELECTORS.password);

//     // Step 5: Extract backup M3U and build a second link from credentials
//     // textContent decodes HTML entities (e.g. &amp; → &) automatically
//     const backupM3u = await readText(page, SELECTORS.backupM3u);

//     const builtM3u =
//       server && username && password
//         ? `${server}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`
//         : null;

//     const allM3uLinks = [backupM3u, builtM3u].filter(Boolean);

//     if (backupM3u) log(`[${TAG}] ✅ M3U extracted: ${backupM3u}`);
//     if (builtM3u) log(`[${TAG}] ✅ M3U built: ${builtM3u}`);
//     if (!allM3uLinks.length)
//       log(`[${TAG}] M3U link not found on credentials page.`, "warn");

//     return {
//       username,
//       password,
//       // kooka provides two M3U links; join them so both are stored in tvPlaylist
//       tvPlaylist: allM3uLinks.join("\n") || null,
//       vodPlaylist: null,
//       allM3uLinks,
//       duration: `${TRIAL_HOURS} Hours`,
//       expiresAt: computeTrialExpiry(TRIAL_HOURS),
//       status: "success",
//       note: allM3uLinks.length
//         ? "kooka.tv 12-hour trial activated successfully."
//         : "Registration submitted — M3U link not found on credentials page.",
//     };
//   },
// };
