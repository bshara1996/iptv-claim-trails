/**
 * engine/simplePost.js
 *
 * Factory for the most common service pattern:
 *   POST a payload → poll inbox for M3U credentials.
 *
 * Usage:
 *   export default simplePost({
 *     meta:        { id, name, description, group },
 *     url:         "https://…",
 *     referer:     "https://…",        // optional, defaults to url
 *     origin:      "https://…",        // optional, defaults to url origin
 *     filterText:  "sender",           // string or string[]
 *     trialHours:  24,                 // fixed-hour expiry  OR
 *     expiryDate:  () => nextDayAt(1), // dynamic expiry (called at run time)
 *     payload:     (email) => ({ name: …, email, … }),
 *   });
 */
import { buildResult } from "../parsing/generators.js";
import { jsonPost } from "../http/cookieClient.js";

export function simplePost({
  meta,
  url,
  referer,
  origin,
  filterText,
  trialHours,
  expiryDate,
  payload,
}) {
  const TAG = meta.name;

  return {
    meta,
    async execute({
      provider,
      credentialStore,
      email,
      inboxSeenIds = new Set(),
      log = () => {},
    }) {
      log(`[${TAG}] Submitting free trial request for ${email}...`);

      // null = no cookie jar needed; fall back to url if no explicit referer
      await jsonPost(url, null, payload(email), {
        referer: referer ?? url,
        origin,
      });

      log(`[${TAG}] Trial request submitted. Waiting for credentials email...`);

      // snapshot seenIds so the poller only watches for new messages from this point
      const playlists = await provider.waitForEmailAndExtractPlaylists(
        credentialStore,
        { filterText, seenIds: new Set(inboxSeenIds), timeout: 120_000 },
      );

      if (!playlists.allM3uLinks.length)
        log(`[${TAG}] No M3U links found in credentials email.`, "warn");
      else
        // tvPlaylist is the first/primary stream link when the email contains several
        log(
          `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
        );

      // expiryDate() is called now so the timestamp reflects actual activation time
      return buildResult({
        playlists,
        trialHours,
        expiryDate: expiryDate?.(),
        serviceName: TAG,
      });
    },
  };
}
