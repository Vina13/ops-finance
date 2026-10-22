// Port yang dibutuhkan use case. Implementasi D1/R2 ada di infrastructure/, versi in-memory di test.
import type { Category, Claim, ClaimAttachment, ClaimEvent, ClaimStatus } from "../domain/claim";

export interface ClaimFilter {
  /** undefined = semua pemilik (hanya untuk admin). */
  userId?: string;
  status?: ClaimStatus;
  from?: string;
  to?: string;
}

export interface ClaimPage {
  items: Claim[];
  nextCursor: string | null;
  /** Total nominal semua klaim yang cocok dengan filter (bukan hanya halaman ini). */
  totalAmount: number;
}

export interface NewClaimRow {
  id: string;
  user_id: string;
  title: string;
  category: Category;
  expense_date: string;
  amount: number;
  description: string;
  status: ClaimStatus;
  submitted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface NewEvent {
  id: string;
  claim_id: string;
  actor_id: string;
  action: string;
  from_status?: ClaimStatus | null;
  to_status?: ClaimStatus | null;
  note?: string | null;
  created_at: string;
}

/** Kolom yang boleh diubah lewat update(); kunci lain diabaikan repository. */
export interface ClaimPatch {
  title?: string;
  category?: Category;
  expense_date?: string;
  amount?: number;
  description?: string;
  status?: ClaimStatus;
  submitted_at?: string;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string | null;
  paid_at?: string;
  deleted_at?: string;
  updated_at: string;
}

export interface ClaimRepository {
  /** Klaim yang belum dihapus, atau null. */
  findById(id: string): Promise<Claim | null>;
  list(filter: ClaimFilter, page: { limit: number; cursor?: string }): Promise<ClaimPage>;
  listAttachments(claimId: string): Promise<ClaimAttachment[]>;
  listEvents(claimId: string): Promise<ClaimEvent[]>;
  /** Menyimpan klaim baru beserta event-nya secara atomik. */
  insert(row: NewClaimRow, events: NewEvent[]): Promise<void>;
  /**
   * Update terjaga: hanya berhasil bila klaim belum dihapus dan statusnya masih `expectedStatus`.
   * Event ditulis dalam transaksi yang sama, hanya jika baris benar-benar berubah.
   */
  update(id: string, expectedStatus: ClaimStatus, patch: ClaimPatch, event: NewEvent): Promise<"ok" | "stale">;
  /** true jika user ada, ber-role sales, dan aktif (pemilik sah klaim yang dibuat admin). */
  isActiveSales(userId: string): Promise<boolean>;
}

export interface Clock {
  /** Waktu sekarang sebagai ISO-8601 UTC. */
  now(): string;
}

export interface IdGenerator {
  newId(): string;
}

export interface ClaimDeps {
  claims: ClaimRepository;
  clock: Clock;
  ids: IdGenerator;
}
