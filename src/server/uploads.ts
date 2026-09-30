import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { getDb, newId, type DB } from "./db.ts";

/**
 * Owner media uploads. Validated by magic bytes, not by the client-supplied
 * type. SVG is deliberately NOT accepted: it can carry script. Files are
 * stored outside /public and served through /api/media with a fixed
 * Content-Type and `nosniff`.
 *
 * Production: swap this for object storage (S3/R2/GCS) behind the same
 * functions, and add malware / CSAM scanning at this boundary.
 */

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");

const SIGNATURES: { mime: string; ext: string; kind: "image" | "video"; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: "png", kind: "image", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", kind: "image", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: "gif", kind: "image", test: (b) => b.subarray(0, 6).toString("ascii") === "GIF89a" || b.subarray(0, 6).toString("ascii") === "GIF87a" },
  { mime: "image/webp", ext: "webp", kind: "image", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { mime: "video/mp4", ext: "mp4", kind: "video", test: (b) => b.subarray(4, 8).toString("ascii") === "ftyp" },
  { mime: "video/webm", ext: "webm", kind: "video", test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];

export function sniff(buf: Buffer) {
  return SIGNATURES.find((s) => buf.length >= 12 && s.test(buf)) ?? null;
}

export class UploadError extends Error {
  status: number;
  constructor(msg: string, status = 422) {
    super(msg);
    this.status = status;
  }
}

export function saveUpload(userId: string, buf: Buffer, rightsConfirmed: boolean, db: DB = getDb()) {
  if (!rightsConfirmed) throw new UploadError("You must confirm you have the rights to use this file");
  if (buf.length === 0) throw new UploadError("Empty file");
  if (buf.length > config.maxUploadBytes) throw new UploadError(`File is larger than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB`, 413);
  const sig = sniff(buf);
  if (!sig) throw new UploadError("Unsupported file type. Use PNG, JPEG, WebP, GIF, MP4 or WebM.");

  mkdirSync(UPLOAD_DIR, { recursive: true });
  const id = newId("upl");
  const file = `${id}.${sig.ext}`;
  writeFileSync(path.join(UPLOAD_DIR, file), buf);
  const url = `/api/media/${file}`;
  db.prepare("INSERT INTO uploads (id, user_id, url, mime, bytes, kind, rights_confirmed, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)").run(
    id,
    userId,
    url,
    sig.mime,
    buf.length,
    sig.kind,
    Date.now(),
  );
  return { id, url, mime: sig.mime, kind: sig.kind, bytes: buf.length };
}

export function readUpload(file: string): { buf: Buffer; mime: string } | null {
  if (!/^upl_[a-f0-9]{22}\.(png|jpg|gif|webp|mp4|webm)$/.test(file)) return null;
  const p = path.join(UPLOAD_DIR, file);
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  const sig = sniff(buf);
  return sig ? { buf, mime: sig.mime } : null;
}
