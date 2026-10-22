// Pintu masuk interface ke use case: validasi input mentah → use case → ClaimError dipetakan ke AppError.
// Dipakai route web/API dan oleh API in-process di src/claims/index.ts.
import * as attachments from "../application/attachments";
import * as commands from "../application/commands";
import type { AttachmentDeps } from "../application/ports";
import * as queries from "../application/queries";
import type { Actor } from "../domain/actor";
import type { Claim } from "../domain/claim";
import type { TransitionAction } from "../domain/transitions";
import { withAppErrors } from "./errors";
import { type ListFilters, validateClaimCreate, validateClaimUpdate, validateListFilters } from "./schemas";

export interface ClaimList {
  items: Claim[];
  next_cursor: string | null;
  total_amount: number;
}

export function claimService(deps: AttachmentDeps) {
  return {
    listClaims: withAppErrors(async (actor: Actor, rawFilters: ListFilters = {}): Promise<ClaimList> => {
      const page = await queries.listClaims(deps, actor, validateListFilters(rawFilters));
      return { items: page.items, next_cursor: page.nextCursor, total_amount: page.totalAmount };
    }),
    getClaim: withAppErrors((actor: Actor, id: string) => queries.getClaim(deps, actor, id)),
    getClaimDetail: withAppErrors((actor: Actor, id: string) => queries.getClaimDetail(deps, actor, id)),
    createClaim: withAppErrors(async (actor: Actor, rawInput: unknown) =>
      commands.createClaim(deps, actor, validateClaimCreate(rawInput)),
    ),
    updateClaim: withAppErrors(async (actor: Actor, id: string, rawPatch: unknown) =>
      commands.updateClaim(deps, actor, id, validateClaimUpdate(rawPatch)),
    ),
    transitionClaim: withAppErrors((actor: Actor, id: string, action: TransitionAction, note?: string) =>
      commands.transitionClaim(deps, actor, id, action, note),
    ),
    deleteClaim: withAppErrors((actor: Actor, id: string) => commands.deleteClaim(deps, actor, id)),
    addAttachment: withAppErrors((actor: Actor, claimId: string, file: attachments.UploadedFile) =>
      attachments.addAttachment(deps, actor, claimId, file),
    ),
    getAttachment: withAppErrors((actor: Actor, attachmentId: string, claimId?: string) =>
      attachments.getAttachment(deps, actor, attachmentId, claimId),
    ),
  };
}

export type ClaimService = ReturnType<typeof claimService>;

/** Membuat deps per request dari binding Worker; diisi composition root (src/claims/index.ts). */
export type DepsFactory = (env: Cloudflare.Env) => AttachmentDeps;
