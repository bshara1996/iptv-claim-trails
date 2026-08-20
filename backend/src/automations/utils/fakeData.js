/**
 * Shared registration data generators.
 *
 * Generic utilities for producing random usernames, passwords, and phone numbers.
 * Used by all services so each one doesn't need its own generation logic.
 *
 * Exports:
 *   generateUsername()  – random lowercase username (4 letters + 4 digits)
 *   generatePassword()  – random mixed-case alphanumeric password (10 chars)
 *   generatePhone()     – random 10-digit phone number (non-zero leading digit)
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

// Generates a random username: 4 lowercase letters + 4 digits (e.g. "abcd1234")
export function generateUsername() {
  return rand(LOWERCASE, 4) + rand(DIGITS, 4);
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
