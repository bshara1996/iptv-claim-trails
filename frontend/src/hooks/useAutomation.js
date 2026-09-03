import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchInfo,
  startAutomation,
  stopAutomation,
  subscribeToTask,
} from "../services/api.js";

export function useAutomation() {
  const [providers, setProviders] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedServices, setSelectedServices] = useState([]);
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [email, setEmail] = useState(null);
  const [taskId, setTaskId] = useState(null);
  const [backendError, setBackendError] = useState(null);
  // captchaChallenge: null | { taskId, sitekey, pageUrl }
  const [captchaChallenge, setCaptchaChallenge] = useState(null);

  const unsubRef = useRef(null);

  // ── Load providers and services from backend ──────────────────────────────
  useEffect(() => {
    fetchInfo()
      .then((info) => {
        setProviders(info.providers || []);
        setServices(info.services || []);
        if (info.providers?.length) setSelectedProvider(info.providers[0].id);
      })
      .catch((err) => setBackendError(`Cannot reach backend: ${err.message}`));
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const pushLog = useCallback((message, level = "info", time) => {
    setLogs((prev) => [
      ...prev,
      {
        message,
        level,
        time: time
          ? new Date(time).toLocaleTimeString()
          : new Date().toLocaleTimeString(),
      },
    ]);
  }, []);

  const toggleService = useCallback((id) => {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);

  // ── Captcha handlers ──────────────────────────────────────────────────────

  // Called by CaptchaModal after the token was successfully POSTed to the backend.
  const onCaptchaSolved = useCallback(
    (solvedTaskId) => {
      setCaptchaChallenge(null);
      pushLog("[LayerSeven] ✅ CAPTCHA solved — resuming automation…");
    },
    [pushLog],
  );

  // Called when the user clicks "Cancel Task" inside the modal.
  const onCaptchaDismiss = useCallback(() => {
    setCaptchaChallenge(null);
    if (taskId) stopAutomation(taskId).catch(console.error);
    setStatus("cancelled");
    pushLog("Task cancelled by user (CAPTCHA dismissed).", "warn");
  }, [taskId, pushLog]);

  // ── Start automation ──────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!selectedProvider || !selectedServices.length) return;

    // Reset state
    setStatus("running");
    setLogs([]);
    setResults([]);
    setEmail(null);
    setTaskId(null);
    setCaptchaChallenge(null);
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    pushLog("Connecting to backend...");

    let data;
    try {
      data = await startAutomation(selectedProvider, selectedServices);
    } catch (err) {
      pushLog(`Failed to start: ${err.message}`, "error");
      setStatus("error");
      return;
    }

    if (data.error) {
      pushLog(data.error, "error");
      setStatus("error");
      return;
    }

    setTaskId(data.taskId);
    pushLog(`Task ${data.taskId.slice(0, 8)}… started`);

    // Subscribe to SSE stream
    unsubRef.current = subscribeToTask(data.taskId, {
      onLog: (d, ts) => pushLog(d.message, d.level || "info", ts),
      onEmail: (d) => setEmail(d.email),
      onResult: (d) => setResults((prev) => [...prev, d]),
      onError: (d) => pushLog(d.message, "error"),
      // captcha_challenge: pause the task and show the modal
      onCaptcha: (d) => {
        pushLog(
          "[LayerSeven] 🛡️ CAPTCHA required — solve it in the pop-up…",
          "warn",
        );
        setCaptchaChallenge(d); // { taskId, sitekey, pageUrl }
      },
      onDone: () => setStatus((prev) => (prev === "running" ? "done" : prev)),
    });
  }, [selectedProvider, selectedServices, pushLog]);

  // ── Stop automation ───────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!taskId) return;
    unsubRef.current?.();
    unsubRef.current = null;
    setCaptchaChallenge(null);
    await stopAutomation(taskId).catch(console.error);
    setStatus("cancelled");
    pushLog("Automation stopped by user.", "warn");
  }, [taskId, pushLog]);

  // Cleanup on unmount
  useEffect(() => () => unsubRef.current?.(), []);

  return {
    // Data
    providers,
    services,
    // Selections
    selectedProvider,
    setSelectedProvider,
    selectedServices,
    toggleService,
    // Runtime state
    status,
    logs,
    results,
    email,
    taskId,
    // Error
    backendError,
    // Captcha
    captchaChallenge,
    onCaptchaSolved,
    onCaptchaDismiss,
    // Actions
    start,
    stop,
  };
}
