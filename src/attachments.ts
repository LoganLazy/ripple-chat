import type { EncryptedAttachment } from "./types";
export const MAX_ATTACHMENT = 25 * 1024 * 1024;
export const isPreviewImage = (type = "") =>
  /^image\/(png|jpeg|gif|webp|avif)$/.test(type);
export const fileSize = (size = 0) =>
  size < 1024
    ? `${size} B`
    : size < 1024 ** 2
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 ** 2).toFixed(1)} MB`;
export function validateFile(file: Blob) {
  if (file.size > MAX_ATTACHMENT) throw new Error("单个附件不能超过 25 MB。");
  if (!file.size) throw new Error("不能发送空文件。");
}
const encode = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        bytes instanceof Uint8Array ? (bytes.buffer as ArrayBuffer) : bytes,
      ),
    ),
  ).replace(/=+$/, "");
const decode = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
// Matrix encrypted attachments v2: AES-256-CTR, random high 64 bits, zero low 64 bits.
export async function encryptAttachment(data: ArrayBuffer) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-CTR", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const counter = new Uint8Array(16);
  crypto.getRandomValues(counter.subarray(0, 8));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter, length: 64 },
    key,
    data,
  );
  const exported = await crypto.subtle.exportKey("jwk", key);
  const metadata: EncryptedAttachment = {
    v: "v2",
    key: {
      alg: "A256CTR",
      kty: "oct",
      ext: true,
      key_ops: ["encrypt", "decrypt"],
      k: exported.k!,
    },
    iv: encode(counter),
    hashes: {
      sha256: encode(await crypto.subtle.digest("SHA-256", encrypted)),
    },
  };
  return { encrypted, metadata };
}
export async function decryptAttachment(
  data: ArrayBuffer,
  file: EncryptedAttachment,
) {
  if (
    file.v !== "v2" ||
    file.key?.kty !== "oct" ||
    file.key.alg !== "A256CTR" ||
    !file.hashes?.sha256
  )
    throw new Error("不支持的附件加密格式。");
  if (
    encode(await crypto.subtle.digest("SHA-256", data)) !==
    file.hashes.sha256.replace(/=+$/, "")
  )
    throw new Error("附件完整性校验失败，已停止打开。");
  const counter = decode(file.iv);
  if (counter.length !== 16) throw new Error("附件加密参数无效。");
  const key = await crypto.subtle.importKey(
    "jwk",
    file.key,
    { name: "AES-CTR" },
    false,
    ["decrypt"],
  );
  return crypto.subtle.decrypt(
    { name: "AES-CTR", counter, length: 64 },
    key,
    data,
  );
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("ripple-attachments", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(new Error("无法打开本地附件存储。"));
    };
  }));
}
export async function saveLocalFile(
  id: string,
  file: Blob,
  signal?: AbortSignal,
) {
  const database = await db();
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("files", "readwrite");
    const abort = () => {
      try {
        tx.abort();
      } catch {
        /* Already committed. */
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    tx.objectStore("files").put(file, id);
    tx.oncomplete = () => {
      cleanup();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      cleanup();
      reject(
        signal?.aborted
          ? new DOMException("Cancelled", "AbortError")
          : new Error("附件保存失败，请检查本地存储空间。"),
      );
    };
  });
  if (signal?.aborted) {
    await removeLocalFile(id);
    signal.throwIfAborted();
  }
}
export async function loadLocalFile(id: string): Promise<Blob> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction("files").objectStore("files").get(id);
    req.onsuccess = () =>
      req.result instanceof Blob
        ? resolve(req.result)
        : reject(new Error("本地附件已丢失或被清理。"));
    req.onerror = () => reject(new Error("读取附件失败。"));
  });
}
export async function removeLocalFile(id: string) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error("无法清理本地附件。"));
  });
}
export function downloadBlob(blob: Blob, filename: string) {
  // Force a download instead of navigating to potentially active HTML/SVG content.
  const url = URL.createObjectURL(
    new Blob([blob], { type: "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/\x00-\x1f]/g, "_") || "attachment";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
