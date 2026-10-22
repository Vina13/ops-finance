// ClaimRepository in-memory untuk unit test use case tanpa D1. Meniru perilaku adapter D1
// (soft delete, update terjaga per status, event hanya saat baris berubah, urutan created_at DESC).
import type { ClaimDeps, ClaimPatch, ClaimRepository, NewClaimRow, NewEvent } from "../../src/claims/application/ports";
import type { Claim, ClaimEvent } from "../../src/claims/domain/claim";
import { invalid } from "../../src/claims/domain/errors";

interface Row extends NewClaimRow {
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  paid_at: string | null;
  deleted_at: string | null;
}

export function inMemoryClaims(sales: string[] = []) {
  const rows = new Map<string, Row>();
  const events: NewEvent[] = [];
  const activeSales = new Set(sales);

  const toClaim = (r: Row): Claim => {
    const { deleted_at: _d, ...rest } = r;
    return { ...rest, owner_name: r.user_id, owner_email: `${r.user_id}@test`, currency: "IDR", attachment_count: 0 };
  };

  const repo: ClaimRepository = {
    async findById(id) {
      const r = rows.get(id);
      return r && !r.deleted_at ? toClaim(r) : null;
    },
    async list(filter, page) {
      if (page.cursor) throw invalid("Cursor tidak valid");
      const all = [...rows.values()]
        .filter(
          (r) =>
            !r.deleted_at &&
            (!filter.userId || r.user_id === filter.userId) &&
            (!filter.status || r.status === filter.status) &&
            (!filter.from || r.expense_date >= filter.from) &&
            (!filter.to || r.expense_date <= filter.to),
        )
        .sort((a, b) => (a.created_at === b.created_at ? b.id.localeCompare(a.id) : b.created_at.localeCompare(a.created_at)));
      return {
        items: all.slice(0, page.limit).map(toClaim),
        nextCursor: null,
        totalAmount: all.reduce((sum, r) => sum + r.amount, 0),
      };
    },
    async listAttachments() {
      return [];
    },
    async listEvents(claimId) {
      return events
        .filter((e) => e.claim_id === claimId)
        .map((e): ClaimEvent => ({
          id: e.id,
          action: e.action,
          from_status: e.from_status ?? null,
          to_status: e.to_status ?? null,
          note: e.note ?? null,
          actor_id: e.actor_id,
          actor_name: e.actor_id,
          created_at: e.created_at,
        }));
    },
    async insert(row, newEvents) {
      rows.set(row.id, { ...row, decided_by: null, decided_at: null, decision_note: null, paid_at: null, deleted_at: null });
      events.push(...newEvents);
    },
    async update(id, expectedStatus, patch: ClaimPatch, event) {
      const r = rows.get(id);
      if (!r || r.deleted_at || r.status !== expectedStatus) return "stale";
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      rows.set(id, { ...r, ...defined });
      events.push(event);
      return "ok";
    },
    async isActiveSales(userId) {
      return activeSales.has(userId);
    },
  };

  let seq = 0;
  let tick = 0;
  const deps: ClaimDeps = {
    claims: repo,
    ids: { newId: () => `id-${String(++seq).padStart(4, "0")}` },
    clock: { now: () => new Date(Date.UTC(2026, 9, 22, 0, 0, tick++)).toISOString() },
  };
  return { deps, rows, events };
}
