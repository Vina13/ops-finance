// Adapter D1 untuk ClaimRepository. Satu-satunya tempat SQL klaim; selalu prepare().bind().
import type { ClaimFilter, ClaimPage, ClaimPatch, ClaimRepository, Clock, IdGenerator, NewClaimRow, NewEvent } from "../application/ports";
import type { Claim, ClaimAttachment, ClaimEvent } from "../domain/claim";
import { invalid } from "../domain/errors";

const CLAIM_SELECT = `
  SELECT c.id, c.user_id, u.name AS owner_name, u.email AS owner_email, c.title, c.category,
         c.expense_date, c.amount, c.currency, c.description, c.status, c.submitted_at,
         c.decided_by, c.decided_at, c.decision_note, c.paid_at, c.created_by, c.created_at, c.updated_at,
         (SELECT COUNT(*) FROM claim_attachments a WHERE a.claim_id = c.id) AS attachment_count
  FROM claims c JOIN users u ON u.id = c.user_id`;

/** Whitelist kolom untuk update(); nama kolom tidak pernah berasal dari input pengguna. */
const PATCHABLE = [
  "title",
  "category",
  "expense_date",
  "amount",
  "description",
  "status",
  "submitted_at",
  "decided_by",
  "decided_at",
  "decision_note",
  "paid_at",
  "deleted_at",
] as const satisfies readonly (keyof ClaimPatch)[];

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
  throw invalid("Cursor tidak valid");
}

function eventStmt(db: D1Database, e: NewEvent) {
  return db
    .prepare(
      `INSERT INTO claim_events (id, claim_id, actor_id, action, from_status, to_status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(e.id, e.claim_id, e.actor_id, e.action, e.from_status ?? null, e.to_status ?? null, e.note ?? null, e.created_at);
}

/**
 * Event yang hanya ditulis bila statement sebelumnya di batch yang sama benar-benar mengubah baris.
 * D1 menjalankan batch dalam satu transaksi, jadi `changes()` merujuk ke UPDATE tepat sebelumnya.
 */
function eventIfChangedStmt(db: D1Database, e: NewEvent) {
  return db
    .prepare(
      `INSERT INTO claim_events (id, claim_id, actor_id, action, from_status, to_status, note, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    )
    .bind(e.id, e.claim_id, e.actor_id, e.action, e.from_status ?? null, e.to_status ?? null, e.note ?? null, e.created_at);
}

export function d1ClaimRepository(db: D1Database): ClaimRepository {
  return {
    async findById(id) {
      return db.prepare(`${CLAIM_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL`).bind(id).first<Claim>();
    },

    async list(filter: ClaimFilter, page): Promise<ClaimPage> {
      const where = ["c.deleted_at IS NULL"];
      const params: unknown[] = [];
      if (filter.userId) {
        where.push("c.user_id = ?");
        params.push(filter.userId);
      }
      if (filter.status) {
        where.push("c.status = ?");
        params.push(filter.status);
      }
      if (filter.from) {
        where.push("c.expense_date >= ?");
        params.push(filter.from);
      }
      if (filter.to) {
        where.push("c.expense_date <= ?");
        params.push(filter.to);
      }
      const baseWhere = where.join(" AND ");
      const baseParams = [...params];

      if (page.cursor) {
        const [createdAt, id] = decodeCursor(page.cursor);
        where.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
        params.push(createdAt, createdAt, id);
      }

      const [rowsRes, totalRes] = await db.batch([
        db
          .prepare(`${CLAIM_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
          .bind(...params, page.limit + 1),
        db.prepare(`SELECT COALESCE(SUM(c.amount), 0) AS total FROM claims c WHERE ${baseWhere}`).bind(...baseParams),
      ]);
      const rows = (rowsRes?.results ?? []) as Claim[];
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: rows.length > page.limit && last ? encodeCursor(last) : null,
        totalAmount: (totalRes?.results?.[0] as { total: number } | undefined)?.total ?? 0,
      };
    },

    async listAttachments(claimId) {
      const { results } = await db
        .prepare(
          `SELECT id, claim_id, filename, content_type, size_bytes, uploaded_by, created_at
           FROM claim_attachments WHERE claim_id = ? ORDER BY created_at`,
        )
        .bind(claimId)
        .all<ClaimAttachment>();
      return results;
    },

    async listEvents(claimId) {
      const { results } = await db
        .prepare(
          `SELECT e.id, e.action, e.from_status, e.to_status, e.note, e.actor_id, u.name AS actor_name, e.created_at
           FROM claim_events e JOIN users u ON u.id = e.actor_id
           WHERE e.claim_id = ? ORDER BY e.created_at, e.rowid`,
        )
        .bind(claimId)
        .all<ClaimEvent>();
      return results;
    },

    async insert(row: NewClaimRow, events) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO claims (id, user_id, title, category, expense_date, amount, description, status,
                                 submitted_at, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.id,
            row.user_id,
            row.title,
            row.category,
            row.expense_date,
            row.amount,
            row.description,
            row.status,
            row.submitted_at,
            row.created_by,
            row.created_at,
            row.updated_at,
          ),
        ...events.map((e) => eventStmt(db, e)),
      ]);
    },

    async update(id, expectedStatus, patch, event) {
      const columns = PATCHABLE.filter((k) => patch[k] !== undefined);
      const sets = [...columns.map((k) => `${k} = ?`), "updated_at = ?"].join(", ");
      const res = await db.batch([
        db
          .prepare(`UPDATE claims SET ${sets} WHERE id = ? AND status = ? AND deleted_at IS NULL`)
          .bind(...columns.map((k) => patch[k] ?? null), patch.updated_at, id, expectedStatus),
        eventIfChangedStmt(db, event),
      ]);
      return res[0]?.meta.changes === 1 ? "ok" : "stale";
    },

    async isActiveSales(userId) {
      const row = await db
        .prepare("SELECT id FROM users WHERE id = ? AND role = 'sales' AND is_active = 1")
        .bind(userId)
        .first();
      return row !== null;
    },
  };
}

export const systemClock: Clock = { now: () => new Date().toISOString() };
export const uuidIds: IdGenerator = { newId: () => crypto.randomUUID() };
