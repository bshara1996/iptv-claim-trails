/**
 * Y6TV free trial registration service (API-based).
 *
 * Submits registration directly via HTTP POST to the backend endpoint,
 * bypassing browser navigation and CAPTCHA solving, then polls the inbox
 * for a confirmation email containing the M3U playlist links.
 * Trial duration is 3 days (72 hours).
 */
import { computeTrialExpiry } from "../utils/generators.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://rg.y6tv.me/regfm.php?devTypeID=100";
const TAG = "Y6TV";
const TRIAL_HOURS = 72;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Submits registration request directly to Y6TV endpoint.
 */
async function submitRegistrationApi(email, log) {
  log(`[${TAG}] Submitting registration via API for ${email}...`);

  const body = new URLSearchParams({
    step: "2",
    email: email,
    isNeedLoginAutogen: "on",
    regBtn: "Зарегистрировать",
  });

  const res = await fetch(TRIAL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: TRIAL_URL,
      Origin: "https://rg.y6tv.me",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const baseSrcMatch = html.match(
    /setAttribute\s*\(\s*["']src["']\s*,\s*["']([^"']+)["']\s*\+\s*addPar\s*\)/i,
  );
  const addParMatch = html.match(/addPar\s*=\s*['"]([^'"]+)['"]/);

  let scriptUrl = null;
  if (baseSrcMatch && addParMatch) {
    scriptUrl = baseSrcMatch[1] + addParMatch[1];
  } else {
    const directMatch = html.match(/src\s*=\s*["']([^"']+)["']/i);
    if (directMatch) scriptUrl = directMatch[1];
  }

  if (scriptUrl) {
    if (!scriptUrl.startsWith("http")) scriptUrl = `https:${scriptUrl}`;
    try {
      const scriptRes = await fetch(scriptUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: "https://rg.y6tv.me/",
        },
        signal: AbortSignal.timeout(10_000),
      });
      const scriptText = await scriptRes.text();
      const errMatch = scriptText.match(
        /class=['"]regFormErrInf['"][^>]*>([^<]+)/i,
      );
      if (errMatch && errMatch[1]) {
        const msg = errMatch[1].trim();
        if (msg && !msg.includes("Поздравляем") && !msg.includes("успешно")) {
          throw new Error(`Registration rejected: ${msg}`);
        }
      }
    } catch (err) {
      if (err.message?.startsWith("Registration rejected")) throw err;
      log(
        `[${TAG}] Warning: Could not verify response script: ${err.message}`,
        "warn",
      );
    }
  }

  log(`[${TAG}] Registration submitted successfully via API.`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "y6tv",
    name: "Y6TV",
    url: TRIAL_URL,
    description: "3 Days",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // If a browser page was opened for this service, close it to free up resources
    if (page && typeof page.close === "function") {
      await page.close().catch(() => {});
    }

    // Step 1: Submit registration via API
    await submitRegistrationApi(email, log);

    // Step 2: Poll the inbox for the confirmation email with M3U links
    if (emailPage && typeof emailPage.bringToFront === "function") {
      await emailPage.bringToFront().catch(() => {});
    }

    const playlists = await provider.waitForEmailAndExtractPlaylists(
      emailPage,
      {
        filterText: "y6tv",
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (playlists.allM3uLinks.length === 0)
      log(`[${TAG}] No M3U links found in confirmation email.`, "warn");
    else
      log(
        `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    // Step 3: Build and return the result
    return {
      username: null,
      password: null,
      email,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks ?? [],
      duration: playlists.duration ?? `${TRIAL_HOURS / 24} Days`,
      expiresAt: playlists.expiresAt ?? computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: playlists.tvPlaylist
        ? "M3U playlist links extracted from confirmation email."
        : "Registered via API — no playlist links found in confirmation email.",
    };
  },
};

// //////////////////////////

// /**
//  * Y6TV free trial registration service.
//  *
//  * Navigates to the registration page with the email pre-filled via URL
//  * query parameter, solves the reCAPTCHA, then polls the inbox for a
//  * confirmation email containing the M3U playlist links. Trial duration
//  * is 3 days (72 hours).
//  */
// import { solveAndSubmit } from "../utils/captcha.js";
// import { computeTrialExpiry } from "../utils/generators.js";

// // ── Config ────────────────────────────────────────────────────────────────────

// const TRIAL_BASE_URL = "https://rg.y6tv.me/regfm.php?devTypeID=100&email=";
// const TAG = "Y6TV";
// const TRIAL_HOURS = 72;
// const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 10_000 };

// // ── Selectors ─────────────────────────────────────────────────────────────────

// const SELECTORS = {
//   submit: "#regBtn",
//   error: ".regFormErrInf",
// };

// // ── Helpers ───────────────────────────────────────────────────────────────────

// // Navigates to the registration page with email pre-filled via URL param,
// // solves the CAPTCHA, submits the form, and throws if the server returns
// // a validation error.
// async function submitRegistration(page, email, log) {
//   await page
//     .goto(`${TRIAL_BASE_URL}${encodeURIComponent(email)}`, GOTO_OPTS)
//     .catch(() =>
//       log(`[${TAG}] Page load timeout — proceeding with current DOM.`, "warn"),
//     );

//   // Start waiting for navigation BEFORE the submit click so we don't miss it.
//   const navPromise = page.waitForNavigation(GOTO_OPTS).catch(() => {});

//   await solveAndSubmit(page, {
//     submitSelectors: SELECTORS.submit,
//     log,
//     tag: TAG,
//   });
//   await navPromise;

//   const errorText = await page
//     .evaluate(
//       (sel) => document.querySelector(sel)?.innerText?.trim() ?? null,
//       SELECTORS.error,
//     )
//     .catch(() => null);

//   if (errorText) throw new Error(`Registration rejected: ${errorText}`);

//   log(`[${TAG}] Registration submitted successfully.`);
// }

// // ── Service ───────────────────────────────────────────────────────────────────

// export default {
//   meta: {
//     id: "y6tv",
//     name: "Y6TV",
//     url: TRIAL_BASE_URL,
//     description: "24 Hours",
//   },

//   async execute({
//     page,
//     emailPage,
//     provider,
//     email,
//     inboxSeenIds = new Set(),
//     log = () => {},
//   }) {
//     // Step 1: Submit the registration form (email pre-filled via URL)
//     await submitRegistration(page, email, log);

//     // Step 2: Poll the inbox for the confirmation email with M3U links
//     await emailPage.bringToFront().catch(() => {});

//     const playlists = await provider.waitForEmailAndExtractPlaylists(
//       emailPage,
//       {
//         filterText: "y6tv",
//         seenIds: new Set(inboxSeenIds),
//         timeout: 120_000,
//       },
//     );

//     if (playlists.allM3uLinks.length === 0)
//       log(`[${TAG}] No M3U links found in confirmation email.`, "warn");
//     else
//       log(
//         `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
//       );

//     // Step 3: Build and return the result
//     return {
//       username: null,
//       password: null,
//       email,
//       tvPlaylist: playlists.tvPlaylist ?? null,
//       vodPlaylist: playlists.vodPlaylist ?? null,
//       allM3uLinks: playlists.allM3uLinks ?? [],
//       duration: playlists.duration ?? `${TRIAL_HOURS / 24} Days`,
//       expiresAt: playlists.expiresAt ?? computeTrialExpiry(TRIAL_HOURS),
//       status: "success",
//       note: playlists.tvPlaylist
//         ? "M3U playlist links extracted from confirmation email."
//         : "Registered — no playlist links found in confirmation email.",
//     };
//   },
// };
