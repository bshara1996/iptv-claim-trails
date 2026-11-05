/**
 * Tmail.io disposable email provider.
 *
 * Creates a temporary Gmail-style address and reads its inbox through the
 * site's Laravel Livewire endpoints.
 *
 * Flow:
 *   GET  /temporary-disposable-gmail → seeds session + two Livewire snapshots
 *   POST /livewire/message/gmail.app syncEmail (callMethod) → sync address
 *   POST /livewire/message/gmail.app fetchMessages (fireEvent) → inbox:
 *     serverMemo.data.messages = [{ id, subject, sender_name, sender_email,
 *     date, content }]
 *
 * Responses return a partial serverMemo merged back into our snapshot to keep
 * its checksum valid. Message bodies ship inline in `content`.
 */

import logger from "../logger.js";
import {
  makeGetReader,
  createProviderMethods,
  messageIdOf,
  joinFields,
} from "./base.js";
import {
  get,
  mergeCookies,
  cookieStr,
  DEFAULT_UA,
} from "../http/cookieClient.js";

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://tmail.io";
const PAGE_PATH = "/temporary-disposable-gmail";
const TAG = "Tmail.io";

const PREVIEW_FIELDS = "sender_name sender_email subject";
const CONTENT_FIELDS = "content subject sender_name sender_email";

// ── Livewire helpers ─────────────────────────────────────────────────────────

// wire:initial-data attribute values are HTML-entity encoded.
const decodeEntities = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// Merges a partial Livewire response (changed data + new checksum/htmlHash) back
// into the local snapshot so it stays valid for the next request.
function applyMerge(snap, resp) {
  if (resp?.serverMemo?.data)
    Object.assign(snap.serverMemo.data, resp.serverMemo.data);
  if (resp?.serverMemo?.htmlHash)
    snap.serverMemo.htmlHash = resp.serverMemo.htmlHash;
  if (resp?.serverMemo?.checksum)
    snap.serverMemo.checksum = resp.serverMemo.checksum;
}

// Sends one Livewire update to a component and returns the parsed { effects, serverMemo }.
async function livewirePost(
  snap,
  component,
  jar,
  csrf,
  { type, action, params = [] },
) {
  const update =
    type === "fireEvent"
      ? {
          type: "fireEvent",
          payload: {
            event: action,
            params,
            to: null,
            up: false,
            self: false,
            id: crypto.randomUUID(),
          },
        }
      : {
          type: "callMethod",
          payload: { id: crypto.randomUUID(), method: action, params },
        };

  const res = await fetch(`${BASE_URL}/livewire/message/${component}`, {
    method: "POST",
    headers: {
      "User-Agent": DEFAULT_UA,
      "Content-Type": "application/json",
      Accept: "text/html, application/xhtml+xml",
      "X-Livewire": "true",
      "X-CSRF-TOKEN": csrf,
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE_URL}${PAGE_PATH}`,
      Origin: BASE_URL,
      Cookie: cookieStr(jar),
    },
    body: JSON.stringify({
      fingerprint: snap.fingerprint,
      serverMemo: snap.serverMemo,
      updates: [update],
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });

  mergeCookies(jar, res);
  const text = await res.text();
  if (!res.ok)
    throw new Error(`[${TAG}] ${component}.${action} → HTTP ${res.status}`);
  return JSON.parse(text);
}

// Pulls the { fingerprint, serverMemo } snapshot for a named component out of the
// page HTML (matching by fingerprint.name). Returns null if not found.
function extractSnapshot(html, componentName) {
  for (const m of html.matchAll(/wire:initial-data="([^"]*)"/g)) {
    try {
      const snap = JSON.parse(decodeEntities(m[1]));
      if (snap?.fingerprint?.name === componentName) return snap;
    } catch {
      /* skip malformed snippets */
    }
  }
  return null;
}

// ── Inbox reader ──────────────────────────────────────────────────────────────

function buildReader(credential) {
  const { appSnapshot, jar, csrf } = credential;
  // Retain the last listing between polls: a partial update that didn't touch
  // `messages` leaves the cache intact rather than wiping it to [].
  let messages = [];

  return {
    async fetchMessages() {
      const resp = await livewirePost(appSnapshot, "gmail.app", jar, csrf, {
        type: "fireEvent",
        action: "fetchMessages",
      });
      applyMerge(appSnapshot, resp);
      if (Array.isArray(resp?.serverMemo?.data?.messages))
        messages = resp.serverMemo.data.messages;

      return messages.map((m, i) => ({
        id: messageIdOf(m, i),
        preview: joinFields(m, PREVIEW_FIELDS),
      }));
    },

    // Body ships in the listing — read from cache.
    async readMessage(id) {
      const msg = messages.find(
        (m, i) => String(messageIdOf(m, i)) === String(id),
      );
      return msg ? joinFields(msg, CONTENT_FIELDS) : "";
    },
  };
}

const getReader = makeGetReader("_tmailCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tmail",
    name: TAG,
    url: BASE_URL,
    description: "@gmail.com",
    apiOnly: false,
  },

  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);

    // 1) Load the page to seed the session (cookies), CSRF token, and the
    //    embedded Livewire snapshots. cookieClient.get follows redirects and
    //    harvests Set-Cookie at every hop.
    const jar = {};
    const { text: html, status } = await get(`${BASE_URL}${PAGE_PATH}`, jar);
    if (status !== 200) throw new Error(`[${TAG}] Page load → HTTP ${status}.`);

    const csrf = html.match(/window\.livewire_token\s*=\s*'([^']+)'/)?.[1];
    const actions = extractSnapshot(html, "gmail.actions");
    const app = extractSnapshot(html, "gmail.app");
    const email = actions?.serverMemo?.data?.email;
    if (!csrf || !app || !email)
      throw new Error(
        `[${TAG}] Could not bootstrap Livewire session from page.`,
      );

    // 2) Propagate the session address into the inbox component so fetchMessages
    //    knows which mailbox to read.
    const appSnapshot = {
      fingerprint: app.fingerprint,
      serverMemo: app.serverMemo,
    };
    const sync = await livewirePost(appSnapshot, "gmail.app", jar, csrf, {
      type: "callMethod",
      action: "syncEmail",
    });
    applyMerge(appSnapshot, sync);

    store._tmailCredential = { appSnapshot, jar, csrf };
    logger.info(`[${TAG}] Email ready: ${email}`);
    return email;
  },

  // readDelay 0: the body is already cached from fetchMessages, no separate read step.
  ...createProviderMethods(TAG, getReader, { readDelay: 0 }),
};
