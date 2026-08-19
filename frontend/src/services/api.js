const BASE = '/api/automation';

export async function fetchInfo() {
  const res = await fetch(`${BASE}/info`);
  if (!res.ok) throw new Error(`Failed to load automation info: ${res.status}`);
  return res.json();
}

export async function startAutomation(providerId, serviceIds, options = {}) {
  const res = await fetch(`${BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId,
      serviceIds,
      headless: options.headless ?? false,
    }),
  });
  return res.json();
}

export async function stopAutomation(taskId) {
  const res = await fetch(`${BASE}/stop/${taskId}`, { method: 'POST' });
  return res.json();
}

/**
 * Open an SSE stream for a task and call handlers for each event type.
 * @returns {Function} unsubscribe — call to close the stream
 */
export function subscribeToTask(taskId, { onLog, onResult, onEmail, onDone, onError } = {}) {
  const es = new EventSource(`${BASE}/stream/${taskId}`);

  es.onmessage = (e) => {
    let event;
    try { event = JSON.parse(e.data); } catch { return; }

    switch (event.type) {
      case 'log':           onLog?.(event.data, event.timestamp);  break;
      case 'result':        onResult?.(event.data);                break;
      case 'email_created': onEmail?.(event.data);                 break;
      case 'error':         onError?.(event.data);                 break;
      case 'done':
      case 'stream_end':    es.close(); onDone?.(event.data);      break;
      default: break;
    }
  };

  es.onerror = () => { es.close(); onDone?.(); };

  return () => es.close();
}
