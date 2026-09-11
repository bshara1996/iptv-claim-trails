/**
 * LibertyTV free trial registration service.
 * Emits a manual registration challenge so user registers in popup modal.
 * Once confirmed, backend logs in and harvests the M3U playlist.
 */
import { generateUsername, generatePassword, buildResult } from "../parsing/generators.js";
import { extractPlaylists } from "../parsing/extractors.js";
import { createJar, get, post, extractInputValue } from "../http/cookieClient.js";
import { emit } from "../engine/events.js";
import { setPendingManualDone } from "../engine/taskStore.js";

const BASE_URL = "https://account.libertytv.net";
const DASHBOARD_URL = `${BASE_URL}/dashboard.php`;
const TAG = "LibertyTV";

export default {
  meta: { id: "libertytv", name: "LibertyTV (Gmails)", description: "24 Hours" },

  async execute({ provider, credentialStore, email, inboxSeenIds = new Set(), taskId, emitter, log = () => {} }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();
    const codeAbort = new AbortController();

    log(`[${TAG}] Waiting for user to complete registration…`);
    emit(emitter, "libertytv_register", {
      taskId,
      serviceId: "libertytv",
      serviceName: "LibertyTV",
      username,
      password,
      email,
      registrationUrl: `/api/automation/libertytv-proxy/register.php?name=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    });

    // Background listener for the 6-digit OTP
    provider.waitForVerificationCodeEmail(credentialStore, {
      filterText: "liberty",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
      signal: codeAbort.signal,
    }).then((code) => {
      if (code) {
        log(`[${TAG}] ✅ Verification code: ${code}`);
        emit(emitter, "libertytv_code", { taskId, code });
      }
    }).catch(() => {});

    try {
      await new Promise((res, rej) => setPendingManualDone(taskId, res, rej));
    } finally {
      codeAbort.abort(); // Stop background poller immediately when user confirms or cancels
    }
    log(`[${TAG}] ✅ Confirmed — logging in to harvest trial…`);

    // Login to dashboard
    const { text: loginPage } = await get(`${BASE_URL}/login.php`, jar);
    await post(`${BASE_URL}/login.php`, jar, { csrf: extractInputValue(loginPage, "csrf") || "", email, password }, `${BASE_URL}/login.php`);

    // Fetch dashboard & claim trial if needed
    let { text: dash } = await get(DASHBOARD_URL, jar);
    const csrf = extractInputValue(dash, "csrf");
    if (csrf && (dash.includes("claim-trial") || dash.includes("trial-region"))) {
      log(`[${TAG}] Claiming trial…`);
      await post(`${BASE_URL}/claim-trial.php`, jar, { csrf, region_id: "32", "trial-submit": "1" }, DASHBOARD_URL);
      dash = (await get(DASHBOARD_URL, jar)).text;
    }

    let playlists = extractPlaylists(dash);
    if (!playlists?.tvPlaylist) {
      await new Promise((r) => setTimeout(r, 3_000));
      playlists = extractPlaylists((await get(DASHBOARD_URL, jar)).text);
    }

    const m3uLink = playlists?.tvPlaylist ?? null;
    log(m3uLink ? `[${TAG}] ✅ M3U: ${m3uLink}` : `[${TAG}] M3U link not found on dashboard.`, m3uLink ? "info" : "warn");

    return buildResult({ username, password, tvPlaylist: m3uLink, trialHours: 24, serviceName: "LibertyTV" });
  },
};
