import Dexie from "dexie";

/**
 * Database lokal di browser (IndexedDB via Dexie).
 * Menyimpan konversasi chat & pengaturan BYOK per perangkat.
 */
const db = new Dexie("byok-chat", {
  version: 1,
});

db.version(1).stores({
  conversations: "id, updatedAt, title",
  settings: "key",
});

export const Conversations = db.table("conversations");
export const Settings = db.table("settings");

export default db;

/** Helper: hapus banyak record sekaligus (kompatibel Dexie). */
export function bulkDelete(table, ids) {
  return table.bulkDelete(ids);
}
