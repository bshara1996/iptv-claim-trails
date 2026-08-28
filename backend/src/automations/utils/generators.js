/**
 * Shared registration data generators.
 *
 * Generic utilities for producing random usernames, passwords, and phone numbers.
 * Used by all services so each one doesn't need its own generation logic.
 *
 * Exports:
 *   generateUsername()         – random lowercase username (6 letters + 6 digits)
 *   generatePassword()         – random mixed-case alphanumeric password (10 chars)
 *   generatePhone()            – random 10-digit phone number (non-zero leading digit)
 *   computeExpiresAt(ms)       – formatted expiry timestamp, ms from now
 *   computeTrialExpiry(hours)  – shorthand: computeExpiresAt(hours * 3_600_000)
 */
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "23456789"; // avoids ambiguous 0/1

// Picks n random characters from the given charset
function rand(charset, n) {
  return Array.from(
    { length: n },
    () => charset[Math.floor(Math.random() * charset.length)],
  ).join("");
}

// Generates a random username: 10 lowercase letters + 10 digits (e.g. "abcdef123456")
export function generateUsername() {
  return rand(LOWERCASE, 10) + rand(DIGITS, 10);
}

// Generates a random password: 6 mixed-case letters + 4 digits (e.g. "AbCdEf2389")
export function generatePassword() {
  return rand(LOWERCASE + UPPERCASE, 6) + rand(DIGITS, 4);
}

// Generates a random 10-digit phone number with a non-zero leading digit
export function generatePhone() {
  const lead = String(Math.floor(1 + Math.random() * 9));
  const rest = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  return lead + rest;
}

// Returns a human-readable expiry timestamp `ms` milliseconds from now.
// Format: "Jan 1, 2026, 00:00" (en-US locale, 24-hour clock)
export function computeExpiresAt(ms) {
  return new Date(Date.now() + ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Shorthand for trial expiry: converts hours → ms then formats.
// Usage: computeTrialExpiry(24) → expiry 24 hours from now
export function computeTrialExpiry(hours) {
  return computeExpiresAt(hours * 3_600_000);
}
