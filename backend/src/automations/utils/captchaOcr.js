/**
 * OCR solver for image-based CAPTCHAs using ddddocr-node.
 *
 * No external model files or downloads required — ddddocr bundles its own model.
 *
 * Exports:
 *   solveImageCaptcha(page, imgSelector, log) – returns recognised text or null
 */

import { DdddOcr } from "ddddocr-node";

// ── OCR instance ──────────────────────────────────────────────────────────────

// Shared instance — created once, reused across all calls.
let _ocr = null;

// Returns the shared ddddocr instance, initialising it on first call.
function getOcr() {
  if (!_ocr) _ocr = new DdddOcr();
  return _ocr;
}

// ── Exports ───────────────────────────────────────────────────────────────────

// Screenshots the CAPTCHA image, runs OCR, and returns the recognised text or null.
export async function solveImageCaptcha(page, imgSelector, log = () => {}) {
  const img = await page.$(imgSelector);
  if (!img) {
    log("[CaptchaOCR] CAPTCHA image not found.", "warn");
    return null;
  }

  const screenshot = await img.screenshot({ type: "png" }).catch(() => null);
  if (!screenshot) {
    log("[CaptchaOCR] Could not screenshot CAPTCHA image.", "warn");
    return null;
  }

  const text = await getOcr().classification(screenshot);
  const result = (text ?? "").replace(/\s+/g, "").trim();

  log(`[CaptchaOCR] Recognised: "${result}"`);
  return result || null;
}
