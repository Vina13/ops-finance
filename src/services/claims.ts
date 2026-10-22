// Facade sementara (TRD R1–R5): domain di src/claims/domain, SQL di src/claims/infrastructure.
import type { ClaimRepository } from "../claims/application/ports";
import type { Actor } from "../claims/domain/actor";
import { type Claim, type ClaimAttachment, type ClaimEvent, STATUS_LABELS } from "../claims/domain/claim";
import { canDelete, canEdit, canView } from "../claims/domain/policy";
import { ACTION_EVENT, TRANSITIONS, type TransitionAction } from "../claims/domain/transitions";
import { d1ClaimRepository } from "../claims/infrastructure/d1ClaimRepository";
import { withAppErrors } from "../claims/interface/errors";
import { conflict, forbidden, notFound, validation } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
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

export const listClaims = withAppErrors(async function listClaims(
  db: D1Database,
  actor: Actor,
  rawFilters: ListFilters = {},
): Promise<{ items: Claim[]; next_cursor: string | null; total_amount: number }> {
  const filters = validateListFilters(rawFilters);
  // Sales selalu dibatasi ke klaim miliknya, apa pun filter yang dikirim.
  const userId = actor.role === "admin" ? filters.user_id : actor.id;
  const page = await d1ClaimRepository(db).list(
    { userId, status: filters.status, from: filters.from, to: filters.to },
    { limit: filters.limit, cursor: filters.cursor },
  );
  return { items: page.items, next_cursor: page.nextCursor, total_amount: page.totalAmount };
});

async function loadVisible(repo: ClaimRepository, actor: Actor, id: string): Promise<Claim> {
  const claim = await repo.findById(id);
  if (!claim || !canView(actor, claim)) throw notFound("Klaim");
  return claim;
}

/** Klaim yang tidak boleh dilihat actor dianggap tidak ada (404), bukan 403. */
export async function getClaim(db: D1Database, actor: Actor, id: string): Promise<Claim> {
  return loadVisible(d1ClaimRepository(db), actor, id);
}

export async function getClaimDetail(
  db: D1Database,
  actor: Actor,
  id: string,
): Promise<{ claim: Claim; attachments: ClaimAttachment[]; events: ClaimEvent[] }> {
  const repo = d1ClaimRepository(db);
  const claim = await loadVisible(repo, actor, id);
  const [attachments, events] = await Promise.all([repo.listAttachments(id), repo.listEvents(id)]);
  return { claim, attachments, events };
}

export async function createClaim(db: D1Database, actor: Actor, rawInput: unknown): Promise<Claim> {
  const input = validateClaimCreate(rawInput);
  const repo = d1ClaimRepository(db);

  let ownerId = actor.id;
  if (actor.role === "admin") {
    if (!input.user_id) throw validation("Pilih sales pemilik klaim", { user_id: ["Wajib diisi"] });
    if (!(await repo.isActiveSales(input.user_id))) {
      throw validation("Sales tidak ditemukan atau nonaktif", { user_id: ["Tidak valid"] });
    }
    ownerId = input.user_id;
  }

  const id = newId();
  const now = nowIso();
  await repo.insert(
    {
      id,
      user_id: ownerId,
      title: input.title,
      category: input.category,
      expense_date: input.expense_date,
      amount: input.amount,
      description: input.description,
      status: input.submit ? "submitted" : "draft",
      submitted_at: input.submit ? now : null,
      created_by: actor.id,
      created_at: now,
      updated_at: now,
    },
    [
      { id: newId(), claim_id: id, actor_id: actor.id, action: "created", to_status: "draft", created_at: now },
      ...(input.submit
        ? [
            {
              id: newId(),
              claim_id: id,
              actor_id: actor.id,
              action: "submitted",
              from_status: "draft" as const,
              to_status: "submitted" as const,
              created_at: now,
            },
          ]
        : []),
    ],
  );
  return loadVisible(repo, actor, id);
}

export async function updateClaim(db: D1Database, actor: Actor, id: string, rawPatch: unknown): Promise<Claim> {
  const patch = validateClaimUpdate(rawPatch);
  const repo = d1ClaimRepository(db);
  const claim = await loadVisible(repo, actor, id);
  if (!canEdit(actor, claim)) throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa diubah`);

  const fields = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
  const now = nowIso();
  const result = await repo.update(id, claim.status, { ...patch, updated_at: now }, {
    id: newId(),
    claim_id: id,
    actor_id: actor.id,
    action: "updated",
    note: `Field: ${fields.join(", ")}`,
    created_at: now,
  });
  if (result !== "ok") throw conflict("Klaim sudah berubah, muat ulang lalu coba lagi");
  return loadVisible(repo, actor, id);
}

export async function transitionClaim(
  db: D1Database,
  actor: Actor,
  id: string,
  action: TransitionAction,
  note?: string,
): Promise<Claim> {
  const t = TRANSITIONS[action];
  const repo = d1ClaimRepository(db);
  const claim = await loadVisible(repo, actor, id);
  if (t.adminOnly && actor.role !== "admin") throw forbidden("Hanya admin yang bisa melakukan aksi ini");
  if (claim.status !== t.from) {
    throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa di-${action}`);
  }
  const cleanNote = note?.trim() || null;
  if (action === "reject" && !cleanNote) throw validation("Alasan penolakan wajib diisi", { note: ["Wajib diisi"] });

  const now = nowIso();
  const extra =
    action === "submit"
      ? { submitted_at: now }
      : action === "pay"
        ? { paid_at: now }
        : { decided_by: actor.id, decided_at: now, decision_note: cleanNote };
  const result = await repo.update(id, t.from, { status: t.to, ...extra, updated_at: now }, {
    id: newId(),
    claim_id: id,
    actor_id: actor.id,
    action: ACTION_EVENT[action],
    from_status: t.from,
    to_status: t.to,
    note: cleanNote,
    created_at: now,
  });
  if (result !== "ok") throw conflict("Status klaim sudah berubah, muat ulang lalu coba lagi");
  return loadVisible(repo, actor, id);
}

/** Soft delete: klaim tetap ada di DB untuk audit, tapi hilang dari daftar. */
export async function deleteClaim(db: D1Database, actor: Actor, id: string): Promise<void> {
  const repo = d1ClaimRepository(db);
  const claim = await loadVisible(repo, actor, id);
  if (!canDelete(actor, claim)) throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa dihapus`);
  const now = nowIso();
  const result = await repo.update(id, claim.status, { deleted_at: now, updated_at: now }, {
    id: newId(),
    claim_id: id,
    actor_id: actor.id,
    action: "deleted",
    from_status: claim.status,
    created_at: now,
  });
  if (result !== "ok") throw conflict("Klaim sudah berubah, muat ulang lalu coba lagi");
}
