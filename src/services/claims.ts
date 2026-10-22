// Facade sementara (TRD R1–R5): validasi input → use case src/claims/application → error HTTP.
import * as commands from "../claims/application/commands";
import type { ClaimDeps } from "../claims/application/ports";
import * as queries from "../claims/application/queries";
import type { Actor } from "../claims/domain/actor";
import type { Claim, ClaimAttachment, ClaimEvent } from "../claims/domain/claim";
import type { TransitionAction } from "../claims/domain/transitions";
import { d1ClaimRepository, systemClock, uuidIds } from "../claims/infrastructure/d1ClaimRepository";
import { withAppErrors } from "../claims/interface/errors";
import { type ListFilters, validateClaimCreate, validateClaimUpdate, validateListFilters } from "../validate";

export type { Actor } from "../claims/domain/actor";
export {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  type Claim,
  type ClaimAttachment,
  type ClaimEvent,
  type ClaimStatus,
  STATUS_LABELS,
  STATUSES,
} from "../claims/domain/claim";
export { allowedTransitions, canAttach, canDelete, canEdit, canView } from "../claims/domain/policy";
export type { TransitionAction } from "../claims/domain/transitions";
export type { ClaimCreateInput, ClaimUpdateInput, ListFilters } from "../validate";

export const claimDeps = (db: D1Database): ClaimDeps => ({ claims: d1ClaimRepository(db), clock: systemClock, ids: uuidIds });

export const listClaims = withAppErrors(
  async (
    db: D1Database,
    actor: Actor,
    rawFilters: ListFilters = {},
  ): Promise<{ items: Claim[]; next_cursor: string | null; total_amount: number }> => {
    const page = await queries.listClaims(claimDeps(db), actor, validateListFilters(rawFilters));
    return { items: page.items, next_cursor: page.nextCursor, total_amount: page.totalAmount };
  },
);

export const getClaim = withAppErrors(
  (db: D1Database, actor: Actor, id: string): Promise<Claim> => queries.getClaim(claimDeps(db), actor, id),
);

export const getClaimDetail = withAppErrors(
  (db: D1Database, actor: Actor, id: string): Promise<{ claim: Claim; attachments: ClaimAttachment[]; events: ClaimEvent[] }> =>
    queries.getClaimDetail(claimDeps(db), actor, id),
);

export const createClaim = withAppErrors(
  async (db: D1Database, actor: Actor, rawInput: unknown): Promise<Claim> =>
    commands.createClaim(claimDeps(db), actor, validateClaimCreate(rawInput)),
);

export const updateClaim = withAppErrors(
  async (db: D1Database, actor: Actor, id: string, rawPatch: unknown): Promise<Claim> =>
    commands.updateClaim(claimDeps(db), actor, id, validateClaimUpdate(rawPatch)),
);

export const transitionClaim = withAppErrors(
  (db: D1Database, actor: Actor, id: string, action: TransitionAction, note?: string): Promise<Claim> =>
    commands.transitionClaim(claimDeps(db), actor, id, action, note),
);

/** Soft delete: klaim tetap ada di DB untuk audit, tapi hilang dari daftar. */
export const deleteClaim = withAppErrors(
  (db: D1Database, actor: Actor, id: string): Promise<void> => commands.deleteClaim(claimDeps(db), actor, id),
);
