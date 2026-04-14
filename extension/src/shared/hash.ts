// src/shared/hash.ts
// SHA-256 via Web Crypto API (no npm packages — MV3 requirement).

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 * Uses the browser-native Web Crypto API — no third-party dependency.
 */
export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
