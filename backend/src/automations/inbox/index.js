/**
 * Inbox module — single entry point for all inbox polling utilities.
 *
 * Re-exports everything so callers import from one place:
 *
 *   import { waitForValidationLink, waitForPlaylistEmail, ... }
 *     from '../inbox/index.js'
 *
 * Internal organisation:
 *   selectors.js     – INBOX_SELECTORS (browser CSS selectors)
 *   extractors.js    – extractLinks(), extractDuration(), extractPlaylists(), EMPTY_PLAYLISTS
 *   browserPoller.js – waitForValidationLink(), waitForPlaylistEmail(),
 *                      waitForVerificationCodeEmail()
 *   apiPoller.js     – pollApi()
 */

export { INBOX_SELECTORS } from "./selectors.js";
export {
  extractLinks,
  extractDuration,
  extractPlaylists,
  EMPTY_PLAYLISTS,
} from "./extractors.js";
export {
  waitForValidationLink,
  waitForPlaylistEmail,
  waitForVerificationCodeEmail,
} from "./browserPoller.js";
export { pollApi } from "./apiPoller.js";
