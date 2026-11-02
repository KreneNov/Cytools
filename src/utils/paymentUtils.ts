/**
 * Generates a unique 10-character alphanumeric payment code (SEVQR + 5 uppercase alphanumeric characters).
 * Excludes ambiguous characters (0, 1, I, O) for optimal scanning and manual entry accuracy.
 */
export function generateClientPaymentCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = 'SEVQR';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
