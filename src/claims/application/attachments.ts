import type { Actor } from "../domain/actor";
import { ALLOWED_CONTENT_TYPES, attachmentKey, MAX_ATTACHMENT_BYTES, sanitizeFilename } from "../domain/attachment";
import { type ClaimAttachment, STATUS_LABELS } from "../domain/claim";
import { ClaimError, conflict, invalid, notFound } from "../domain/errors";
import { canAttach } from "../domain/policy";
import type { AttachmentDeps } from "./ports";
import { loadVisibleClaim } from "./queries";

/** Bentuk file yang dibutuhkan use case; `File` dari Web API cocok secara struktural. */
export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function addAttachment(
  deps: AttachmentDeps,
  actor: Actor,
  claimId: string,
  file: UploadedFile,
): Promise<ClaimAttachment> {
  const claim = await loadVisibleClaim(deps.claims, actor, claimId);
  if (!canAttach(actor, claim)) {
    throw conflict(`Lampiran tidak bisa ditambahkan ke klaim berstatus ${STATUS_LABELS[claim.status]}`);
  }
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    throw new ClaimError("unsupported_media_type", "Lampiran harus PDF, JPEG, atau PNG");
  }
  if (file.size === 0) throw invalid("File kosong");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new ClaimError("payload_too_large", "Ukuran lampiran maksimal 5 MB");

  const attachment: ClaimAttachment = {
    id: deps.ids.newId(),
    claim_id: claimId,
    filename: sanitizeFilename(file.name),
    content_type: file.type,
    size_bytes: file.size,
    uploaded_by: actor.id,
    created_at: deps.clock.now(),
  };
  const key = attachmentKey(claimId, attachment.id);
  await deps.storage.put(key, await file.arrayBuffer(), file.type);
  try {
    await deps.attachments.insert(
      { ...attachment, storage_key: key },
      {
        id: deps.ids.newId(),
        claim_id: claimId,
        actor_id: actor.id,
        action: "attachment_added",
        note: attachment.filename,
        created_at: attachment.created_at,
      },
    );
  } catch (err) {
    // Jangan tinggalkan objek yatim di penyimpanan jika metadata gagal disimpan.
    await deps.storage.delete(key);
    throw err;
  }
  return attachment;
}

/** Mengambil lampiran beserta isinya; akses mengikuti hak lihat klaim induknya. */
export async function getAttachment(
  deps: AttachmentDeps,
  actor: Actor,
  attachmentId: string,
  claimId?: string,
): Promise<{ attachment: ClaimAttachment; body: ReadableStream }> {
  const row = await deps.attachments.findById(attachmentId);
  if (!row || (claimId && row.claim_id !== claimId)) throw notFound("Lampiran");
  try {
    await loadVisibleClaim(deps.claims, actor, row.claim_id);
  } catch {
    throw notFound("Lampiran");
  }
  const body = await deps.storage.get(row.storage_key);
  if (!body) throw notFound("Lampiran");
  const { storage_key: _key, ...attachment } = row;
  return { attachment, body };
}
