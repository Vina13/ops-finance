export type Env = Cloudflare.Env;

export type Role = "admin" | "sales";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export const SCOPES = ["claims:read", "claims:write"] as const;
export type Scope = (typeof SCOPES)[number];

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    /** Hanya diisi untuk request API yang memakai token. */
    scopes: Scope[];
  };
};
