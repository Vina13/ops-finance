// Adapter D1 (metadata lampiran) dan R2 (isi file) untuk port lampiran.
import type { AttachmentRepository, AttachmentStorage, StoredAttachment } from "../application/ports";

export function d1AttachmentRepository(db: D1Database): AttachmentRepository {
  return {
    async findById(id) {
      return db
        .prepare(
          `SELECT id, claim_id, r2_key AS storage_key, filename, content_type, size_bytes, uploaded_by, created_at
           FROM claim_attachments WHERE id = ?`,
        )
        .bind(id)
        .first<StoredAttachment>();
    },

    async insert(a, event) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO claim_attachments (id, claim_id, r2_key, filename, content_type, size_bytes, uploaded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(a.id, a.claim_id, a.storage_key, a.filename, a.content_type, a.size_bytes, a.uploaded_by, a.created_at),
        db
          .prepare(
            `INSERT INTO claim_events (id, claim_id, actor_id, action, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(event.id, event.claim_id, event.actor_id, event.action, event.note ?? null, event.created_at),
      ]);
    },
  };
}

export function r2AttachmentStorage(bucket: R2Bucket): AttachmentStorage {
  return {
    async put(key, data, contentType) {
      await bucket.put(key, data, { httpMetadata: { contentType } });
    },
    async get(key) {
      return (await bucket.get(key))?.body ?? null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
