import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import type { Selections } from "./types.js";

export const IGNORE_ENTRIES = new Set<string>([
  "node_modules",
  ".git",
  "dist",
  ".turbo",
  "__generated__",
]);

export const RENAME_ON_COPY: Record<string, string> = {
  _gitignore: ".gitignore",
};

export function targetName(entryName: string): string {
  return RENAME_ON_COPY[entryName] ?? entryName;
}

export const BINARY_EXTENSIONS = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".icns",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".jar",
  ".class",
  ".keystore",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
]);

export type JsonRecord = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildReplacements(slug: string): Record<string, string> {
  return {
    __APP_SLUG__: slug,
    "@pimasi/lib": `@${slug}/lib`,
    "pimasi-server": `${slug}-server`,
    "pimasi-web": `${slug}-web`,
    "pimasi-mongo": `${slug}-mongo`,
    "pimasi-redis": `${slug}-redis`,
    "pimasi-postgres": `${slug}-postgres`,
    pimasi_auth_token: `${slug.replaceAll("-", "_")}_auth_token`,
  };
}

export function applyReplacements(
  text: string,
  replacements: Record<string, string>,
): string {
  let out = text;
  for (const [needle, value] of Object.entries(replacements)) {
    if (out.includes(needle)) out = out.split(needle).join(value);
  }
  return out;
}

export function deepMerge(base: JsonRecord, partial: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };

  for (const key of Object.keys(partial)) {
    const baseVal = out[key];
    const partVal = partial[key];
    if (isPlainObject(baseVal) && isPlainObject(partVal)) {
      out[key] = deepMerge(baseVal, partVal);
    } else {
      out[key] = partVal;
    }
  }

  return out;
}

export function deepMergePackageJson(
  targetPkgPath: string,
  partialPkgObj: JsonRecord,
): void {
  const base = JSON.parse(readFileSync(targetPkgPath, "utf8")) as JsonRecord;
  const merged = deepMerge(base, partialPkgObj);
  writeFileSync(targetPkgPath, JSON.stringify(merged, null, 4) + "\n");
}

export function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (IGNORE_ENTRIES.has(entry.name)) continue;

    const srcPath = join(src, entry.name);
    const dstPath = join(dst, targetName(entry.name));

    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      if (entry.name === "package.json" && existsSync(dstPath)) {
        const partial = JSON.parse(readFileSync(srcPath, "utf8")) as JsonRecord;
        deepMergePackageJson(dstPath, partial);
      } else {
        cpSync(srcPath, dstPath);
      }
    }
  }
}

export function compose(
  templatesDir: string,
  targetDir: string,
  selections: Selections,
): void {
  copyDir(join(templatesDir, "base"), targetDir);
  copyDir(join(templatesDir, "db", selections.database), targetDir);
  if (selections.cache || selections.rateLimit || selections.websockets) {
    copyDir(join(templatesDir, "server", "redis"), targetDir);
  }
  if (selections.rateLimit) {
    copyDir(join(templatesDir, "server", "rate-limit"), targetDir);
  }
  if (selections.workers) {
    copyDir(join(templatesDir, "server", "workers"), targetDir);
  }
  if (selections.cache) {
    copyDir(join(templatesDir, "server", "cache"), targetDir);
  }
  if (selections.websockets) {
    copyDir(join(templatesDir, "websockets", "server"), targetDir);
  }
  copyDir(join(templatesDir, "frontend", selections.frontend), targetDir);
  if (selections.websockets) {
    copyDir(join(templatesDir, "websockets", selections.frontend), targetDir);
  }
  copyDir(
    join(templatesDir, "design", selections.design, selections.frontend),
    targetDir,
  );
  if (selections.cordova) {
    copyDir(join(templatesDir, "cordova", selections.frontend), targetDir);
  }
}

export function replacePlaceholders(
  dir: string,
  replacements: Record<string, string>,
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_ENTRIES.has(entry.name)) continue;

    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      replacePlaceholders(entryPath, replacements);
    } else if (entry.isFile()) {
      if (BINARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

      const buffer = readFileSync(entryPath);
      if (buffer.includes(0)) continue;

      const text = buffer.toString("utf8");
      const replaced = applyReplacements(text, replacements);
      if (replaced !== text) writeFileSync(entryPath, replaced);
    }
  }
}
