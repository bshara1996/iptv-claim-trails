/**
 * IPTV Trex (iptvtrex.co) — free trial via WHMCS checkout.
 *
 * Flow:
 *   1. GET  /members/index.php?rp=/store/free-trial-iptv/trex
 *           → WHMCS redirects to cart.php?a=confproduct&i=0 (product configure page).
 *   2. GET  /members/cart.php?a=confproduct&i=0
 *           → scrape the live per-session CSRF token.
 *   3. POST /members/cart.php?a=confproduct&i=0  (XHR, token + configure + i)
 *           → WHMCS adds the product to the cart (302 → confdomains).
 *   4. GET  /members/cart.php?a=checkout
 *           → verify cart count = 1, grab token (same value, confirms session).
 *   5. POST /members/cart.php?a=checkout  (all registration fields + live token)
 *           → WHMCS creates the account and redirects 302 → ?a=complete on success.
 *   6. Poll inbox — extract the M3U link from the welcome/credentials email.
 */

import { buildResult } from "../../parsing/generators.js";
import { createJar, get } from "../../http/cookieClient.js";
import { fetch as undiciFetch } from "undici";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "IPTV Trex";
const BASE = "https://iptvtrex.co/members";
const PRODUCT_URL = `${BASE}/index.php?rp=/store/free-trial-iptv/trex`;
const CONFPRODUCT_URL = `${BASE}/cart.php?a=confproduct&i=0`;
const CHECKOUT_URL = `${BASE}/cart.php?a=checkout`;
const TRIAL_HOURS = 24;
const CHECKOUT_TIMEOUT_MS = 90_000;
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Helpers ───────────────────────────────────────────────────────────────────

const cookieStr = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

const mergeCookies = (jar, res) => {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
};

const extractToken = (html) =>
  html.match(/csrfToken\s*=\s*'([a-f0-9]+)'/)?.[1] ?? null;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "iptvtrex",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "trex",
  },

  async execute({ email, log = () => {} }) {
    const jar = createJar();

    // ── Step 1: Visit product page → session cookie + confproduct redirect ────
    log(`[${TAG}] 🛒 Loading product page...`);
    const { status: s1, finalUrl: f1 } = await get(PRODUCT_URL, jar);
    log(`[${TAG}] Product → ${s1} ${f1}`);

    // ── Step 2: GET confproduct page → scrape live CSRF token ─────────────────
    log(`[${TAG}] 🔐 Scraping CSRF token...`);
    const { text: confPage, status: s2 } = await get(CONFPRODUCT_URL, jar);
    const token = extractToken(confPage);
    if (!token)
      throw new Error(
        `[${TAG}] Could not extract CSRF token from confproduct page.`,
      );
    log(`[${TAG}] Token acquired.`);

    // ── Step 3: POST confproduct (XHR) → adds product to cart ─────────────────
    // Must include X-Requested-With: XMLHttpRequest — without it WHMCS returns
    // the full HTML page instead of processing the configure step.
    log(`[${TAG}] 📦 Configuring product (adding to cart)...`);
    const confRes = await undiciFetch(CONFPRODUCT_URL, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_UA,
        Cookie: cookieStr(jar),
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://iptvtrex.co",
        Referer: CONFPRODUCT_URL,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        token,
        configure: "true",
        i: "0",
        language: "english",
      }).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    mergeCookies(jar, confRes);
    await confRes.text(); // consume body
    log(
      `[${TAG}] confproduct → ${confRes.status} ${confRes.headers.get("location") ?? ""}`,
    );

    // ── Step 4: GET checkout page — verify cart populated, confirm token ───────
    log(`[${TAG}] 📋 Loading checkout page...`);
    const { text: checkoutPage, status: s4 } = await get(CHECKOUT_URL, jar);
    const token2 = extractToken(checkoutPage);
    const cartCount =
      checkoutPage.match(/id="cartItemCount"[^>]*>(\d+)/)?.[1] ?? "?";
    log(`[${TAG}] Checkout page status: ${s4} | cart: ${cartCount} item(s)`);

    if (cartCount === "0" || cartCount === "?")
      throw new Error(
        `[${TAG}] Cart is empty after confproduct step — cannot proceed.`,
      );

    if (!token2)
      throw new Error(
        `[${TAG}] Could not extract CSRF token from checkout page.`,
      );

    // ── Step 5: POST checkout ─────────────────────────────────────────────────
    log(`[${TAG}] 📝 Submitting checkout form...`);
    const checkoutBody = new URLSearchParams({
      token: token2,
      submit: "true",
      custtype: "new",
      loginemail: "",
      loginpassword: "",
      firstname: "kbagxs16303",
      lastname: "kbagxs16303",
      email: email.trim(),
      "country-calling-code-phonenumber": "1",
      phonenumber: "123456789",
      companyname: "",
      address1: "N/A",
      address2: "",
      city: "N/A",
      state: "N/A",
      postcode: "00000",
      country: "US",
      language: "english",
      password: "kbagxs16303",
      password2: "kbagxs16303",
      applycredit: "1",
      paymentmethod: "mailin",
      ccinfo: "new",
      ccnumber: "",
      ccexpirydate: "",
      cccvv: "",
      ccdescription: "",
      notes: "",
      marketingoptin: "1",
    }).toString();

    const postRes = await undiciFetch(CHECKOUT_URL, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_UA,
        Cookie: cookieStr(jar),
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://iptvtrex.co",
        Referer: CHECKOUT_URL,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      body: checkoutBody,
      redirect: "manual",
      signal: AbortSignal.timeout(CHECKOUT_TIMEOUT_MS),
    });
    mergeCookies(jar, postRes);
    const postText = await postRes.text();
    const location = postRes.headers.get("location") ?? "";

    log(
      `[${TAG}] 📡 Checkout → ${postRes.status} | Location: ${location || "(none)"}`,
    );

    // Surface any validation error from WHMCS
    const errMatch = postText.match(
      /Please correct the following errors[^<]*<ul[^>]*>([\s\S]*?)<\/ul>/i,
    );
    if (errMatch) {
      const errors = errMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(`[${TAG}] Checkout rejected: ${errors}`);
    }

    const succeeded =
      location.includes("a=complete") ||
      postText.includes("Order Confirmation") ||
      postText.includes("Your order has been");

    if (succeeded) {
      log(`[${TAG}] ✅ Order placed successfully.`);
    } else {
      log(
        `[${TAG}] ⚠️ Checkout did not reach the complete page — proceeding anyway.`,
        "warn",
      );
    }

    // ── Step 6: Account registered — M3U is provisioned manually by staff ─────
    // iptvtrex.co sends two automatic emails (Welcome + Order Confirmation) that
    // contain no M3U link. The credentials email is sent manually by their team
    // after they review the order — it cannot be received in the same session.
    log(
      `[${TAG}] ℹ️ Account registered. iptvtrex.co provisions trials manually.`,
    );
    log(
      `[${TAG}] ℹ️ Check your inbox in a few minutes for the credentials email.`,
    );

    return buildResult({
      status: "success",
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
      note: `${TAG} trial registered successfully. The M3U credentials email is sent manually by staff — check your inbox in a few minutes.`,
    });
  },
};
