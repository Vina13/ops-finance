// Use case yang mengubah klaim. Semua aturan akses dan state machine dicek di sini (atau di domain).
import type { Actor } from "../domain/actor";
import { type Claim, STATUS_LABELS } from "../domain/claim";
import { conflict, forbidden, invalid } from "../domain/errors";
import { canDelete, canEdit } from "../domain/policy";
import { ACTION_EVENT, TRANSITIONS, type TransitionAction } from "../domain/transitions";
import type { CreateClaimInput, UpdateClaimInput } from "./dto";
import type { ClaimDeps, ClaimPatch, NewEvent } from "./ports";
import { loadVisibleClaim } from "./queries";

export async function createClaim(deps: ClaimDeps, actor: Actor, input: CreateClaimInput): Promise<Claim> {
  let ownerId = actor.id;
  if (actor.role === "admin") {
    if (!input.user_id) throw invalid("Pilih sales pemilik klaim", { user_id: ["Wajib diisi"] });
    if (!(await deps.claims.isActiveSales(input.user_id))) {
      throw invalid("Sales tidak ditemukan atau nonaktif", { user_id: ["Tidak valid"] });
    }
    ownerId = input.user_id;
  }

  const id = deps.ids.newId();
  const now = deps.clock.now();
  const events: NewEvent[] = [
    { id: deps.ids.newId(), claim_id: id, actor_id: actor.id, action: "created", to_status: "draft", created_at: now },
  ];
  if (input.submit) {
    events.push({
      id: deps.ids.newId(),
      claim_id: id,
      actor_id: actor.id,
      action: "submitted",
      from_status: "draft",
      to_status: "submitted",
      created_at: now,
    });
  }
  await deps.claims.insert(
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
    events,
  );
  return loadVisibleClaim(deps.claims, actor, id);
}

export async function updateClaim(deps: ClaimDeps, actor: Actor, id: string, patch: UpdateClaimInput): Promise<Claim> {
  const claim = await loadVisibleClaim(deps.claims, actor, id);
  if (!canEdit(actor, claim)) throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa diubah`);

  const fields = (Object.keys(patch) as (keyof UpdateClaimInput)[]).filter((k) => patch[k] !== undefined);
  const now = deps.clock.now();
  const result = await deps.claims.update(id, claim.status, { ...patch, updated_at: now }, {
    id: deps.ids.newId(),
    claim_id: id,
    actor_id: actor.id,
    action: "updated",
    note: `Field: ${fields.join(", ")}`,
    created_at: now,
  });
  if (result !== "ok") throw conflict("Klaim sudah berubah, muat ulang lalu coba lagi");
  return loadVisibleClaim(deps.claims, actor, id);
}

export async function transitionClaim(
  deps: ClaimDeps,
  actor: Actor,
  id: string,
  action: TransitionAction,
  note?: string,
): Promise<Claim> {
  const t = TRANSITIONS[action];
  const claim = await loadVisibleClaim(deps.claims, actor, id);
  if (t.adminOnly && actor.role !== "admin") throw forbidden("Hanya admin yang bisa melakukan aksi ini");
  if (claim.status !== t.from) {
    throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa di-${action}`);
  }
  const cleanNote = note?.trim() || null;
  if (action === "reject" && !cleanNote) throw invalid("Alasan penolakan wajib diisi", { note: ["Wajib diisi"] });

  const now = deps.clock.now();
  const patch: ClaimPatch =
    action === "submit"
      ? { status: t.to, submitted_at: now, updated_at: now }
      : action === "pay"
        ? { status: t.to, paid_at: now, updated_at: now }
        : { status: t.to, decided_by: actor.id, decided_at: now, decision_note: cleanNote, updated_at: now };
  const result = await deps.claims.update(id, t.from, patch, {
    id: deps.ids.newId(),
    claim_id: id,
    actor_id: actor.id,
    action: ACTION_EVENT[action],
    from_status: t.from,
    to_status: t.to,
    note: cleanNote,
    created_at: now,
  });
  if (result !== "ok") throw conflict("Status klaim sudah berubah, muat ulang lalu coba lagi");
  return loadVisibleClaim(deps.claims, actor, id);
}

/** Soft delete: klaim tetap ada di DB untuk audit, tapi hilang dari daftar. */
export async function deleteClaim(deps: ClaimDeps, actor: Actor, id: string): Promise<void> {
  const claim = await loadVisibleClaim(deps.claims, actor, id);
  if (!canDelete(actor, claim)) throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa dihapus`);
  const now = deps.clock.now();
  const result = await deps.claims.update(id, claim.status, { deleted_at: now, updated_at: now }, {
    id: deps.ids.newId(),
    claim_id: id,
    actor_id: actor.id,
    action: "deleted",
    from_status: claim.status,
    created_at: now,
  });
  if (result !== "ok") throw conflict("Klaim sudah berubah, muat ulang lalu coba lagi");
}
