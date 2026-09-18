/**
 * captcha.js
 *
 * Shared interactive challenge helper.
 *
 * Exports:
 *   awaitCaptcha(taskId, emitter, pageUrl, sitekey, log)
 *     — emits a captcha_challenge event and returns a Promise that resolves
 *       with the token when the frontend POSTs the solved response back.
 */
import { emit } from "./events.js";
import { setPendingCaptcha } from "./taskStore.js";

// Emits a captcha_challenge event and returns a Promise that resolves
// when the frontend POSTs the solved reCAPTCHA token back via the captcha route.
export function awaitCaptcha(
  taskId,
  emitter,
  pageUrl,
  sitekey,
  serviceName,
  log,
  provider = "recaptcha",
) {
  log(
    `[${serviceName}] ${provider === "turnstile" ? "Cloudflare Turnstile" : "reCAPTCHA"} detected — waiting for user to solve…`,
    "warn",
  );
  emit(emitter, "captcha_challenge", {
    taskId,
    sitekey,
    pageUrl,
    serviceName,
    provider,
  });
  return new Promise((resolve) => setPendingCaptcha(taskId, resolve));
}
