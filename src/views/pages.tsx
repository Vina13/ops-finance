import type { FC } from "hono/jsx";
import type { ApiTokenRow } from "../auth/apiToken";
import { SCOPES, type User } from "../types";
import { formatDateTime } from "./format";
import { ErrorBox, FieldError, Layout } from "./Layout";

export const LoginPage: FC<{ email?: string; next?: string; error?: string }> = ({ email, next, error }) => (
  <Layout title="Masuk">
    <h1>Masuk</h1>
    <ErrorBox message={error} />
    <form method="post" action="/login" class="card" style="max-width:420px">
      <input type="hidden" name="next" value={next ?? ""} />
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required value={email ?? ""} />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <div class="actions">
        <button type="submit">Masuk</button>
      </div>
    </form>
  </Layout>
);

export const UsersPage: FC<{ user: User; users: User[]; flash?: string }> = ({ user, users, flash }) => (
  <Layout title="User" user={user} flash={flash}>
    <h1>User</h1>
    <p>
      <a class="btn" href="/admin/users/new">
        + Tambah user
      </a>
    </p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role === "admin" ? "Admin" : "Sales"}</td>
              <td>{u.is_active ? "Aktif" : <span class="muted">Nonaktif</span>}</td>
              <td>
                <a href={`/admin/users/${u.id}/edit`}>Ubah</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Layout>
);

export interface UserFormValues {
  email?: string;
  name?: string;
  role?: string;
  is_active?: boolean;
}

export const UserFormPage: FC<{
  user: User;
  target?: User;
  values: UserFormValues;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}> = ({ user, target, values, error, fieldErrors }) => (
  <Layout title={target ? "Ubah user" : "Tambah user"} user={user}>
    <h1>{target ? `Ubah user: ${target.email}` : "Tambah user"}</h1>
    <ErrorBox message={error} />
    <form method="post" action={target ? `/admin/users/${target.id}/edit` : "/admin/users/new"} class="card">
      {!target && (
        <>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required value={values.email ?? ""} />
          <FieldError errors={fieldErrors} name="email" />
        </>
      )}
      <label for="name">Nama</label>
      <input id="name" name="name" required value={values.name ?? ""} />
      <FieldError errors={fieldErrors} name="name" />
      <label for="role">Role</label>
      <select id="role" name="role">
        <option value="sales" selected={values.role !== "admin"}>
          Sales
        </option>
        <option value="admin" selected={values.role === "admin"}>
          Admin
        </option>
      </select>
      <label for="password">{target ? "Reset password (kosongkan jika tidak diubah)" : "Password awal"}</label>
      <input id="password" name="password" type="password" autocomplete="new-password" required={!target} minlength={10} />
      <FieldError errors={fieldErrors} name="password" />
      {target && (
        <label>
          <input type="checkbox" name="is_active" value="1" checked={values.is_active} /> Aktif
        </label>
      )}
      <div class="actions">
        <button type="submit">Simpan</button>
        <a class="btn btn-secondary" href="/admin/users">
          Batal
        </a>
      </div>
    </form>
  </Layout>
);

export const TokensPage: FC<{
  user: User;
  tokens: ApiTokenRow[];
  newToken?: string;
  flash?: string;
  error?: string;
}> = ({ user, tokens, newToken, flash, error }) => (
  <Layout title="Token API" user={user} flash={flash}>
    <h1>Token API</h1>
    {newToken && (
      <div class="card">
        <strong>Token baru. Salin sekarang, token ini tidak akan ditampilkan lagi:</strong>
        <p class="token" id="new-token">
          {newToken}
        </p>
        <p class="muted">
          Pakai sebagai header <code>Authorization: Bearer &lt;token&gt;</code> ke <code>/api/…</code>
        </p>
      </div>
    )}
    <ErrorBox message={error} />
    <form method="post" action="/settings/tokens" class="card">
      <h2 style="margin-top:0">Buat token</h2>
      <label for="name">Nama (mis. "Integrasi spreadsheet")</label>
      <input id="name" name="name" required maxlength={100} />
      <label>Scope</label>
      {SCOPES.map((s) => (
        <label style="font-weight:400">
          <input type="checkbox" name="scopes" value={s} checked={s === "claims:read"} /> <code>{s}</code>
        </label>
      ))}
      <label for="expires_in_days">Kedaluwarsa</label>
      <select id="expires_in_days" name="expires_in_days">
        <option value="30">30 hari</option>
        <option value="90" selected>
          90 hari
        </option>
        <option value="365">1 tahun</option>
        <option value="">Tidak pernah</option>
      </select>
      <div class="actions">
        <button type="submit">Buat token</button>
      </div>
    </form>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Prefix</th>
            <th>Scope</th>
            <th>Dipakai terakhir</th>
            <th>Kedaluwarsa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 && (
            <tr>
              <td colspan={6} class="muted">
                Belum ada token.
              </td>
            </tr>
          )}
          {tokens.map((t) => (
            <tr>
              <td>{t.name}</td>
              <td>
                <code>opsf_{t.token_prefix}_…</code>
              </td>
              <td>{t.scopes}</td>
              <td>{formatDateTime(t.last_used_at)}</td>
              <td>{t.expires_at ? formatDateTime(t.expires_at) : "Tidak pernah"}</td>
              <td>
                {t.revoked_at ? (
                  <span class="muted">Dicabut</span>
                ) : (
                  <form method="post" action={`/settings/tokens/${t.id}/revoke`}>
                    <button type="submit" class="btn-danger">
                      Cabut
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Layout>
);

export const PasswordPage: FC<{ user: User; error?: string; flash?: string }> = ({ user, error, flash }) => (
  <Layout title="Ganti password" user={user} flash={flash}>
    <h1>Ganti password</h1>
    <ErrorBox message={error} />
    <form method="post" action="/settings/password" class="card" style="max-width:420px">
      <label for="current_password">Password lama</label>
      <input id="current_password" name="current_password" type="password" autocomplete="current-password" required />
      <label for="new_password">Password baru (min. 10 karakter)</label>
      <input id="new_password" name="new_password" type="password" autocomplete="new-password" required minlength={10} />
      <div class="actions">
        <button type="submit">Simpan</button>
      </div>
    </form>
  </Layout>
);
