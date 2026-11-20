import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "dev.db");

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedbacks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        text TEXT DEFAULT '',
        email TEXT DEFAULT '',
        rating INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        userAgent TEXT DEFAULT ''
      )
    `);
  }
  return db;
}

export function insertFeedback(record) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO feedbacks (id, type, text, email, rating, createdAt, userAgent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.type,
      record.text,
      record.email,
      record.rating,
      record.createdAt,
      record.userAgent
    );
  return record;
}

export function listFeedback(limit = 100) {
  return getDb()
    .prepare(`SELECT * FROM feedbacks ORDER BY createdAt DESC LIMIT ?`)
    .all(limit);
}
