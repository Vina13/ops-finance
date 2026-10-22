import type { Actor } from "../domain/actor";
import type { Claim, ClaimAttachment, ClaimEvent } from "../domain/claim";
import { notFound } from "../domain/errors";
import { canView } from "../domain/policy";
import type { ListClaimsQuery } from "./dto";
import type { ClaimDeps, ClaimPage, ClaimRepository } from "./ports";

/** Klaim yang tidak boleh dilihat actor dianggap tidak ada (404), bukan 403. */
export async function loadVisibleClaim(repo: ClaimRepository, actor: Actor, id: string): Promise<Claim> {
  const claim = await repo.findById(id);
  if (!claim || !canView(actor, claim)) throw notFound("Klaim");
  return claim;
}

export function getClaim(deps: Pick<ClaimDeps, "claims">, actor: Actor, id: string): Promise<Claim> {
  return loadVisibleClaim(deps.claims, actor, id);
}

export async function getClaimDetail(
  deps: Pick<ClaimDeps, "claims">,
  actor: Actor,
  id: string,
): Promise<{ claim: Claim; attachments: ClaimAttachment[]; events: ClaimEvent[] }> {
  const claim = await loadVisibleClaim(deps.claims, actor, id);
  const [attachments, events] = await Promise.all([deps.claims.listAttachments(id), deps.claims.listEvents(id)]);
  return { claim, attachments, events };
}

export function listClaims(deps: Pick<ClaimDeps, "claims">, actor: Actor, query: ListClaimsQuery): Promise<ClaimPage> {
  // Sales selalu dibatasi ke klaim miliknya, apa pun filter yang dikirim.
  const userId = actor.role === "admin" ? query.user_id : actor.id;
  return deps.claims.list(
    { userId, status: query.status, from: query.from, to: query.to },
    { limit: query.limit, cursor: query.cursor },
  );
}
