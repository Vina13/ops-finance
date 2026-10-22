// Entitas dan konstanta klaim. Daftar kategori/status harus sama dengan CHECK di migrations/0001_init.sql.

export const CATEGORIES = ["transport", "meal", "lodging", "entertainment", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;
export type ClaimStatus = (typeof STATUSES)[number];

/** Nominal maksimum satu klaim, dalam rupiah. */
export const MAX_AMOUNT = 1_000_000_000_000;

export interface Claim {
  id: string;
  user_id: string;
  owner_name: string;
  owner_email: string;
  title: string;
  category: Category;
  expense_date: string;
  amount: number;
  currency: string;
  description: string;
  status: ClaimStatus;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  paid_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Jumlah lampiran/struk; 0 berarti belum ada bukti. */
  attachment_count: number;
}

export interface ClaimAttachment {
  id: string;
  claim_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

export interface ClaimEvent {
  id: string;
  action: string;
  from_status: ClaimStatus | null;
  to_status: ClaimStatus | null;
  note: string | null;
  actor_id: string;
  actor_name: string;
  created_at: string;
}

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Diajukan",
  approved: "Disetujui",
  rejected: "Ditolak",
  paid: "Dibayar",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  transport: "Transportasi",
  meal: "Makan",
  lodging: "Penginapan",
  entertainment: "Entertainment",
  other: "Lainnya",
};
