// Menegakkan aturan dependensi modul src/claims (docs/adr/0001-claims-feature-module.md, docs/TRD.md A1).
// Test berjalan di runtime Workers (tanpa fs), jadi sumber file dibaca lewat import.meta.glob ?raw.
import { describe, expect, it } from "vitest";

/** Kode di luar modul hanya boleh mengimpor pintu masuk publik ini. */
const PUBLIC_ENTRIES = ["src/claims/index.ts", "src/claims/schemas.ts"];

const claimFiles = import.meta.glob<string>("/src/claims/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const outsideFiles = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/claims/**", "/mcp/**/*.ts", "/test/**/*.ts", "!/test/claims/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((m) => (m[1] ?? m[2]) as string);
}

/** Resolusi path relatif → path repo tanpa ekstensi, mis. "src/claims/domain/claim". */
function resolve(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const parts = fromFile.replace(/^\//, "").split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/").replace(/\.(ts|tsx)$/, "");
}

const layerOf = (path: string) => /^src\/claims\/(domain|application|infrastructure|interface)\//.exec(path)?.[1] ?? null;

/** Lapisan yang boleh diimpor per lapisan (impor dalam lapisan sendiri selalu boleh). */
const ALLOWED_LAYERS: Record<string, string[]> = {
  domain: [],
  application: ["domain"],
  infrastructure: ["domain", "application"],
  interface: ["domain", "application"],
};
/** Paket npm yang boleh dipakai per lapisan; domain dan application harus bebas framework. */
const ALLOWED_PACKAGES: Record<string, RegExp> = {
  domain: /^$/,
  application: /^$/,
  infrastructure: /^$/,
  interface: /^(hono(\/.*)?|zod)$/,
};

function violations(): string[] {
  const out: string[] = [];
  for (const [file, source] of Object.entries(claimFiles)) {
    const path = file.replace(/^\//, "");
    const layer = layerOf(path);
    if (!layer) continue; // index.ts / schemas.ts = composition root dan entry publik, bebas
    for (const spec of importsOf(source)) {
      const target = resolve(path, spec);
      if (target === null) {
        if (!ALLOWED_PACKAGES[layer]!.test(spec)) out.push(`${path}: paket "${spec}" dilarang di ${layer}/`);
        continue;
      }
      const targetLayer = layerOf(`${target}/`) ?? layerOf(target);
      if (!target.startsWith("src/claims/")) {
        // Keluar modul: domain & application tidak boleh sama sekali.
        if (layer === "domain" || layer === "application") out.push(`${path}: impor keluar modul "${spec}" dilarang di ${layer}/`);
        continue;
      }
      if (targetLayer && targetLayer !== layer && !ALLOWED_LAYERS[layer]!.includes(targetLayer)) {
        out.push(`${path}: ${layer}/ tidak boleh mengimpor ${targetLayer}/ ("${spec}")`);
      }
      if (!targetLayer && layer !== null) {
        out.push(`${path}: lapisan dalam tidak boleh mengimpor composition root ("${spec}")`);
      }
    }
  }
  for (const [file, source] of Object.entries(outsideFiles)) {
    const path = file.replace(/^\//, "");
    for (const spec of importsOf(source)) {
      const target = resolve(path, spec);
      if (target?.startsWith("src/claims/") && !PUBLIC_ENTRIES.includes(`${target}.ts`)) {
        out.push(`${path}: impor internal modul "${spec}" (pakai src/claims/index.ts atau schemas.ts)`);
      }
    }
  }
  return out;
}

describe("batas modul src/claims", () => {
  it("parser impor mengenali bentuk import/export yang dipakai repo", () => {
    expect(importsOf(`import { a } from "./x";\nimport type { B } from '../y';\nexport { c } from "./z";\nimport "./side";`)).toEqual([
      "./x",
      "../y",
      "./z",
      "./side",
    ]);
    expect(resolve("src/claims/interface/api.ts", "../domain/claim")).toBe("src/claims/domain/claim");
  });

  it("tidak ada pelanggaran aturan dependensi", () => {
    expect(violations()).toEqual([]);
  });
});
