import type { Child, FC } from "hono/jsx";
import type { User } from "../types";

const CSS = `
:root { --bg:#f6f7f9; --fg:#1d2330; --muted:#5d6675; --line:#d9dee5; --card:#fff; --accent:#1f5fbf; --danger:#b42318; --ok:#067647; }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
header { background:#14213d; color:#fff; padding:0 16px; }
header .wrap { display:flex; gap:16px; align-items:center; min-height:52px; flex-wrap:wrap; }
header a { color:#fff; text-decoration:none; } header nav { display:flex; gap:14px; flex:1; flex-wrap:wrap; }
header form { margin:0; } header button { background:transparent; color:#fff; border:1px solid #ffffff55; }
.wrap { max-width:1080px; margin:0 auto; } main { padding:20px 16px 48px; }
h1 { font-size:22px; margin:0 0 16px; } h2 { font-size:17px; margin:24px 0 8px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; }
table { width:100%; border-collapse:collapse; background:var(--card); }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:13px; color:var(--muted); font-weight:600; } td.num, th.num { text-align:right; white-space:nowrap; }
.table-scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; }
label { display:block; font-weight:600; margin:12px 0 4px; }
input, select, textarea { width:100%; padding:8px; border:1px solid var(--line); border-radius:6px; font:inherit; background:#fff; }
input[type=checkbox] { width:auto; }
button, .btn { display:inline-block; padding:8px 14px; border-radius:6px; border:1px solid var(--accent); background:var(--accent); color:#fff; font:inherit; cursor:pointer; text-decoration:none; }
.btn-secondary { background:#fff; color:var(--accent); } .btn-danger { background:var(--danger); border-color:var(--danger); }
.btn-ok { background:var(--ok); border-color:var(--ok); }
.actions { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-top:16px; } .actions form { margin:0; }
.badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; background:#eef1f5; }
.badge-submitted { background:#fff4d6; } .badge-approved { background:#dff6e8; } .badge-rejected { background:#fde4e2; } .badge-paid { background:#dde9fb; }
.flash { padding:10px 12px; border-radius:6px; background:#dff6e8; margin-bottom:16px; }
.error { padding:10px 12px; border-radius:6px; background:#fde4e2; color:var(--danger); margin-bottom:16px; }
.field-error { color:var(--danger); font-size:13px; margin-top:2px; }
.muted { color:var(--muted); } .grid { display:grid; gap:0 16px; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); }
.token { font-family:ui-monospace, Consolas, monospace; word-break:break-all; background:#fff8e1; padding:10px; border-radius:6px; border:1px solid #f0d58c; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; margin:0; } dt { color:var(--muted); }
`;

export const FLASH_MESSAGES: Record<string, string> = {
  created: "Klaim dibuat.",
  updated: "Klaim diperbarui.",
  deleted: "Klaim dihapus.",
  submitted: "Klaim diajukan.",
  approved: "Klaim disetujui.",
  rejected: "Klaim ditolak.",
  paid: "Klaim ditandai dibayar.",
  attached: "Lampiran diunggah.",
  user_saved: "User disimpan.",
  token_revoked: "Token dicabut.",
  password_changed: "Password diganti.",
};

export const Layout: FC<{ title: string; user?: User; flash?: string; children?: Child }> = ({
  title,
  user,
  flash,
  children,
}) => {
  const flashText = flash ? FLASH_MESSAGES[flash] : undefined;
  return (
    <html lang="id">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Klaim Biaya Ops Sales`}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>
          <div class="wrap">
            <a href="/claims">
              <strong>Klaim Biaya</strong>
            </a>
            {user && (
              <>
                <nav>
                  <a href="/claims">Klaim</a>
                  <a href="/claims/new">Ajukan klaim</a>
                  {user.role === "admin" && <a href="/admin/users">User</a>}
                  <a href="/settings/tokens">Token API</a>
                  <a href="/settings/password">Password</a>
                </nav>
                <span>
                  {user.name} ({user.role === "admin" ? "Admin" : "Sales"})
                </span>
                <form method="post" action="/logout">
                  <button type="submit">Keluar</button>
                </form>
              </>
            )}
          </div>
        </header>
        <main class="wrap">
          {flashText && <div class="flash">{flashText}</div>}
          {children}
        </main>
      </body>
    </html>
  );
};

export const ErrorBox: FC<{ message?: string }> = ({ message }) => (message ? <div class="error">{message}</div> : null);

export const FieldError: FC<{ errors?: Record<string, string[] | undefined>; name: string }> = ({ errors, name }) => {
  const msg = errors?.[name]?.[0];
  return msg ? <div class="field-error">{msg}</div> : null;
};

export const ErrorPage: FC<{ status: number; message: string; user?: User }> = ({ status, message, user }) => (
  <Layout title={`Error ${status}`} user={user}>
    <h1>{status === 404 ? "Tidak ditemukan" : status === 403 ? "Akses ditolak" : "Terjadi kesalahan"}</h1>
    <div class="error">{message}</div>
    <a href="/claims">Kembali ke daftar klaim</a>
  </Layout>
);
