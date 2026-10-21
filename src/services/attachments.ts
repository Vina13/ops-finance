import { AppError, conflict, notFound } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { type Actor, canAttach, type ClaimAttachment, getClaim, STATUS_LABELS } from "./claims";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/** Nama file aman untuk disimpan dan untuk header Content-Disposition. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "lampiran";
}

export async function addAttachment(
  db: D1Database,
  bucket: R2Bucket,
  actor: Actor,
  claimId: string,
  file: File,
): Promise<ClaimAttachment> {
  const claim = await getClaim(db, actor, claimId);
  if (!canAttach(actor, claim)) {
    throw conflict(`Lampiran tidak bisa ditambahkan ke klaim berstatus ${STATUS_LABELS[claim.status]}`);
  }
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    throw new AppError(415, "unsupported_media_type", "Lampiran harus PDF, JPEG, atau PNG");
  }
  if (file.size === 0) throw new AppError(400, "validation", "File kosong");
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AppError(413, "payload_too_large", "Ukuran lampiran maksimal 5 MB");
  }

  const attachment: ClaimAttachment = {
    id: newId(),
    claim_id: claimId,
    filename: sanitizeFilename(file.name),
    content_type: file.type,
    size_bytes: file.size,
    uploaded_by: actor.id,
    created_at: nowIso(),
  };
  const key = `claims/${claimId}/${attachment.id}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO claim_attachments (id, claim_id, r2_key, filename, content_type, size_bytes, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attachment.id,
          claimId,
          key,
          attachment.filename,
          attachment.content_type,
          attachment.size_bytes,
          actor.id,
          attachment.created_at,
        ),
      db
        .prepare(
          `INSERT INTO claim_events (id, claim_id, actor_id, action, note, created_at)
           VALUES (?, ?, ?, 'attachment_added', ?, ?)`,
        )
        .bind(newId(), claimId, actor.id, attachment.filename, attachment.created_at),
    ]);
  } catch (err) {
    // Jangan tinggalkan objek yatim di R2 jika metadata gagal disimpan.
    await bucket.delete(key);
    throw err;
  }
  return attachment;
}

/** Mengambil lampiran beserta isinya; akses mengikuti hak lihat klaim induknya. */
export async function getAttachment(
  db: D1Database,
  bucket: R2Bucket,
  actor: Actor,
  attachmentId: string,
  claimId?: string,
): Promise<{ attachment: ClaimAttachment; body: R2ObjectBody }> {
  const row = await db
    .prepare(
      `SELECT id, claim_id, r2_key, filename, content_type, size_bytes, uploaded_by, created_at
       FROM claim_attachments WHERE id = ?`,
    )
    .bind(attachmentId)
    .first<ClaimAttachment & { r2_key: string }>();
  if (!row || (claimId && row.claim_id !== claimId)) throw notFound("Lampiran");
  try {
    await getClaim(db, actor, row.claim_id);
  } catch {
    throw notFound("Lampiran");
  }
  const body = await bucket.get(row.r2_key);
  if (!body) throw notFound("Lampiran");
  const { r2_key: _key, ...attachment } = row;
  return { attachment, body };
}

export function attachmentResponse(attachment: ClaimAttachment, body: R2ObjectBody): Response {
  return new Response(body.body, {
    headers: {
      "Content-Type": attachment.content_type,
      "Content-Length": String(attachment.size_bytes),
      "Content-Disposition": `attachment; filename="${attachment.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
