/**
 * Passes a clip between screens in memory (Sign -> Verify), so "check it now"
 * does not need a round trip through the file picker. Cleared on first read.
 */
let pending: { blob: Blob; filename: string } | null = null;

export function setPendingClip(blob: Blob, filename: string): void {
  pending = { blob, filename };
}

export function takePendingClip(): { blob: Blob; filename: string } | null {
  const clip = pending;
  pending = null;
  return clip;
}
