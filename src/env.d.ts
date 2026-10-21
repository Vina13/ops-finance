// Binding Worker. Disamakan dengan wrangler.jsonc.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
  }
}
