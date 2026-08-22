/**
 * Generic fetch wrapper for REST-API email providers.
 *
 * Exports:
 *   apiFetch(baseUrl, path, opts) – throws on non-2xx with a readable message,
 *                                   returns null on 204 No Content
 */

export async function apiFetch(
  baseUrl,
  path,
  { method = "GET", token = null, body = null } = {},
) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j["hydra:description"] ?? j.message ?? JSON.stringify(j);
    } catch (_) {}
    throw new Error(
      `[apiFetch] ${method} ${baseUrl}${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  if (res.status === 204) return null; // No Content
  return res.json();
}
