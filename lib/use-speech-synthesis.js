"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text-To-Speech.
 *
 * Mesin utama: Google Translate TTS via /api/tts (suara Google, konsisten di
 * semua browser termasuk Firefox). Bila gagal (offline/limit), fallback ke
 * Web Speech API `speechSynthesis`.
 *
 * API sengaja dibuat sama dengan versi lama: { speaking, supported, voices,
 * speak, cancel } agar pemanggil tidak perlu berubah.
 */
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [usingGoogle, setUsingGoogle] = useState(true);
  const audioRef = useRef(null);
  const seqRef = useRef(0);

  const webSpeechAvailable =
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!webSpeechAvailable) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, [webSpeechAvailable]);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
  }, []);

  const speakWebSpeech = useCallback(
    (text, { voiceURI, rate = 1, lang = "id-ID", onEnd } = {}) => {
      if (!webSpeechAvailable) {
        onEnd?.();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const list = window.speechSynthesis.getVoices();
      const v = voiceURI
        ? list.find((x) => x.voiceURI === voiceURI)
        : list.find((x) => x.lang?.replace("_", "-") === lang);
      if (v) u.voice = v;
      u.lang = v?.lang || lang;
      u.rate = rate;
      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        onEnd?.();
      };
      u.onerror = () => {
        setSpeaking(false);
        onEnd?.();
      };
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [webSpeechAvailable]
  );

  const speak = useCallback(
    (text, { voiceURI, rate = 1, lang = "id", onEnd } = {}) => {
      const clean = (text || "").trim();
      if (!clean) {
        onEnd?.();
        return;
      }

      // Batalkan apa pun yang sedang berbunyi
      stopAudio();
      if (webSpeechAvailable) window.speechSynthesis.cancel();

      const mySeq = ++seqRef.current;

      if (!usingGoogle) {
        speakWebSpeech(clean, { voiceURI, rate, lang, onEnd });
        return;
      }

      const fallback = () => {
        if (seqRef.current !== mySeq) return; // sudah digantikan pesan baru
        setUsingGoogle(false);
        speakWebSpeech(clean, {
          voiceURI,
          rate,
          lang: lang.includes("-") ? lang : `${lang}-${lang.toUpperCase()}`,
          onEnd,
        });
      };

      setSpeaking(true);
      const q = new URLSearchParams({ text: clean, lang });
      const audio = new Audio(`/api/tts?${q}`);
      audioRef.current = audio;
      audio.playbackRate = Math.min(Math.max(rate, 0.5), 2);

      audio.onended = () => {
        if (seqRef.current !== mySeq) return;
        setSpeaking(false);
        onEnd?.();
      };
      audio.onerror = fallback;

      audio.play().catch(fallback);
    },
    [stopAudio, speakWebSpeech, usingGoogle, webSpeechAvailable]
  );

  const cancel = useCallback(() => {
    seqRef.current++;
    stopAudio();
    if (webSpeechAvailable) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [stopAudio, webSpeechAvailable]);

  useEffect(() => () => cancel(), [cancel]);

  return {
    speaking,
    supported: true, // Google TTS lewat proxy selalu tersedia
    voices,
    speak,
    cancel,
  };
}
