"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isModelCached, transcribeBlob } from "./whisper-client";

/**
 * Speech-to-Text.
 *
 * Jalur utama: Web Speech API (di Chrome/Edge/Android memakai server Google —
 * akurasi tinggi, latensi rendah, tanpa unduhan).
 *
 * Fallback offline: Whisper-tiny WASM (transformers.js). Model diunduh di
 * background saat kunjungan pertama. Jika pengguna menekan mic selagi model
 * belum terunduh, kita lempar galat alih-alih menggantung menunggu unduhan.
 */
export function useSpeechRecognition({
  lang = "id-ID",
  onResult,
  onEnd,
  continuous = false,
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [engine, setEngine] = useState("google"); // google | whisper
  const recRef = useRef(null);
  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);
  const langRef = useRef(lang);

  // Recorder untuk fallback Whisper
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(
      Boolean(SR) ||
        ("MediaRecorder" in window && "AudioContext" in window)
    );
  }, []);

  useEffect(() => {
    onResultRef.current = onResult;
    onEndRef.current = onEnd;
    langRef.current = lang;
  });

  const stopMedia = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      // Minta sisa data sebelum stop agar frame terakhir tidak hilang
      try {
        if (rec.state === "recording") rec.requestData();
      } catch {
        /* ignore */
      }
      rec.stop();
    }
    mediaRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (mediaRef.current) {
      stopMedia();
      setListening(false);
      return;
    }
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, [stopMedia]);

  const startWhisper = useCallback(async () => {
    // Jangan menunggu unduhan model: bila belum ada, langsung galat.
    const cached = await isModelCached();
    if (!cached) {
      onEndRef.current?.({
        error:
          "Model offline belum terunduh. Buka halaman ini sekali saat online, atau gunakan Chrome/Edge untuk mic online.",
        code: "whisper-not-ready",
      });
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onEndRef.current?.({ error: "Mic permission denied" });
      return;
    }

    chunksRef.current = [];
    // Pilih mimeType yang benar-benar didukung; Chrome/Firefox beda codec
    const preferred = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    const mimeType =
      typeof MediaRecorder.isTypeSupported === "function"
        ? preferred.find((t) => MediaRecorder.isTypeSupported(t))
        : undefined;
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const startedAt = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (!blob.size || Date.now() - startedAt < 500) {
        onEndRef.current?.({
          error:
            "Rekaman terlalu pendek. Tahan mic dan bicara minimal 1 detik.",
        });
        return;
      }
      try {
        const text = await transcribeBlob(blob, langRef.current);
        if (text) {
          onResultRef.current?.({ final: text, interim: "", transcript: text });
        }
        onEndRef.current?.();
      } catch (err) {
        onEndRef.current?.({ error: `Transkripsi gagal: ${err.message}` });
      }
    };
    mediaRef.current = rec;
    rec.start();
    setListening(true);
  }, []);

  const start = useCallback(async () => {
    if (!supported || recRef.current || mediaRef.current) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Tidak ada Web Speech → pakai Whisper bila model tersedia
    if (!SR) {
      setEngine("whisper");
      await startWhisper();
      return;
    }

    setEngine("google");
    const rec = new SR();
    rec.lang = langRef.current;
    rec.interimResults = true;
    rec.continuous = continuous;

    let finalText = "";
        let settled = false; // pastikan onEnd hanya sekali per sesi

        const finish = (payload) => {
          if (settled) return;
          settled = true;
          setListening(false);
          recRef.current = null;
          onEndRef.current?.(payload);
        };

    rec.onresult = (e) => {
      let interim = "";
          let freshFinal = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
            if (e.results[i].isFinal) freshFinal += chunk;
        else interim += chunk;
      }
          if (freshFinal) finalText += freshFinal;
      onResultRef.current?.({
        final: freshFinal,
        interim,
        transcript: freshFinal + interim,
      });
    };
    rec.onend = () => {
          finish(undefined);
    };
    rec.onerror = (e) => {
          const code = e.error || "unknown";
      // "network"/"service-not-allowed": server Google tak terjangkau → coba offline
          if (code === "network" || code === "service-not-allowed") {
            if (settled) return;
            settled = true;
            setListening(false);
            recRef.current = null;
        setEngine("whisper");
        startWhisper();
        return;
      }
          // "no-speech"/"aborted": bukan galat bagi pengguna, cukup berhenti diam-diam
          const benign = code === "no-speech" || code === "aborted";
          finish(
            benign
              ? undefined
              : {
                  error:
                    code === "not-allowed"
                      ? "Izin mikrofon ditolak. Izinkan mic di pengaturan browser."
                      : `Speech recognition error: ${code}`,
                }
          );
    };

    recRef.current = rec;
        try {
          rec.start();
          setListening(true);
        } catch (err) {
          recRef.current = null;
          setListening(false);
          onEndRef.current?.({
            error: `Tidak bisa memulai mic: ${err.message}`,
          });
        }
  }, [supported, continuous, startWhisper]);

  useEffect(() => () => stop(), [stop]);

  return { listening, supported, engine, start, stop };
}