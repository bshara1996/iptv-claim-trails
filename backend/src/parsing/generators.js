/**
 * generators.js
 *
 * Shared random data generators and date/duration utilities.
 * Used by services and email providers — no domain dependencies.
 *
 * Exports:
 *   generateUsername()         — random lowercase username (10 letters + 10 digits)
 *   generatePassword()         — random mixed-case alphanumeric password (10 chars)
 *   generatePhone()            — random 10-digit phone number (non-zero leading digit)
 *   computeExpiresAt(msOrDate) — formatted expiry timestamp from ms offset or Date
 *   computeTrialExpiry(hours)  — shorthand: computeExpiresAt(hours * 3_600_000)
 *   parseExpiryDate(raw)       — parses "DD.MM.YYYY HH:mm" UTC string into a Date
 *   formatDuration(expiryDate) — remaining time from a Date as "N Hours"
 */

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "23456789"; // avoids ambiguous 0/1

// Picks n random characters from charset.
function rand(charset, n) {
  return Array.from(
    { length: n },
    () => charset[Math.floor(Math.random() * charset.length)],
  ).join("");
}

// Returns a random username: 10 lowercase letters followed by 10 digits.
export function generateUsername() {
  return rand(LOWERCASE, 10) + rand(DIGITS, 10);
}

// Returns a random password: 6 mixed-case letters followed by 4 digits.
export function generatePassword() {
  return rand(LOWERCASE + UPPERCASE, 6) + rand(DIGITS, 4);
}

// Returns a random 10-digit phone number with a non-zero leading digit.
export function generatePhone() {
  const lead = String(Math.floor(1 + Math.random() * 9));
  const rest = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  return lead + rest;
}

// Returns a human-readable expiry timestamp for the given Date or ms offset.
// Format: "Jan 1, 2026, 00:00" (en-US, 24-hour clock).
export function computeExpiresAt(msOrDate, { timeZone } = {}) {
  const date =
    msOrDate instanceof Date ? msOrDate : new Date(Date.now() + msOrDate);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone && { timeZone }),
  });
}

// Shorthand: converts trial hours to ms offset then formats.
export function computeTrialExpiry(hours) {
  return computeExpiresAt(hours * 3_600_000);
}

// Parses a "DD.MM.YYYY HH:mm" UTC string (as returned by some IPTV APIs) into a Date.
export function parseExpiryDate(raw) {
  if (!raw) return null;
  const [datePart, timePart] = raw.split(" ");
  const [day, month, year] = datePart.split(".");
  return new Date(`${year}-${month}-${day}T${timePart}:00Z`);
}

// Returns the remaining time from an expiry Date as "N Hours".
export function formatDuration(expiryDate) {
  if (!expiryDate) return null;
  const totalHours = Math.round((expiryDate - Date.now()) / 3_600_000);
  return `${totalHours} Hours`;
}

// Builds an Xtream-Codes M3U+ URL from a server host and credentials.
// Returns null if any argument is missing.
export const buildM3u = (host, username, password) =>
  host && username && password
    ? `${host}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`
    : null;
