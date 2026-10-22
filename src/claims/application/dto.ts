// Input use case yang sudah divalidasi oleh lapisan interface (interface/schemas.ts).
import type { Category, ClaimStatus } from "../domain/claim";

export interface CreateClaimInput {
  title: string;
  category: Category;
  expense_date: string;
  amount: number;
  description: string;
  /** Wajib untuk admin (klaim atas nama sales), diabaikan untuk sales. */
  user_id?: string;
  /** true = langsung diajukan (status submitted). */
  submit: boolean;
}

export interface UpdateClaimInput {
  title?: string;
  category?: Category;
  expense_date?: string;
  amount?: number;
  description?: string;
}

export interface ListClaimsQuery {
  status?: ClaimStatus;
  user_id?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}
