/**
 * Lux IPTV — free 24-hour trial through the site's Tawk.to chat widget.
 *
 * The public site does not expose a trial form. Its widget registers a visitor
 * with Tawk, submits the pre-chat email, and the Lux support bot sends the
 * trial credentials by email.
 */
import { buildResult } from "../../parsing/generators.js";
import { createJar, cookieStr, jsonPost } from "../../http/cookieClient.js";
import WebSocket from "ws";
import { randomBytes } from "node:crypto";

const PROPERTY_ID = "64ac15e694cf5d49dc62ab13";
const WIDGET_ID = "1h503b42e";
const PAGE_URL = "https://lux-iptv.tv/";
const SESSION_URL = "https://va.tawk.to/v1/session/start";
const PRECHAT_URL = "https://va.tawk.to/v1/visitor/prechat-form";
const MESSAGE_URL = "https://va.tawk.to/v1/message/visitor";
const TAG = "Lux IPTV";
const TRIAL_HOURS = 24;
const IDEMPOTENCY_ALPHABET =
  "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

function createVisitorKey() {
  const bytes = randomBytes(21);
  return [...bytes]
    .map((_, index) => IDEMPOTENCY_ALPHABET[bytes[index] & 63])
    .join("");
}

function errorDetail(error) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.code === "string") return error.code;
    return JSON.stringify(error);
  }
  return String(error ?? "unknown error");
}

function socketService(session, service, route, payload) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://${session.vss}/s/?k=${session.sk}&cver=4&pop=false&asver=0&tkn=${encodeURIComponent(session.tkn)}&transport=websocket`,
      {
        headers: {
          Origin: new URL(PAGE_URL).origin,
          Referer: PAGE_URL,
          "User-Agent": "Mozilla/5.0",
          Cookie: cookieStr(session.jar),
        },
      },
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`[${TAG}] Tawk socket request timed out.`));
    }, 30_000);

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `[${TAG}] Tawk socket connection failed: ${errorDetail(error)}`,
        ),
      );
    });
    socket.on("message", (data) => {
      const text = data.toString();
      if (!text.startsWith("4")) return;
      let frame;
      try {
        frame = JSON.parse(text.slice(1));
      } catch {
        return;
      }
      if (frame.c !== "__callback__") return;
      clearTimeout(timeout);
      socket.close();
      if (frame.p?.[0]) {
        reject(
          new Error(
            `[${TAG}] Tawk ${route} rejected: ${errorDetail(frame.p[0])}`,
          ),
        );
        return;
      }
      const result = frame.p?.[1];
      if (result?.ok === false)
        reject(
          new Error(
            `[${TAG}] Tawk ${route} rejected: ${errorDetail(result.error)}`,
          ),
        );
      else resolve(result);
    });
    socket.on("open", () => {
      socket.send(
        `4${JSON.stringify({
          c: "service",
          cb: 1,
          p: [service, route, payload],
        })}`,
      );
    });
  });
}

function endChat(session) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://${session.vss}/s/?k=${session.sk}&cver=4&pop=false&asver=0&tkn=${encodeURIComponent(session.tkn)}&transport=websocket`,
      {
        headers: {
          Origin: new URL(PAGE_URL).origin,
          Referer: PAGE_URL,
          "User-Agent": "Mozilla/5.0",
          Cookie: cookieStr(session.jar),
        },
      },
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`[${TAG}] Tawk end-chat request timed out.`));
    }, 30_000);

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(`[${TAG}] Tawk end-chat failed: ${errorDetail(error)}`),
      );
    });
    socket.once("open", () => {
      socket.send(
        `4${JSON.stringify({
          c: "endChat",
          cb: 1,
          p: [],
        })}`,
      );
    });
    socket.on("message", (data) => {
      const text = data.toString();
      if (!text.startsWith("4")) return;
      let frame;
      try {
        frame = JSON.parse(text.slice(1));
      } catch {
        return;
      }
      if (frame.c !== "__callback__" || frame.cb !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (frame.p?.[0])
        reject(
          new Error(
            `[${TAG}] Tawk end-chat rejected: ${errorDetail(frame.p[0])}`,
          ),
        );
      else resolve(frame.p?.[1] ?? null);
    });
  });
}

async function startSession() {
  const jar = createJar();
  const data = await jsonPost(
    SESSION_URL,
    jar,
    {
      p: PROPERTY_ID,
      w: WIDGET_ID,
      platform: "desktop",
      tzo: new Date().getTimezoneOffset(),
      url: PAGE_URL,
      referrer: "",
      vss: "",
      // Without a stored UUID, Tawk uses uik to issue a new visitor identity.
      // A new key prevents the session from inheriting an older transcript.
      uik: createVisitorKey(),
      consent: false,
      wss: "min",
      uv: 3,
    },
    {
      referer: PAGE_URL,
      origin: "https://lux-iptv.tv",
      throwOnError: false,
      timeout: 30_000,
    },
  );

  if (data?.ok === false)
    throw new Error(
      `[${TAG}] Tawk session rejected: ${errorDetail(data.error)}`,
    );

  const session = data?.data;
  // The first session is only used to reset any previous chat. Tawk may omit
  // `n` when the visitor has no active conversation yet.
  if (!session?.sk || !session?.vid)
    throw new Error(`[${TAG}] Tawk session was not created.`);
  return { ...session, jar };
}

async function startFreshSession() {
  const previousSession = await startSession();
  await endChat(previousSession);
  const session = await startSession();

  if (!session.n)
    throw new Error(
      `[${TAG}] Tawk did not return a conversation for the new visitor.`,
    );

  return session;
}

async function submitChat(session, email) {
  await socketService(session, "visitor-chat", PRECHAT_URL, {
    email: email.trim(),
  });
  await socketService(session, "visitor-chat", MESSAGE_URL, {
    message: email.trim(),
  });
}

export default {
  meta: {
    id: "luxiptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    log(`[${TAG}] Starting Tawk chat for ${email}...`);
    const session = await startFreshSession();
    await submitChat(session, email);
    log(`[${TAG}] Trial request submitted. Waiting for credentials email...`);

    let playlists;
    try {
      playlists = await provider.waitForEmailAndExtractPlaylists(
        credentialStore,
        {
          filterText: "lux",
          seenIds: new Set(inboxSeenIds),
          timeout: 180_000,
        },
      );
    } finally {
      await endChat(session);
    }

    if (!playlists.allM3uLinks.length)
      log(`[${TAG}] No M3U links found in confirmation email.`, "warn");

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};