"use client";

import { useRef, useEffect, useState } from "react";

/**
 * Hook SpeechRecognition (Web Speech API).
 * Mendukung Chrome/Edge (SRT) dan Safari (webkitSpeechRecognition).
 */
export function useSpeechRecognition({
  lang = "id-ID",
  onResult,
  onEnd,
  continuous = false,
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef(null);
  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);

  // Deteksi dukungan STT hanya setelah mount (hindari mismatch hydration)
  useEffect(() => {
    const SR =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(Boolean(SR));
  }, []);

  useEffect(() => {
    onResultRef.current = onResult;
    onEndRef.current = onEnd;
  });

  const start = () => {
    if (!supported || recRef.current) return;
    const SR =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = continuous;

    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      onResultRef.current?.({
        final: finalText,
        interim,
        transcript: finalText + interim,
      });
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      onEndRef.current?.();
    };
    rec.onerror = (e) => {
      setListening(false);
      recRef.current = null;
      if (e.error === "not-allowed") {
        onEndRef.current?.({ error: "Mic permission denied" });
      }
    };

    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const stop = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };

  useEffect(() => stop, []);

  return { listening, supported, start, stop };
}
