// Aturan lampiran/struk klaim.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/** Nama file aman untuk disimpan dan untuk header Content-Disposition. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "lampiran";
}

/** Kunci objek penyimpanan; dibuat server, tidak pernah dari nama file klien. */
export const attachmentKey = (claimId: string, attachmentId: string) => `claims/${claimId}/${attachmentId}`;
