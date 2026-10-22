// Facade sementara (TRD R4–R5): use case di src/claims/application/attachments.ts, adapter D1/R2 di infrastructure.
import * as attachments from "../claims/application/attachments";
import type { AttachmentDeps } from "../claims/application/ports";
import type { Actor } from "../claims/domain/actor";
import type { ClaimAttachment } from "../claims/domain/claim";
import { d1AttachmentRepository, r2AttachmentStorage } from "../claims/infrastructure/attachmentAdapters";
import { withAppErrors } from "../claims/interface/errors";
import { claimDeps } from "./claims";

export { ALLOWED_CONTENT_TYPES, MAX_ATTACHMENT_BYTES, sanitizeFilename } from "../claims/domain/attachment";
export { attachmentResponse } from "../claims/interface/attachmentResponse";

const attachmentDeps = (db: D1Database, bucket: R2Bucket): AttachmentDeps => ({
  ...claimDeps(db),
  attachments: d1AttachmentRepository(db),
  storage: r2AttachmentStorage(bucket),
});

export const addAttachment = withAppErrors(
  (db: D1Database, bucket: R2Bucket, actor: Actor, claimId: string, file: File): Promise<ClaimAttachment> =>
    attachments.addAttachment(attachmentDeps(db, bucket), actor, claimId, file),
);

/** Mengambil lampiran beserta isinya; akses mengikuti hak lihat klaim induknya. */
export const getAttachment = withAppErrors(
  (
    db: D1Database,
    bucket: R2Bucket,
    actor: Actor,
    attachmentId: string,
    claimId?: string,
  ): Promise<{ attachment: ClaimAttachment; body: ReadableStream }> =>
    attachments.getAttachment(attachmentDeps(db, bucket), actor, attachmentId, claimId),
);
