// Facade sementara (TRD R1–R5): isi domain sudah pindah ke src/claims/domain.
import type { Actor } from "../claims/domain/actor";
import { type ClaimAttachment, type ClaimEvent, type Claim, type ClaimStatus, STATUS_LABELS } from "../claims/domain/claim";
import { canDelete, canEdit, canView } from "../claims/domain/policy";
import { ACTION_EVENT, TRANSITIONS, type TransitionAction } from "../claims/domain/transitions";
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

// --- Query -----------------------------------------------------------------

const CLAIM_SELECT = `
  SELECT c.id, c.user_id, u.name AS owner_name, u.email AS owner_email, c.title, c.category,
         c.expense_date, c.amount, c.currency, c.description, c.status, c.submitted_at,
         c.decided_by, c.decided_at, c.decision_note, c.paid_at, c.created_by, c.created_at, c.updated_at,
         (SELECT COUNT(*) FROM claim_attachments a WHERE a.claim_id = c.id) AS attachment_count
  FROM claims c JOIN users u ON u.id = c.user_id`;

function encodeCursor(claim: Pick<Claim, "created_at" | "id">): string {
  return btoa(`${claim.created_at}|${claim.id}`);
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const [createdAt, id] = atob(cursor).split("|");
    if (createdAt && id) return [createdAt, id];
  } catch {
    // jatuh ke error di bawah
  }
  throw validation("Cursor tidak valid");
}

