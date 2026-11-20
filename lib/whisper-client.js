"use client";

/**
 * Whisper WASM (transformers.js) — fallback STT offline.
 * Model kecil multilingual, di-cache browser (Cache API) agar sekali unduh.
 * Module di-import dinamis supaya tidak membebani bundle awal.
 */

const MODEL_ID = "Xenova/whisper-tiny";

let pipelinePromise = null;
let loadProgress = 0;
let loaded = false;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn({ progress: loadProgress, loaded }));
}

export function onWhisperStatus(fn) {
  listeners.add(fn);
  fn({ progress: loadProgress, loaded });
  return () => listeners.delete(fn);
}

export function getWhisperStatus() {
  return { progress: loadProgress, loaded };
}

/** Cek apakah model sudah ada di Cache API (tanpa memuat pipeline). */
export async function isModelCached() {
  if (loaded) return true;
  if (typeof caches === "undefined") return false;
  try {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      if (keys.some((k) => k.url.includes("Xenova/whisper-tiny"))) return true;
    }
  } catch {
    /* private mode / cache disabled */
  }
  return false;
}

async function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Simpan model di Cache API browser → setelah unduhan pertama bisa offline
      env.useBrowserCache = true;
      env.allowLocalModels = false;
      const pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
        dtype: "q8",
              device: "wasm",
        progress_callback: (p) => {
          if (p?.status === "progress" && p.total) {
            loadProgress = Math.round((p.loaded / p.total) * 100);
            emit();
          }
        },
      });
      loaded = true;
      loadProgress = 100;
      emit();
      return pipe;
    })().catch((err) => {
      pipelinePromise = null;
      emit();
      throw err;
    });
  }
  return pipelinePromise;
}

/** Unduh model di background (dipanggil saat idle / kunjungan pertama). */
export function prefetchWhisper() {
  if (typeof window === "undefined") return;
  if (!("caches" in window)) return;
  getPipeline().catch(() => {
    /* offline sejak awal: coba lagi nanti */
  });
}

/**
 * Decode blob → AudioBuffer.
 * decodeAudioData men-detach ArrayBuffer, jadi kirim salinan; hasil callback
 * dan promise di-resolve bersamaan (resolve ganda aman).
 */
async function decodeBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    return await new Promise((resolve, reject) => {
      const maybePromise = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve, reject);
      }
    });
  } finally {
    ctx.close();
  }
}

/** Resample audio blob → Float32Array mono 16 kHz yang dibutuhkan Whisper. */
async function blobToFloat32(blob) {
  if (!blob || !blob.size) {
    throw new Error("Rekaman kosong. Tahan mic dan bicara minimal 1 detik.");
  }

  let decoded;
  try {
    decoded = await decodeBlob(blob);
  } catch {
    // Container/codec tak terbaca, atau rekaman terlalu pendek (hanya header).
    throw new Error(
      "Audio tidak bisa dibaca browser (codec tidak didukung atau rekaman terlalu pendek). Coba lagi dan bicara minimal 1 detik."
    );
  }

  if (!decoded || !decoded.duration || decoded.duration < 0.25) {
    throw new Error("Rekaman terlalu pendek. Bicara minimal 1 detik.");
  }

  const targetRate = 16000;
  if (decoded.sampleRate === targetRate && decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0).slice();
  }

  const frames = Math.max(1, Math.round(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

const LANG_MAP = {
  "id-ID": "indonesian",
  "en-US": "english",
  "fil-PH": "tagalog",
};

/**
 * Transkripsi audio via Whisper WASM.
 * @param {Blob} blob rekaman MediaRecorder
 * @param {string} lang kode STT, mis. "id-ID"
 */
export async function transcribeBlob(blob, lang = "id-ID") {
  const pipe = await getPipeline();
  const audio = await blobToFloat32(blob);
  const result = await pipe(audio, {
    language: LANG_MAP[lang] || "indonesian",
    task: "transcribe",
    chunk_length_s: 30,
  });
  return (result?.text || "").trim();
}