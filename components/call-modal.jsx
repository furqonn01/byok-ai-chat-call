"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Mode "Call": simulasi telepon dengan AI.
 * - STT: user bicara (Web Speech API)
 * - TTS: AI menjawab (Web Speech API)
 * - Loop: setelah TTS selesai, otomatis STT dimulai lagi (hands-free)
 */
export default function CallModal({
  onClose,
  settings,
  sendMessage,
  speak,
  cancelSpeech,
  startSTT,
  stopSTT,
  listening,
  ttsSupported,
  sttSupported,
}) {
  const [phase, setPhase] = useState("connecting"); // connecting | talking | listening | ended
  const [callSeconds, setCallSeconds] = useState(0);
  const [lastText, setLastText] = useState("");
  const timerRef = useRef(null);
  const phaseRef = useRef(phase);
  const speakingRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Timer durasi
  useEffect(() => {
    if (phase === "ended") return;
    timerRef.current = setInterval(() => {
      setCallSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase === "ended"]);

  // Greeting saat masuk
  const startedRef = useRef(false);
  const startCall = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!settings.apiKey) {
      setLastText("⚠️ API key belum diisi. Isi di panel kiri lalu panggil lagi.");
      setPhase("ended");
      return;
    }

    // Kirim greeting dari AI
    try {
      await sendMessage("Halo! Mulai mode call.");
      setPhase("talking");
      // TTS greeting manual (jangan andalkan autoSpeak karena mode call selalu bicara)
      speak("Halo, saya siap membantu. Apa yang ingin kamu bicarakan?", {
        voiceURI: settings.voiceURI,
        rate: settings.speechRate,
        onEnd: () => {
          if (sttSupported) {
            setPhase("listening");
            startSTT();
          }
        },
      });
    } catch (err) {
      setLastText(`Gagal mulai: ${err.message}`);
      setPhase("ended");
    }
  }, [
    settings,
    sendMessage,
    speak,
    ttsSupported,
    sttSupported,
    startSTT,
  ]);

  useEffect(() => {
    if (phase === "connecting") startCall();
  }, [phase, startCall]);

  // Jika STT aktif dan phase listening, dengarkan. Tapi startSTT/stopSTT
  // berasal dari hook di parent — di sini kita hanya menampilkan state.

  const endCall = () => {
    stopSTT();
    cancelSpeech();
    setPhase("ended");
  };

  const statusText =
    phase === "connecting"
      ? "Menyambung…"
      : phase === "talking"
      ? "AI sedang bicara…"
      : phase === "listening"
      ? "Mendengarkan…"
      : "Selesai";

  const mm = String(Math.floor(callSeconds / 60)).padStart(2, "0");
  const ss = String(callSeconds % 60).padStart(2, "0");

  return (
    <div className="call-overlay" onClick={(e) => e.target === e.currentTarget && endCall()}>
      <div className="call-card">
        <div className={`call-avatar ${phase === "connecting" ? "ringing" : ""}`}>
          AI
        </div>
        <div className="call-title">BYOK Call</div>
        <div className="call-status">
          {statusText} · {mm}:{ss}
        </div>

        <div className={`call-wave ${phase === "talking" ? "speaking" : ""}`}>
          <span /> <span /> <span /> <span /> <span />
        </div>

        {lastText && (
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              maxWidth: "100%",
              overflowWrap: "break-word",
            }}
          >
            {lastText}
          </div>
        )}

        <div className="call-controls">
          <button
            title={listening ? "Berhenti dengar" : "Bicara (STT)"}
            onClick={() => (listening ? stopSTT() : startSTT())}
            disabled={!sttSupported}
          >
            {listening ? "⏹" : "🎙"}
          </button>
          <button className="end" title="Akhirkan call" onClick={endCall}>
            ✕
          </button>
        </div>

        {!sttSupported && (
          <div style={{ fontSize: 11, color: "var(--danger)" }}>
            Browser ini tidak mendukung Speech Recognition. Gunakan Chrome/Edge/Safari.
          </div>
        )}
      </div>
    </div>
  );
}
