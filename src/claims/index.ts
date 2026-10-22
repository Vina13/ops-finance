// Composition root dan API publik modul klaim. Kode di luar src/claims hanya mengimpor file ini
// (atau src/claims/schemas.ts untuk skema saja). Lihat docs/adr/0001-claims-feature-module.md.
import type { AttachmentDeps, AttachmentStorage } from "./application/ports";
import type { UploadedFile } from "./application/attachments";
import type { Actor } from "./domain/actor";
import type { TransitionAction } from "./domain/transitions";
import { d1AttachmentRepository, r2AttachmentStorage } from "./infrastructure/attachmentAdapters";
import { d1ClaimRepository, systemClock, uuidIds } from "./infrastructure/d1ClaimRepository";
import { claimsApiRoutes } from "./interface/api";
import type { ListFilters } from "./interface/schemas";
import { claimService } from "./interface/service";
import { claimsWebRoutes } from "./interface/web";

const noStorage: AttachmentStorage = {
  put: () => Promise.reject(new Error("BUCKET tidak tersedia")),
  get: () => Promise.reject(new Error("BUCKET tidak tersedia")),
  delete: () => Promise.reject(new Error("BUCKET tidak tersedia")),
};

/** Merangkai adapter D1/R2 ke port use case. */
export function claimDeps(db: D1Database, bucket?: R2Bucket): AttachmentDeps {
  return {
    claims: d1ClaimRepository(db),
    attachments: d1AttachmentRepository(db),
    storage: bucket ? r2AttachmentStorage(bucket) : noStorage,
    clock: systemClock,
    ids: uuidIds,
  };
}

const depsFromEnv = (env: Cloudflare.Env) => claimDeps(env.DB, env.BUCKET);

/** Route /api/claims/* (pasang di bawah /api setelah requireToken). */
export const claimsApi = claimsApiRoutes(depsFromEnv);
/** Route /claims/*, /attachments/* (pasang di bawah requireSession). */
export const claimsWeb = claimsWebRoutes(depsFromEnv);

// --- API in-process (validasi + use case + AppError), dipakai test dan modul lain ----------------

export const listClaims = (db: D1Database, actor: Actor, filters?: ListFilters) =>
  claimService(claimDeps(db)).listClaims(actor, filters);
export const getClaim = (db: D1Database, actor: Actor, id: string) => claimService(claimDeps(db)).getClaim(actor, id);
export const getClaimDetail = (db: D1Database, actor: Actor, id: string) =>
  claimService(claimDeps(db)).getClaimDetail(actor, id);
export const createClaim = (db: D1Database, actor: Actor, input: unknown) =>
  claimService(claimDeps(db)).createClaim(actor, input);
export const updateClaim = (db: D1Database, actor: Actor, id: string, patch: unknown) =>
  claimService(claimDeps(db)).updateClaim(actor, id, patch);
export const transitionClaim = (db: D1Database, actor: Actor, id: string, action: TransitionAction, note?: string) =>
  claimService(claimDeps(db)).transitionClaim(actor, id, action, note);
export const deleteClaim = (db: D1Database, actor: Actor, id: string) => claimService(claimDeps(db)).deleteClaim(actor, id);
export const addAttachment = (db: D1Database, bucket: R2Bucket, actor: Actor, claimId: string, file: UploadedFile) =>
  claimService(claimDeps(db, bucket)).addAttachment(actor, claimId, file);
export const getAttachment = (db: D1Database, bucket: R2Bucket, actor: Actor, attachmentId: string, claimId?: string) =>
  claimService(claimDeps(db, bucket)).getAttachment(actor, attachmentId, claimId);

// --- Tipe dan konstanta publik ------------------------------------------------------------------

export type { Actor } from "./domain/actor";
export { ALLOWED_CONTENT_TYPES, MAX_ATTACHMENT_BYTES, sanitizeFilename } from "./domain/attachment";
export {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  type Claim,
  type ClaimAttachment,
  type ClaimEvent,
  type ClaimStatus,
  MAX_AMOUNT,
  STATUS_LABELS,
  STATUSES,
} from "./domain/claim";
export { allowedTransitions, canAttach, canDelete, canEdit, canView } from "./domain/policy";
export type { TransitionAction } from "./domain/transitions";
export * from "./schemas";
