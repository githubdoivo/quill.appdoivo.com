// On-device storage (IndexedDB): "items" (entries, pages, boards, books) and
// "files" (photos as Blobs, keyed by id). Nothing leaves the browser.
const NAME = "journal", VERSION = 1;
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" }).createIndex("type", "type");
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error("blocked"));
  });
  return dbp;
}
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("abort")); });
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function loadItems() { const db = await open(); return req(db.transaction("items").objectStore("items").getAll()); }
export async function getKV(key) { const db = await open(); return req(db.transaction("kv").objectStore("kv").get(key)); }
export async function setKV(key, v) { const db = await open(); const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, key); return done(tx); }
export async function putItem(item) { const db = await open(); const tx = db.transaction("items", "readwrite"); tx.objectStore("items").put(item); return done(tx); }
export async function deleteItem(id) { const db = await open(); const tx = db.transaction("items", "readwrite"); tx.objectStore("items").delete(id); return done(tx); }
// Photos are kept as raw bytes + type, not as Blobs: Safari in private browsing (and some
// older WebKit) refuses Blobs in IndexedDB, silently. Bytes work everywhere.
const pack = async (blob) => ({ type: blob.type || "image/jpeg", data: await blob.arrayBuffer() });
const unpack = (v) => (v instanceof Blob ? v : v && v.data ? new Blob([v.data], { type: v.type }) : null);
export async function putFile(id, blob) { const v = await pack(blob); const db = await open(); const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(v, id); return done(tx); }
export async function getFile(id) { const db = await open(); return unpack(await req(db.transaction("files").objectStore("files").get(id))); }
export async function fileIds() { const db = await open(); return req(db.transaction("files").objectStore("files").getAllKeys()); }
export async function deleteFiles(ids) { const db = await open(); const tx = db.transaction("files", "readwrite"); for (const id of ids) tx.objectStore("files").delete(id); return done(tx); }
// Restore: everything replaced in one transaction, all or nothing.
export async function replaceAll(items, files) {
  const packed = []; for (const [id, blob] of files) packed.push([id, await pack(blob)]);
  const db = await open(); const tx = db.transaction(["items", "files"], "readwrite");
  tx.objectStore("items").clear(); tx.objectStore("files").clear();
  for (const it of items) tx.objectStore("items").put(it);
  for (const [id, v] of packed) tx.objectStore("files").put(v, id);
  return done(tx);
}
export async function wipe() {
  const db = await open(); db.close(); dbp = null;
  await new Promise((res, rej) => { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
}
export async function persist() { try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; } }
