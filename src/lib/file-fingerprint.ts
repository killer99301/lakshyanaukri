// ═══════════════════════════════════════════════════════════
// A file's SHA-256, worked out in the browser (Stage C, C3 step 1)
// ═══════════════════════════════════════════════════════════
//
// For the whole-table check's first step (owner's decision C3-D2): a person
// picks their own copy of the notice, and its fingerprint is compared with
// the one stored when the document was imported. Web Crypto only: the file
// is read on the person's computer and is never uploaded or sent anywhere.
//
// What a match shows, and does not (owner's clarification of C3-D5): the
// file has the same bytes as the imported one. It does not show that the
// file is official, or that its contents are correct.

export const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** The SHA-256 of the bytes, as 64 lowercase hex characters. */
export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("this browser cannot work out a file's fingerprint");
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type FingerprintResult =
  | { status: "SAME_BYTES"; actual: string }
  | { status: "DIFFERENT"; actual: string }
  | { status: "NO_FINGERPRINT" }
  | { status: "UNAVAILABLE"; reason: string };

/** Compares a chosen file with the imported document's stored fingerprint. */
export async function compareWithImported(file: Blob | ArrayBuffer | Uint8Array, expected: string | null | undefined): Promise<FingerprintResult> {
  if (!expected || !SHA256_HEX.test(expected)) return { status: "NO_FINGERPRINT" };
  let actual: string;
  try {
    actual = await sha256Hex(file);
  } catch (e) {
    return { status: "UNAVAILABLE", reason: e instanceof Error ? e.message : String(e) };
  }
  return actual === expected.toLowerCase() ? { status: "SAME_BYTES", actual } : { status: "DIFFERENT", actual };
}

/** The words the screen shows for a result: what a match proves, and what it does not. */
export function fingerprintMessage(r: FingerprintResult): string {
  switch (r.status) {
    case "SAME_BYTES": return "This is the same file that was imported: the same bytes. It does not show that the file is official, or that its contents are correct.";
    case "DIFFERENT": return "This is a different file from the one imported (another version, or another document).";
    case "NO_FINGERPRINT": return "There is no fingerprint of the imported file to compare with.";
    case "UNAVAILABLE": return `The file could not be checked here: ${r.reason}.`;
  }
}
