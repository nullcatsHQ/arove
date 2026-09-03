import { hmacSha256Hex, timingSafeEqual, generateSecureToken } from "../lib/crypto.js";

export async function verifyGitHubSignature(
  secret: string,
  payload: string,
  signatureHeader: string | undefined
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(secret, payload);
  const provided = signatureHeader.slice("sha256=".length);
  return timingSafeEqual(expected, provided);
}

export function generateWebhookSecret(): string {
  return generateSecureToken(32);
}
