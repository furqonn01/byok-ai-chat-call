"use client";

import { useEffect, useState } from "react";

/**
 * Hook Text-To-Speech pakai Web Speech API (speechSynthesis).
 */
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    setSupported(true);
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, []);

  const speak = (text, { voiceURI, rate = 1, onEnd } = {}) => {
    if (!supported || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voiceURI) {
      const v = voices.find((x) => x.voiceURI === voiceURI);
      if (v) u.voice = v;
    }
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
    window.speechSynthesis.speak(u);
  };

  const cancel = () => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  return { speaking, supported, voices, speak, cancel };
}
