/**
 * CaptchaModal
 *
 * Renders a full-screen overlay with either a Cloudflare Turnstile widget or a
 * reCAPTCHA v2 widget, depending on challenge.provider ("turnstile" | "recaptcha").
 *
 * Props:
 *   challenge  { taskId, sitekey, pageUrl, serviceName, provider } | null
 *   onSolved   (taskId, token) => void   — called after solve + POST
 *   onDismiss  () => void                — "Cancel" button
 */
import { useEffect, useRef, useState } from "react";
import { submitCaptchaToken } from "../../services/api.js";
import "./CaptchaModal.css";

// ── reCAPTCHA widget state (global so it survives re-renders) ─────────────────
let rcWidgetId = null;

// ── Turnstile widget state ────────────────────────────────────────────────────
let tsWidgetId = null;

export default function CaptchaModal({ challenge, onSolved, onDismiss }) {
  const containerRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isTurnstile = challenge?.provider === "turnstile";

  // ── Script injection ────────────────────────────────────────────────────────
  useEffect(() => {
    // reCAPTCHA (injected once, idempotent)
    if (!document.getElementById("recaptcha-sdk")) {
      const s = document.createElement("script");
      s.id = "recaptcha-sdk";
      s.src =
        "https://www.google.com/recaptcha/api.js?render=explicit&onload=__rcLoaded";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    // Cloudflare Turnstile (injected once, idempotent)
    if (!document.getElementById("turnstile-sdk")) {
      const s = document.createElement("script");
      s.id = "turnstile-sdk";
      s.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsLoaded&render=explicit";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  }, []);

  // ── Widget mount / remount on each new challenge ────────────────────────────
  useEffect(() => {
    if (!challenge) return;

    setSubmitting(false);
    setError(null);

    // Shared submit handler used by both widget callbacks.
    const handleToken = async (token) => {
      setSubmitting(true);
      setError(null);
      try {
        await submitCaptchaToken(challenge.taskId, token);
        onSolved?.(challenge.taskId, token);
      } catch (err) {
        setError(`Failed to submit token: ${err.message}`);
        setSubmitting(false);
        // Reset so the user can retry.
        if (isTurnstile) {
          if (tsWidgetId !== null) window.turnstile?.reset(tsWidgetId);
        } else {
          if (rcWidgetId !== null) window.grecaptcha?.reset(rcWidgetId);
        }
      }
    };

    if (isTurnstile) {
      // ── Turnstile ──────────────────────────────────────────────────────────
      const mountTurnstile = () => {
        if (!containerRef.current || !window.turnstile?.render) return;

        // Remove any existing widget first.
        if (tsWidgetId !== null) {
          try {
            window.turnstile.remove(tsWidgetId);
          } catch (_) {}
          tsWidgetId = null;
        }
        containerRef.current.innerHTML = "";

        tsWidgetId = window.turnstile.render(containerRef.current, {
          sitekey: challenge.sitekey,
          theme: "light",
          callback: handleToken,
          "expired-callback": () => {
            setError("Token expired — please solve the challenge again.");
            setSubmitting(false);
          },
          "error-callback": () => {
            setError("Turnstile error — check your connection and try again.");
            setSubmitting(false);
          },
        });
      };

      if (window.turnstile?.render) {
        mountTurnstile();
      } else {
        window.__tsLoaded = mountTurnstile;
      }
    } else {
      // ── reCAPTCHA ──────────────────────────────────────────────────────────
      const mountRecaptcha = () => {
        if (!containerRef.current || !window.grecaptcha?.render) return;

        if (rcWidgetId !== null) {
          try {
            window.grecaptcha.reset(rcWidgetId);
          } catch (_) {}
          rcWidgetId = null;
        }
        containerRef.current.innerHTML = "";

        rcWidgetId = window.grecaptcha.render(containerRef.current, {
          sitekey: challenge.sitekey,
          theme: "dark",
          callback: handleToken,
          "expired-callback": () => {
            setError("Token expired — please solve the captcha again.");
            setSubmitting(false);
          },
          "error-callback": () => {
            setError("reCAPTCHA error — check your connection and try again.");
            setSubmitting(false);
          },
        });
      };

      if (window.grecaptcha?.render) {
        mountRecaptcha();
      } else {
        window.__rcLoaded = mountRecaptcha;
      }
    }
  }, [challenge]);

  if (!challenge) return null;

  return (
    <div
      className="captcha-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Solve CAPTCHA"
    >
      <div className="captcha-modal">
        {/* Header */}
        <div className="captcha-modal-header">
          <div className="captcha-modal-icon">🛡️</div>
          <div>
            <h2 className="captcha-modal-title">Human Verification Required</h2>
            <p className="captcha-modal-sub">
              {challenge.serviceName ?? "This service"} requires a CAPTCHA
              before registering. Solve it below — the automation will resume
              automatically once you're done.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="captcha-modal-divider" />

        {/* Widget area */}
        <div className="captcha-widget-area">
          <div ref={containerRef} className="captcha-widget-container" />
        </div>

        {/* State feedback */}
        {submitting && (
          <div className="captcha-status submitting">
            <div className="spinner" />
            <span>Submitting token to backend…</span>
          </div>
        )}
        {error && (
          <div className="captcha-status error">
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* Divider */}
        <div className="captcha-modal-divider" />

        {/* Footer */}
        <div className="captcha-modal-footer">
          <p className="captcha-footer-note">
            Task ID:{" "}
            <span className="captcha-task-id">
              {challenge.taskId.slice(0, 8)}…
            </span>
          </p>
          <button
            className="captcha-cancel-btn"
            onClick={onDismiss}
            disabled={submitting}
          >
            Cancel Task
          </button>
        </div>
      </div>
    </div>
  );
}
