import { promises as fs, createReadStream } from "fs";
import path from "path";
import crypto from "crypto";
import type { ReadStream } from "fs";
import { Readable } from "stream";
import { getSupabaseService } from "@/lib/supabase/service";

export interface StoredFile {
  key: string;
  filename: string;
  size: number;
}

export interface StorageAdapter {
  save(buffer: Buffer, originalName: string, mimeType: string, opts?: { prefix?: string }): Promise<StoredFile>;
  read(key: string): Promise<{ stream: ReadStream | NodeJS.ReadableStream; size: number }>;
  readRange(key: string, start: number, end: number): Promise<NodeJS.ReadableStream>;
  stat(key: string): Promise<{ size: number }>;
  delete(key: string): Promise<void>;
  /** Optional: produce a short-lived URL the browser can fetch directly. */
  signedUrl?(key: string, expiresInSec?: number): Promise<string>;
}

class LocalStorage implements StorageAdapter {
  constructor(private root: string) {}

  private async ensureRoot(prefix?: string) {
    const target = prefix ? path.join(this.root, prefix) : this.root;
    await fs.mkdir(target, { recursive: true });
  }

  private resolve(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }

  async save(buffer: Buffer, originalName: string, _mimeType: string, opts?: { prefix?: string }): Promise<StoredFile> {
    await this.ensureRoot(opts?.prefix);
    const ext = path.extname(originalName).toLowerCase();
    const safeName = crypto.randomBytes(12).toString("hex") + ext;
    const key = opts?.prefix ? path.posix.join(opts.prefix, safeName) : safeName;
    const full = path.join(this.root, key);
    await fs.writeFile(full, buffer);
    return { key, filename: safeName, size: buffer.length };
  }

  async read(key: string) {
    const full = this.resolve(key);
    const stat = await fs.stat(full);
    return { stream: createReadStream(full), size: stat.size };
  }

  async readRange(key: string, start: number, end: number) {
    const full = this.resolve(key);
    return createReadStream(full, { start, end });
  }

  async stat(key: string) {
    const full = this.resolve(key);
    const s = await fs.stat(full);
    return { size: s.size };
  }

  async delete(key: string) {
    const full = this.resolve(key);
    await fs.rm(full, { force: true });
  }
}

class SupabaseStorage implements StorageAdapter {
  constructor(private bucket: string) {}

  async save(buffer: Buffer, originalName: string, mimeType: string, opts?: { prefix?: string }): Promise<StoredFile> {
    const ext = path.extname(originalName).toLowerCase();
    const safeName = crypto.randomBytes(12).toString("hex") + ext;
    const key = opts?.prefix ? `${opts.prefix.replace(/\/+$/, "")}/${safeName}` : safeName;
    const supabase = getSupabaseService();
    const { error } = await supabase.storage.from(this.bucket).upload(key, buffer, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return { key, filename: safeName, size: buffer.length };
  }

  async read(key: string) {
    const supabase = getSupabaseService();
    const { data, error } = await supabase.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Supabase download failed: ${error?.message ?? "no body"}`);
    const ab = await data.arrayBuffer();
    const buf = Buffer.from(ab);
    return { stream: Readable.from(buf), size: buf.byteLength };
  }

  async readRange(key: string, start: number, end: number) {
    const { stream } = await this.read(key);
    const buf = await streamToBuffer(stream);
    return Readable.from(buf.subarray(start, end + 1));
  }

  async stat(key: string) {
    const folder = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const supabase = getSupabaseService();
    const { data, error } = await supabase.storage.from(this.bucket).list(folder, {
      search: name,
      limit: 1,
    });
    if (error) throw new Error(`Supabase stat failed: ${error.message}`);
    const entry = data?.find((f) => f.name === name);
    if (!entry) throw new Error("Not found");
    const size = (entry.metadata as { size?: number } | null)?.size ?? 0;
    return { size };
  }

  async delete(key: string) {
    const supabase = getSupabaseService();
    const { error } = await supabase.storage.from(this.bucket).remove([key]);
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
  }

  async signedUrl(key: string, expiresInSec = 300): Promise<string> {
    const supabase = getSupabaseService();
    const { data, error } = await supabase.storage.from(this.bucket).createSignedUrl(key, expiresInSec);
    if (error || !data?.signedUrl) throw new Error(`Supabase signed URL failed: ${error?.message ?? "no url"}`);
    return data.signedUrl;
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  const type = process.env.STORAGE_TYPE ?? "local";
  if (type === "supabase") {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "vault";
    adapter = new SupabaseStorage(bucket);
    return adapter;
  }
  if (type === "local") {
    const root = path.resolve(process.env.LOCAL_UPLOAD_PATH ?? "./public/uploads");
    adapter = new LocalStorage(root);
    return adapter;
  }
  throw new Error(`Storage type "${type}" not implemented.`);
}
