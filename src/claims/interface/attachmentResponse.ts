import type { ClaimAttachment } from "../domain/claim";

/** Respons unduhan lampiran: selalu `attachment`, nosniff, tidak di-cache. */
export function attachmentResponse(attachment: ClaimAttachment, body: ReadableStream): Response {
  return new Response(body, {
    headers: {
      "Content-Type": attachment.content_type,
      "Content-Length": String(attachment.size_bytes),
      "Content-Disposition": `attachment; filename="${attachment.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