export async function listClaims(
  db: D1Database,
  actor: Actor,
  rawFilters: ListFilters = {},
): Promise<{ items: Claim[]; next_cursor: string | null; total_amount: number }> {
  const filters = validateListFilters(rawFilters);
  const where = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];

  // Sales selalu dibatasi ke klaim miliknya, apa pun filter yang dikirim.
  const userId = actor.role === "admin" ? filters.user_id : actor.id;
  if (userId) {
    where.push("c.user_id = ?");
    params.push(userId);
  }
  if (filters.status) {
    where.push("c.status = ?");
    params.push(filters.status);
  }
  if (filters.from) {
    where.push("c.expense_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("c.expense_date <= ?");
    params.push(filters.to);
  }
  const baseWhere = where.join(" AND ");
  const baseParams = [...params];

  if (filters.cursor) {
    const [createdAt, id] = decodeCursor(filters.cursor);
    where.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
    params.push(createdAt, createdAt, id);
  }

  const [page, total] = await db.batch([
    db
      .prepare(`${CLAIM_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
      .bind(...params, filters.limit + 1),
    db.prepare(`SELECT COALESCE(SUM(c.amount), 0) AS total FROM claims c WHERE ${baseWhere}`).bind(...baseParams),
  ]);
  const rows = (page?.results ?? []) as Claim[];
  const items = rows.slice(0, filters.limit);
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: rows.length > filters.limit && last ? encodeCursor(last) : null,
    total_amount: ((total?.results?.[0] as { total: number } | undefined)?.total ?? 0) as number,
  };
}

/** Klaim yang tidak boleh dilihat actor dianggap tidak ada (404), bukan 403. */
export async function getClaim(db: D1Database, actor: Actor, id: string): Promise<Claim> {
  const claim = await db.prepare(`${CLAIM_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL`).bind(id).first<Claim>();
  if (!claim || !canView(actor, claim)) throw notFound("Klaim");
  return claim;
}

export async function getClaimDetail(
  db: D1Database,
  actor: Actor,
  id: string,
): Promise<{ claim: Claim; attachments: ClaimAttachment[]; events: ClaimEvent[] }> {
  const claim = await getClaim(db, actor, id);
  const [attachments, events] = await db.batch([
    db
      .prepare(
        `SELECT id, claim_id, filename, content_type, size_bytes, uploaded_by, created_at
         FROM claim_attachments WHERE claim_id = ? ORDER BY created_at`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT e.id, e.action, e.from_status, e.to_status, e.note, e.actor_id, u.name AS actor_name, e.created_at
         FROM claim_events e JOIN users u ON u.id = e.actor_id
         WHERE e.claim_id = ? ORDER BY e.created_at, e.rowid`,
      )
      .bind(id),
  ]);
  return {
    claim,
    attachments: (attachments?.results ?? []) as ClaimAttachment[],
    events: (events?.results ?? []) as ClaimEvent[],
  };
}

function eventStmt(
  db: D1Database,
  e: { claimId: string; actorId: string; action: string; from?: ClaimStatus | null; to?: ClaimStatus | null; note?: string | null; at: string },
) {
  return db
    .prepare(
      `INSERT INTO claim_events (id, claim_id, actor_id, action, from_status, to_status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), e.claimId, e.actorId, e.action, e.from ?? null, e.to ?? null, e.note ?? null, e.at);
}

/**
 * Event yang hanya ditulis bila statement sebelumnya di batch yang sama benar-benar mengubah baris.
 * D1 menjalankan batch dalam satu transaksi, jadi `changes()` merujuk ke UPDATE tepat sebelumnya.
 */
function eventIfChangedStmt(
  db: D1Database,
  e: { claimId: string; actorId: string; action: string; from?: ClaimStatus | null; to?: ClaimStatus | null; note?: string | null; at: string },
) {
  return db
    .prepare(
      `INSERT INTO claim_events (id, claim_id, actor_id, action, from_status, to_status, note, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    )
    .bind(newId(), e.claimId, e.actorId, e.action, e.from ?? null, e.to ?? null, e.note ?? null, e.at);
}

export async function createClaim(db: D1Database, actor: Actor, rawInput: unknown): Promise<Claim> {
  const input = validateClaimCreate(rawInput);

  let ownerId = actor.id;
  if (actor.role === "admin") {
    if (!input.user_id) throw validation("Pilih sales pemilik klaim", { user_id: ["Wajib diisi"] });
    const owner = await db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'sales' AND is_active = 1")
      .bind(input.user_id)
      .first();
    if (!owner) throw validation("Sales tidak ditemukan atau nonaktif", { user_id: ["Tidak valid"] });
    ownerId = input.user_id;
  }

  const id = newId();
  const now = nowIso();
  const status: ClaimStatus = input.submit ? "submitted" : "draft";
  const stmts = [
    db
      .prepare(
        `INSERT INTO claims (id, user_id, title, category, expense_date, amount, description, status,
                             submitted_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        ownerId,
        input.title,
        input.category,
        input.expense_date,
        input.amount,
        input.description,
        status,
        input.submit ? now : null,
        actor.id,
        now,
        now,
      ),
    eventStmt(db, { claimId: id, actorId: actor.id, action: "created", to: "draft", at: now }),
  ];
  if (input.submit) {
    stmts.push(eventStmt(db, { claimId: id, actorId: actor.id, action: "submitted", from: "draft", to: "submitted", at: now }));
  }
  await db.batch(stmts);
  return getClaim(db, actor, id);
}

export async function updateClaim(db: D1Database, actor: Actor, id: string, rawPatch: unknown): Promise<Claim> {
  const patch = validateClaimUpdate(rawPatch);

  const claim = await getClaim(db, actor, id);
  if (!canEdit(actor, claim)) throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa diubah`);

  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const now = nowIso();
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  const res = await db.batch([
    db
      .prepare(`UPDATE claims SET ${sets}, updated_at = ? WHERE id = ? AND status = ? AND deleted_at IS NULL`)
      .bind(...entries.map(([, v]) => v), now, id, claim.status),
    eventIfChangedStmt(db, {
      claimId: id,
      actorId: actor.id,
      action: "updated",
      note: `Field: ${entries.map(([k]) => k).join(", ")}`,
      at: now,
    }),
  ]);
  if (res[0]?.meta.changes !== 1) throw conflict("Klaim sudah berubah, muat ulang lalu coba lagi");
  return getClaim(db, actor, id);
}

export async function transitionClaim(
  db: D1Database,
  actor: Actor,
  id: string,
  action: TransitionAction,
  note?: string,
): Promise<Claim> {
  const t = TRANSITIONS[action];
  const claim = await getClaim(db, actor, id);
  if (t.adminOnly && actor.role !== "admin") throw forbidden("Hanya admin yang bisa melakukan aksi ini");
  if (claim.status !== t.from) {
    throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa di-${action}`);
  }
  const cleanNote = note?.trim() || null;
  if (action === "reject" && !cleanNote) throw validation("Alasan penolakan wajib diisi", { note: ["Wajib diisi"] });

  const now = nowIso();
  const extra =
    action === "submit"
      ? { sql: "submitted_at = ?", params: [now] }
      : action === "pay"
        ? { sql: "paid_at = ?", params: [now] }
        : { sql: "decided_by = ?, decided_at = ?, decision_note = ?", params: [actor.id, now, cleanNote] };

  const res = await db.batch([
    db
      .prepare(
        `UPDATE claims SET status = ?, ${extra.sql}, updated_at = ?
         WHERE id = ? AND status = ? AND deleted_at IS NULL`,
      )
      .bind(t.to, ...extra.params, now, id, t.from),
    eventIfChangedStmt(db, {
      claimId: id,
      actorId: actor.id,
      action: ACTION_EVENT[action],
      from: t.from,
      to: t.to,
      note: cleanNote,
      at: now,
    }),
  ]);
  if (res[0]?.meta.changes !== 1) throw conflict("Status klaim sudah berubah, muat ulang lalu coba lagi");
  return getClaim(db, actor, id);
}

/** Soft delete: klaim tetap ada di DB untuk audit, tapi hilang dari daftar. */
export async function deleteClaim(db: D1Database, actor: Actor, id: string): Promise<void> {
  const claim = await getClaim(db, actor, id);
  if (!canDelete(actor, claim)) throw conflict(`Klaim berstatus ${STATUS_LABELS[claim.status]} tidak bisa dihapus`);
  const now = nowIso();
  const res = await db.batch([
    db
      .prepare("UPDATE claims SET deleted_at = ?, updated_at = ? WHERE id = ? AND status = ? AND deleted_at IS NULL")
      .bind(now, now, id, claim.status),
    eventIfChangedStmt(db, { claimId: id, actorId: actor.id, action: "deleted", from: claim.status, at: now }),
  ]);
  if (res[0]?.meta.changes !== 1) throw conflict("Klaim sudah berubah, muat ulang lalu coba lagi");
}
