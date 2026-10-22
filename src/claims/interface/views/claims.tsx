import type { FC } from "hono/jsx";
import type { User } from "../../../types";
import { formatBytes, formatDateTime, formatRupiah } from "../../../views/format";
import { ErrorBox, FieldError, Layout } from "../../../views/Layout";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Claim,
  type ClaimAttachment,
  type ClaimEvent,
  type ClaimStatus,
  STATUS_LABELS,
  STATUSES,
} from "../../domain/claim";
import { allowedTransitions, canAttach, canDelete, canEdit } from "../../domain/policy";

export const StatusBadge: FC<{ status: ClaimStatus }> = ({ status }) => (
  <span class={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
);

export interface ClaimListFilters {
  status?: string;
  user_id?: string;
  month?: string;
}

export const ClaimListPage: FC<{
  user: User;
  claims: Claim[];
  totalAmount: number;
  nextCursor: string | null;
  filters: ClaimListFilters;
  salesUsers: User[];
  flash?: string;
}> = ({ user, claims, totalAmount, nextCursor, filters, salesUsers, flash }) => {
  const isAdmin = user.role === "admin";
  const nextParams = new URLSearchParams({
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    ...(nextCursor ? { cursor: nextCursor } : {}),
  });
  return (
    <Layout title="Klaim" user={user} flash={flash}>
      <h1>{isAdmin ? "Semua klaim" : "Klaim saya"}</h1>
      <form method="get" action="/claims" class="card grid">
        <div>
          <label for="status">Status</label>
          <select id="status" name="status">
            <option value="">Semua</option>
            {STATUSES.map((s) => (
              <option value={s} selected={filters.status === s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {isAdmin && (
          <div>
            <label for="user_id">Sales</label>
            <select id="user_id" name="user_id">
              <option value="">Semua</option>
              {salesUsers.map((u) => (
                <option value={u.id} selected={filters.user_id === u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label for="month">Bulan biaya</label>
          <input id="month" name="month" type="month" value={filters.month ?? ""} />
        </div>
        <div class="actions">
          <button type="submit">Filter</button>
          <a class="btn btn-secondary" href="/claims">
            Reset
          </a>
        </div>
      </form>
      <p>
        <a class="btn" href="/claims/new">
          + Ajukan klaim
        </a>{" "}
        <span class="muted">Total sesuai filter: {formatRupiah(totalAmount)}</span>
      </p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Judul</th>
              {isAdmin && <th>Sales</th>}
              <th>Kategori</th>
              <th class="num">Nominal</th>
              <th>Struk</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {claims.length === 0 && (
              <tr>
                <td colspan={isAdmin ? 7 : 6} class="muted">
                  Belum ada klaim.
                </td>
              </tr>
            )}
            {claims.map((c) => (
              <tr>
                <td>{c.expense_date}</td>
                <td>
                  <a href={`/claims/${c.id}`}>{c.title}</a>
                </td>
                {isAdmin && <td>{c.owner_name}</td>}
                <td>{CATEGORY_LABELS[c.category]}</td>
                <td class="num">{formatRupiah(c.amount)}</td>
                <td>{c.attachment_count > 0 ? "ada" : <span class="muted">belum</span>}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor && (
        <p>
          <a href={`/claims?${nextParams.toString()}`}>Halaman berikutnya →</a>
        </p>
      )}
    </Layout>
  );
};

export interface ClaimFormValues {
  title?: string;
  category?: string;
  expense_date?: string;
  amount?: string | number;
  description?: string;
  user_id?: string;
}

export const ClaimFormPage: FC<{
  user: User;
  mode: "new" | "edit";
  claimId?: string;
  values: ClaimFormValues;
  salesUsers: User[];
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}> = ({ user, mode, claimId, values, salesUsers, error, fieldErrors }) => (
  <Layout title={mode === "new" ? "Ajukan klaim" : "Ubah klaim"} user={user}>
    <h1>{mode === "new" ? "Ajukan klaim" : "Ubah klaim"}</h1>
    <ErrorBox message={error} />
    <form method="post" action={mode === "new" ? "/claims/new" : `/claims/${claimId}/edit`} class="card">
      {mode === "new" && user.role === "admin" && (
        <>
          <label for="user_id">Sales pemilik klaim</label>
          <select id="user_id" name="user_id" required>
            <option value="">Pilih sales…</option>
            {salesUsers.map((u) => (
              <option value={u.id} selected={values.user_id === u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors} name="user_id" />
        </>
      )}
      <label for="title">Judul</label>
      <input id="title" name="title" required maxlength={200} value={values.title ?? ""} />
      <FieldError errors={fieldErrors} name="title" />
      <div class="grid">
        <div>
          <label for="category">Kategori</label>
          <select id="category" name="category" required>
            {CATEGORIES.map((cat) => (
              <option value={cat} selected={values.category === cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors} name="category" />
        </div>
        <div>
          <label for="expense_date">Tanggal biaya</label>
          <input id="expense_date" name="expense_date" type="date" required value={values.expense_date ?? ""} />
          <FieldError errors={fieldErrors} name="expense_date" />
        </div>
        <div>
          <label for="amount">Nominal (Rp)</label>
          <input id="amount" name="amount" inputmode="numeric" required value={String(values.amount ?? "")} />
          <FieldError errors={fieldErrors} name="amount" />
        </div>
      </div>
      <label for="description">Keterangan</label>
      <textarea id="description" name="description" rows={4} maxlength={2000}>
        {values.description ?? ""}
      </textarea>
      <FieldError errors={fieldErrors} name="description" />
      <div class="actions">
        {mode === "new" ? (
          <>
            <button type="submit" name="intent" value="submit">
              Ajukan
            </button>
            <button type="submit" name="intent" value="draft" class="btn-secondary">
              Simpan draft
            </button>
          </>
        ) : (
          <button type="submit">Simpan</button>
        )}
        <a class="btn btn-secondary" href={claimId ? `/claims/${claimId}` : "/claims"}>
          Batal
        </a>
      </div>
    </form>
  </Layout>
);

const EVENT_LABELS: Record<string, string> = {
  created: "Dibuat",
  updated: "Diubah",
  submitted: "Diajukan",
  approved: "Disetujui",
  rejected: "Ditolak",
  paid: "Dibayar",
  deleted: "Dihapus",
  attachment_added: "Lampiran ditambahkan",
};

export const ClaimDetailPage: FC<{
  user: User;
  claim: Claim;
  attachments: ClaimAttachment[];
  events: ClaimEvent[];
  flash?: string;
  error?: string;
}> = ({ user, claim, attachments, events, flash, error }) => {
  const transitions = allowedTransitions(user, claim);
  return (
    <Layout title={claim.title} user={user} flash={flash}>
      <h1>
        {claim.title} <StatusBadge status={claim.status} />
      </h1>
      <ErrorBox message={error} />
      <div class="card">
        <dl>
          <dt>Sales</dt>
          <dd>
            {claim.owner_name} ({claim.owner_email})
          </dd>
          <dt>Kategori</dt>
          <dd>{CATEGORY_LABELS[claim.category]}</dd>
          <dt>Tanggal biaya</dt>
          <dd>{claim.expense_date}</dd>
          <dt>Nominal</dt>
          <dd>
            <strong>{formatRupiah(claim.amount)}</strong>
          </dd>
          <dt>Keterangan</dt>
          <dd>{claim.description || <span class="muted">-</span>}</dd>
          <dt>Diajukan</dt>
          <dd>{formatDateTime(claim.submitted_at)}</dd>
          {claim.decided_at && (
            <>
              <dt>Keputusan</dt>
              <dd>
                {formatDateTime(claim.decided_at)}
                {claim.decision_note && ` · ${claim.decision_note}`}
              </dd>
            </>
          )}
          {claim.paid_at && (
            <>
              <dt>Dibayar</dt>
              <dd>{formatDateTime(claim.paid_at)}</dd>
            </>
          )}
        </dl>
        <div class="actions">
          {canEdit(user, claim) && (
            <a class="btn btn-secondary" href={`/claims/${claim.id}/edit`}>
              Ubah
            </a>
          )}
          {transitions.includes("submit") && (
            <form method="post" action={`/claims/${claim.id}/submit`}>
              <button type="submit">Ajukan</button>
            </form>
          )}
          {transitions.includes("approve") && (
            <form method="post" action={`/claims/${claim.id}/approve`}>
              <button type="submit" class="btn-ok">
                Setujui
              </button>
            </form>
          )}
          {transitions.includes("pay") && (
            <form method="post" action={`/claims/${claim.id}/pay`}>
              <button type="submit" class="btn-ok">
                Tandai dibayar
              </button>
            </form>
          )}
          {canDelete(user, claim) && (
            <form method="post" action={`/claims/${claim.id}/delete`}>
              <button type="submit" class="btn-danger">
                Hapus
              </button>
            </form>
          )}
        </div>
        {transitions.includes("reject") && (
          <form method="post" action={`/claims/${claim.id}/reject`}>
            <label for="note">Alasan penolakan</label>
            <textarea id="note" name="note" rows={2} required maxlength={1000} />
            <div class="actions">
              <button type="submit" class="btn-danger">
                Tolak
              </button>
            </div>
          </form>
        )}
      </div>

      <h2>Lampiran</h2>
      <div class="card">
        {attachments.length === 0 ? (
          <p class="muted">Belum ada lampiran.</p>
        ) : (
          <ul>
            {attachments.map((a) => (
              <li>
                <a href={`/attachments/${a.id}`}>{a.filename}</a>{" "}
                <span class="muted">
                  ({formatBytes(a.size_bytes)}, {formatDateTime(a.created_at)})
                </span>
              </li>
            ))}
          </ul>
        )}
        {canAttach(user, claim) && (
          <form method="post" action={`/claims/${claim.id}/attachments`} enctype="multipart/form-data">
            <label for="file">Unggah bukti (PDF/JPEG/PNG, maks 5 MB)</label>
            <input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
            <div class="actions">
              <button type="submit">Unggah</button>
            </div>
          </form>
        )}
      </div>

      <h2>Riwayat</h2>
      <div class="table-scroll">
        <table>
          <tbody>
            {events.map((e) => (
              <tr>
                <td>{formatDateTime(e.created_at)}</td>
                <td>{EVENT_LABELS[e.action] ?? e.action}</td>
                <td>{e.actor_name}</td>
                <td class="muted">{e.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
};
