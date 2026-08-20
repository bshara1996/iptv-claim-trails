import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchInfo, startAutomation, stopAutomation, subscribeToTask } from '../services/api.js';

export function useAutomation() {
  const [providers,        setProviders]        = useState([]);
  const [services,         setServices]         = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedServices, setSelectedServices] = useState([]);
  const [status,           setStatus]           = useState('idle');
  const [logs,             setLogs]             = useState([]);
  const [results,          setResults]          = useState([]);
  const [email,            setEmail]            = useState(null);
  const [taskId,           setTaskId]           = useState(null);
  const [showBrowser,      setShowBrowser]      = useState(true);
  const [backendError,     setBackendError]     = useState(null);

  const unsubRef = useRef(null);

  // ── Load providers and services from backend ──────────────────────────────
  useEffect(() => {
    fetchInfo()
      .then((info) => {
        setProviders(info.providers || []);
        setServices(info.services   || []);
        if (info.providers?.length) setSelectedProvider(info.providers[0].id);
      })
      .catch((err) => setBackendError(`Cannot reach backend: ${err.message}`));
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const pushLog = useCallback((message, level = 'info', time) => {
    setLogs((prev) => [
      ...prev,
      { message, level, time: time ? new Date(time).toLocaleTimeString() : new Date().toLocaleTimeString() },
    ]);
  }, []);

  const toggleService = useCallback((id) => {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }, []);

  // ── Start automation ──────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!selectedProvider || !selectedServices.length) return;

    // Reset state
    setStatus('running');
    setLogs([]);
    setResults([]);
    setEmail(null);
    setTaskId(null);
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }

    pushLog('Connecting to backend...');

    let data;
    try {
      data = await startAutomation(selectedProvider, selectedServices, { headless: !showBrowser });
    } catch (err) {
      pushLog(`Failed to start: ${err.message}`, 'error');
      setStatus('error');
      return;
    }

    if (data.error) {
      pushLog(data.error, 'error');
      setStatus('error');
      return;
    }

    setTaskId(data.taskId);
    pushLog(`Task ${data.taskId.slice(0, 8)}… started`);

    // Subscribe to SSE stream
    unsubRef.current = subscribeToTask(data.taskId, {
      onLog:    (d, ts) => pushLog(d.message, d.level || 'info', ts),
      onEmail:  (d)     => setEmail(d.email),
      onResult: (d)     => setResults((prev) => [...prev, d]),
      onError:  (d)     => pushLog(d.message, 'error'),
      onDone:   ()      => setStatus((prev) => prev === 'running' ? 'done' : prev),
    });
  }, [selectedProvider, selectedServices, showBrowser, pushLog]);

  // ── Stop automation ───────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!taskId) return;
    unsubRef.current?.();
    unsubRef.current = null;
    await stopAutomation(taskId).catch(console.error);
    setStatus('cancelled');
    pushLog('Automation stopped by user.', 'warn');
  }, [taskId, pushLog]);

  // Cleanup on unmount
  useEffect(() => () => unsubRef.current?.(), []);

  return {
    // Data
    providers, services,
    // Selections
    selectedProvider, setSelectedProvider,
    selectedServices, toggleService,
    // Runtime state
    status, logs, results, email, taskId,
    // Options
    showBrowser, setShowBrowser,
    // Error
    backendError,
    // Actions
    start, stop,
  };
}
