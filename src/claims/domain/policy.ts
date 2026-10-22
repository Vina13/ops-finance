// Aturan akses klaim. Dipakai use case untuk otorisasi dan view untuk menampilkan/menyembunyikan tombol.
import type { Actor } from "./actor";
import type { Claim } from "./claim";
import { TRANSITIONS, type TransitionAction } from "./transitions";

export function canView(actor: Actor, claim: Pick<Claim, "user_id">): boolean {
  return actor.role === "admin" || claim.user_id === actor.id;
}

export function canEdit(actor: Actor, claim: Pick<Claim, "user_id" | "status">): boolean {
  if (actor.role === "admin") return claim.status === "draft" || claim.status === "submitted";
  return claim.user_id === actor.id && claim.status === "draft";
}

export function canDelete(actor: Actor, claim: Pick<Claim, "user_id" | "status">): boolean {
  if (actor.role === "admin") return claim.status !== "paid";
  return claim.user_id === actor.id && claim.status === "draft";
}

/** Sales boleh menambah struk sampai admin memutuskan (draft atau submitted). */
export function canAttach(actor: Actor, claim: Pick<Claim, "user_id" | "status">): boolean {
  if (actor.role === "admin") return claim.status !== "paid";
  return claim.user_id === actor.id && (claim.status === "draft" || claim.status === "submitted");
}

export function allowedTransitions(actor: Actor, claim: Pick<Claim, "user_id" | "status">): TransitionAction[] {
  if (!canView(actor, claim)) return [];
  return (Object.keys(TRANSITIONS) as TransitionAction[]).filter((action) => {
    const t = TRANSITIONS[action];
    return t.from === claim.status && (!t.adminOnly || actor.role === "admin");
  });
}
