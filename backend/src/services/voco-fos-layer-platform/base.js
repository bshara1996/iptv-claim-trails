/**
 * submit-trial-platform/base.js
 *
 * Shared registration engine for services running on the submit-trial REST platform
 * (Fos TV, LayerSeven TV, VocoIPTV, etc.).
 *
 * Flow:
 *   1. POST <baseUrl>/api/submit-trial — no captcha, no OTP required.
 *   2. Poll inbox for the welcome email containing M3U credentials.
 *
 * Each service file calls `createSubmitTrialService(config)` and exports the result.
 */
import {
  generateUsername,
  generatePhone,
  buildResult,
} from "../../parsing/generators.js";
import { jsonPost } from "../../http/cookieClient.js";

/**
 * Creates a standardized service definition for submit-trial providers.
 *
 * @param {Object} config
 * @param {string} config.id - Service identifier (e.g. "fostv")
 * @param {string} config.name - Display name (e.g. "Fos TV")
 * @param {string} config.domain - Website domain (e.g. "fostv.io")
 * @param {string} config.websiteId - Static website UUID from <meta name="website-id">
 * @param {string} [config.filterText] - Keyword to match confirmation email
 * @param {number} [config.trialHours=24] - Trial duration in hours
 * @param {number} [config.timeout=300000] - Inbox polling timeout in ms
 */
const DEFAULT_TRIAL_HOURS = 24;

export function createSubmitTrialService({
  id,
  name,
  domain,
  websiteId,
  filterText = domain.split(".")[0],
  trialHours = DEFAULT_TRIAL_HOURS,
  timeout = 300_000,
}) {
  const trialUrl = `https://${domain}/free-trial`;
  const apiUrl = `https://${domain}/api/submit-trial`;
  const tag = name;

  return {
    meta: {
      id,
      name,
      description: `${trialHours} Hours`,
    },

    async execute({
      provider,
      credentialStore,
      email,
      inboxSeenIds = new Set(),
      log = () => {},
    }) {
      // Step 1: Submit the trial request — server queues the credential email.
      await jsonPost(
        apiUrl,
        null,
        {
          website_id: websiteId,
          website_url: domain,
          customer_name: generateUsername(),
          customer_email: email.trim(),
          customer_phone: generatePhone(),
        },
        { referer: trialUrl },
      );
      log(`[${tag}] Trial request submitted.`);

      // Step 2: Poll inbox for the welcome email containing M3U/Xtream credentials.
      const playlists = await provider.waitForEmailAndExtractPlaylists(
        credentialStore,
        {
          filterText,
          seenIds: new Set(inboxSeenIds),
          timeout,
        },
      );

      if (!playlists.allM3uLinks.length) {
        log(`[${tag}] No M3U links found in confirmation email.`, "warn");
      } else {
        log(
          `[${tag}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
        );
      }

      return buildResult({
        playlists,
        trialHours,
        serviceName: tag,
      });
    },
  };
}
