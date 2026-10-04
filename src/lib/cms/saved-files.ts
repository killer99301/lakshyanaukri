// ═══════════════════════════════════════════════════════════
// Saved copies of official documents (results, answer keys, cut-offs)
// ═══════════════════════════════════════════════════════════
//
// Rules shared by the admin upload button and the server route that issues
// upload tokens. Pure — safe to import on either side.
//
// Only PDFs, only under documents/<job-slug>/, only up to MAX_SAVED_FILE_BYTES.
// Files are public once uploaded: never upload anything personal to one
// candidate (admit cards, response sheets, scorecards behind a login).

export const MAX_SAVED_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SAVED_FILE_LABEL = "25 MB";
export const SAVED_FILE_CONTENT_TYPE = "application/pdf";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A lower-case, hyphenated file name ending in .pdf, from whatever the file was called. */
export function cleanPdfName(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "");
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${cleaned || "document"}.pdf`;
}

/** Where a job's saved file is stored: documents/<job-slug>/<file>.pdf */
export function savedFilePath(jobSlug: string, filename: string): string {
  if (!SAFE_SLUG.test(jobSlug)) throw new Error("Saved file: the job has no usable slug");
  return `documents/${jobSlug}/${cleanPdfName(filename)}`;
}

/** The server accepts an upload only to a path savedFilePath could have produced. */
export function isAllowedSavedFilePath(pathname: string): boolean {
  const parts = pathname.split("/");
  if (parts.length !== 3 || parts[0] !== "documents") return false;
  return SAFE_SLUG.test(parts[1]) && /^[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$/.test(parts[2]) && parts[2].length <= 84;
}

/** Why a chosen file cannot be uploaded, or null if it can. `head` is its first bytes. */
export function savedFileProblem(file: { name: string; size: number }, head: Uint8Array): string | null {
  if (!/\.pdf$/i.test(file.name)) return "Only PDF files can be uploaded.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_SAVED_FILE_BYTES) return `That file is larger than ${MAX_SAVED_FILE_LABEL}.`;
  // Every PDF starts with "%PDF-".
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (head.length < magic.length || magic.some((byte, i) => head[i] !== byte)) {
    return "That file is not a real PDF.";
  }
  return null;
}
