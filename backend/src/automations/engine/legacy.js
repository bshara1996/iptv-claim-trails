/**
 * Legacy service execution path.
 *
 * Services that only implement register(page, email) use this path.
 * New services should implement execute({ page, emailPage, provider, email,
 * inboxSeenIds, log }) instead — it gives full control over the inbox flow
 * and avoids coupling the engine to provider-specific polling.
 */
import { log } from "./helpers.js";

function legacyNote(playlists, fallback) {
  if (!playlists.tvPlaylist)
    return fallback ?? "Registered — check inbox for playlist links.";
  if (playlists.duration)
    return `${playlists.duration}${playlists.expiresAt ? ` (Expires: ${playlists.expiresAt})` : ""}`;
  return "IPTV playlists collected successfully!";
}

export async function runLegacyService(
  service,
  regPage,
  emailPage,
  provider,
  email,
  inboxSeenIds,
  emitter,
) {
  const result = await service.register(regPage, email);

  log(
    emitter,
    `📬 Checking inbox for ${service.meta.name} confirmation & playlists...`,
  );
  await emailPage.bringToFront().catch(() => {});

  const playlists = await provider
    .waitForEmailAndExtractPlaylists(emailPage, {
      filterText: service.meta.name,
      seenIds: inboxSeenIds,
      timeout: 60_000,
    })
    .catch((e) => {
      log(emitter, `Notice: ${e.message}`, "warn");
      return {};
    });

  return { ...result, ...playlists, note: legacyNote(playlists, result.note) };
}
