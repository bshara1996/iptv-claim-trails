/**
 * TurnstileModal
 *
 * Dedicated modal for Cloudflare Turnstile challenges.
 *
 * Separated from CaptchaModal so Turnstile-specific behaviour (auto-solve
 * interaction model, distinct branding, error recovery) can be handled
 * cleanly without muddying the reCAPTCHA path.
 *
 * Turnstile quirks handled here:
 *   - The widget can auto-complete invisibly on page load — if the callback
 *     fires before the user has done anything we still submit it.
 *   - "expired-callback" silently resets the widget so the user can re-solve
 *     without seeing a confusing error.
 *   - "error-callback" surfaces a friendly message and resets so the user
 *     can retry without refreshing.
 *
 * Props:
 *   challenge  { taskId, sitekey, pageUrl, serviceName, provider } | null
 *   onSolved   (taskId, token) => void
 *   onDismiss  () => void
 */
import { useEffect, useRef, useState } from "react";
import { submitCaptchaToken } from "../../services/api.js";
import "./CaptchaModal.css";

let tsWidgetId = null;

export default function TurnstileModal({ challenge, onSolved, onDismiss }) {
  const containerRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // ── Script injection (once, idempotent) ────────────────────────────────────
  useEffect(() => {
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

    const handleToken = async (token) => {
      setSubmitting(true);
      setError(null);
      try {
        await submitCaptchaToken(challenge.taskId, token);
        onSolved?.(challenge.taskId, token);
      } catch (err) {
        setError(`Failed to submit token: ${err.message}`);
        setSubmitting(false);
        // Reset so the user can solve again.
        if (tsWidgetId !== null) {
          try {
            window.turnstile?.reset(tsWidgetId);
          } catch (_) {}
        }
      }
    };

    const handleExpired = () => {
      // Token expired before submission — reset silently so the user just
      // gets prompted to solve again without seeing a scary error.
      setSubmitting(false);
      setError(null);
      if (tsWidgetId !== null) {
        try {
          window.turnstile?.reset(tsWidgetId);
        } catch (_) {}
      }
    };

    const handleError = () => {
      setError(
        "Cloudflare verification failed — check your connection and try again.",
      );
      setSubmitting(false);
      if (tsWidgetId !== null) {
        try {
          window.turnstile?.reset(tsWidgetId);
        } catch (_) {}
      }
    };

    const mount = () => {
      if (!containerRef.current || !window.turnstile?.render) return;

      // Clean up any widget from a previous challenge.
      if (tsWidgetId !== null) {
        try {
          window.turnstile.remove(tsWidgetId);
        } catch (_) {}
        tsWidgetId = null;
      }
      containerRef.current.innerHTML = "";

      tsWidgetId = window.turnstile.render(containerRef.current, {
        sitekey: challenge.sitekey,
        theme: "dark",
        callback: handleToken,
        "expired-callback": handleExpired,
        "error-callback": handleError,
      });
    };

    if (window.turnstile?.render) {
      mount();
    } else {
      window.__tsLoaded = mount;
    }
  }, [challenge]);

  if (!challenge) return null;

  return (
    <div
      className="captcha-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Cloudflare Turnstile Verification"
    >
      <div className="captcha-modal turnstile-modal">
        {/* Header */}
        <div className="captcha-modal-header">
          <div className="captcha-modal-icon">
            <img
              src="https://www.cloudflare.com/favicon.ico"
              alt="Cloudflare"
              width="26"
              height="26"
              style={{ borderRadius: 4 }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement.textContent = "🔒";
              }}
            />
          </div>
          <div>
            <h2 className="captcha-modal-title">
              Cloudflare Verification Required
            </h2>
            <p className="captcha-modal-sub">
              <strong>{challenge.serviceName ?? "This service"}</strong> is
              protected by Cloudflare Turnstile. Complete the verification below
              — the automation will resume once you're done.
            </p>
          </div>
        </div>

        <div className="captcha-modal-divider" />

        {/* Widget area */}
        <div className="captcha-widget-area">
          <div ref={containerRef} className="captcha-widget-container" />
        </div>

        {/* State feedback */}
        {submitting && (
          <div className="captcha-status submitting">
            <div className="spinner" />
            <span>Submitting Turnstile token…</span>
          </div>
        )}
        {error && (
          <div className="captcha-status error">
            <span>⚠️ {error}</span>
          </div>
        )}

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
