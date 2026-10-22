// Satu-satunya "identitas" yang dikenal modul klaim. User dari src/types cocok secara struktural.
export type Role = "admin" | "sales";

export interface Actor {
  id: string;
  role: Role;
}
