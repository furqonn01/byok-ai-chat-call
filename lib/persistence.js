"use client";

import { useEffect, useRef } from "react";
import { Conversations, Settings } from "./db";

export const SETTINGS_KEY = "byok-settings";

/**
 * Simpan pengaturan BYOK ke IndexedDB (Settings).
 * Dipanggil saat settings berubah (debounce ringan via useEffect di caller).
 */
export async function saveSettings(settings) {
  try {
    await Settings.put({ key: SETTINGS_KEY, value: settings });
  } catch (e) {
    console.warn("Gagal simpan settings:", e);
  }
}

/**
 * Muat pengaturan dari IndexedDB. Fallback ke default bila belum ada.
 */
export async function loadSettings(defaults) {
  try {
    const row = await Settings.get(SETTINGS_KEY);
    if (row?.value) return { ...defaults, ...row.value };
  } catch (e) {
    console.warn("Gagal muat settings:", e);
  }
  return defaults;
}

/**
 * Simpan seluruh daftar konversasi (upsert per id).
 */
export async function saveConversations(conversations) {
  try {
    const now = Date.now();
    const items = conversations.map((c) => ({
      ...c,
      updatedAt: now,
    }));
    await Conversations.bulkPut(items);
  } catch (e) {
    console.warn("Gagal simpan konversasi:", e);
  }
}

/**
 * Muat seluruh konversasi dari IndexedDB (urutan terbaru dulu).
 */
export async function loadConversations() {
  try {
    const rows = await Conversations.orderBy("updatedAt").reverse().toArray();
    return rows;
  } catch (e) {
    console.warn("Gagal muat konversasi:", e);
    return [];
  }
}

/**
 * Hapus satu konversasi.
 */
export async function deleteConversation(id) {
  try {
    await Conversations.delete(id);
  } catch (e) {
    console.warn("Gagal hapus konversasi:", e);
  }
}

/**
 * Hapus semua konversasi yang sesuai tanggal (opsional filter providerKey).
 */
export async function deleteConversationByDate(date, providerKey) {
  try {
    const all = await Conversations.toArray();
    const toDelete = all.filter(
      (c) =>
        c.date === date && (!providerKey || c.providerKey === providerKey)
    );
    if (toDelete.length) {
      await Conversations.bulkDelete(toDelete.map((c) => c.id));
    }
  } catch (e) {
    console.warn("Gagal hapus konversasi per tanggal:", e);
  }
}

/**
 * Hapus semua konversasi.
 */
export async function deleteAllConversations() {
  try {
    const all = await Conversations.toArray();
    if (all.length) {
      await Conversations.bulkDelete(all.map((c) => c.id));
    }
  } catch (e) {
    console.warn("Gagal hapus semua konversasi:", e);
  }
}

/**
 * Group konversasi per tanggal (YYYY-MM-DD dari updatedAt atau field date).
 * Return: { "2025-07-21": [c1, c2], "2025-07-20": [c3] }
 */
export function groupConversationsByDate(conversations) {
  const groups = {};
  for (const c of conversations) {
    const d = c.date
      ? c.date
      : c.updatedAt
        ? new Date(c.updatedAt).toISOString().slice(0, 10)
        : "unknown";
    if (!groups[d]) groups[d] = [];
    groups[d].push(c);
  }
  // Urutkan tanggal dari terbaru
  const sorted = {};
  Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .forEach((k) => {
      sorted[k] = groups[k];
    });
  return sorted;
}

/**
 * Hook: persist konversasi & settings ke IndexedDB saat berubah.
 * - conversations: array dari state
 * - settings: object dari state
 * - loaded: boolean, true setelah data awal dimuat
 */
export function usePersistence({ conversations, settings, loaded }) {
  const skipFirstRef = useRef(true);

  // Persist conversations
  useEffect(() => {
    if (!loaded) return;
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    saveConversations(conversations);
  }, [conversations, loaded]);

  // Persist settings
  useEffect(() => {
    if (!loaded) return;
    saveSettings(settings);
  }, [settings, loaded]);
}
