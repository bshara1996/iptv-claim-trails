import {
  buildResult,
  generatePassword,
  generateUsername,
} from "../../parsing/generators.js";
import { DEFAULT_UA } from "../../http/cookieClient.js";

const BASE_URL = "https://my.y666.tv";
const API_BASE = `${BASE_URL}/api`;
const TAG = "Y666";
const PLAYLIST_BASE = "http://pl.y6tv.me";
const TRIAL_HOURS = 24;

async function apiFetch(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      "User-Agent": DEFAULT_UA,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data?.error ?? data?.message ?? `HTTP ${response.status}`;
    throw new Error(`[${TAG}] ${message}`);
  }

  return data;
}

async function register(email, username, password, log) {
  await apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password, language: "en" },
  });
  log(`[${TAG}] ✅ Registration submitted — check inbox for verification email.`);
}

async function verifyEmail(provider, store, seenIds, log) {
  log(`[${TAG}] 📩 Polling inbox for verification link...`);
  const link = await provider.waitForEmailAndExtractLink(store, {
    filterText: "y666",
    pattern: /my\.y666\.tv\/verify-email\?token=/i,
    seenIds: new Set(seenIds),
    timeout: 120_000,
  });

  if (!link) throw new Error(`[${TAG}] Verification email not received.`);

  let token;
  try {
    token = new URL(link).searchParams.get("token");
  } catch {
    throw new Error(`[${TAG}] Invalid verification link received.`);
  }
  if (!token)
    throw new Error(`[${TAG}] Could not extract token from verification link.`);

  log(`[${TAG}] 🔗 Verification link received.`);
  log(`[${TAG}] 🔐 Verifying email...`);
  const result = await apiFetch(
    `/email/verify?token=${encodeURIComponent(token)}`,
  );
  if (result?.success === false)
    throw new Error(`[${TAG}] Email verification was rejected.`);
  log(`[${TAG}] ✅ Email verified.`);
}

export default {
  meta: {
    id: "y666",
    name: "Y666",
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUsername();
    const password = generatePassword();

    log(`[${TAG}] 📝 Registering account for ${email}...`);
    await register(email, username, password, log);
    await verifyEmail(provider, credentialStore, inboxSeenIds, log);

    const playlistPath = `${PLAYLIST_BASE}/${username}/${password}`;
    const tvPlaylist = `${playlistPath}/tv.m3u`;
    const vodPlaylist = `${playlistPath}/vod.m3u`;
    const seriesPlaylist = `${playlistPath}/series.m3u`;
    const vodPlaylists = `${vodPlaylist}\n${seriesPlaylist}`;
    log(`[${TAG}] 📺 M3U: ${tvPlaylist}`);
    log(`[${TAG}] 🍿 VOD M3U: ${vodPlaylist}`);
    log(`[${TAG}] 🎬 Series M3U: ${seriesPlaylist}`);

    return buildResult({
      username,
      password,
      tvPlaylist,
      vodPlaylist: vodPlaylists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
