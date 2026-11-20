"use client";

/**
 * Mode "Call": tampilan panggilan (presentational).
 * Seluruh loop (greeting → TTS → STT → kirim → TTS) dikendalikan parent.
 */
export default function CallModal({
  phase = "connecting",
  seconds = 0,
  lastText = "",
  interim = "",
  listening = false,
  sttSupported = true,
  onToggleMic,
  onEnd,
}) {
  const statusText =
    phase === "connecting"
      ? "Menyambung…"
      : phase === "talking"
        ? "AI sedang bicara…"
        : phase === "listening"
          ? "Mendengarkan…"
          : "Selesai";

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const caption = interim || lastText;

  return (
    <div
      className="call-overlay"
      onClick={(e) => e.target === e.currentTarget && onEnd?.()}
    >
      <div className="call-card" role="dialog" aria-label="Mode panggilan">
        <div className={`call-avatar ${phase === "connecting" ? "ringing" : ""}`}>
          <i className="bi bi-water" aria-hidden="true" />
        </div>

        <div className="call-title">Sharkie Call</div>

        <div className="call-status">
          {statusText} · {mm}:{ss}
        </div>

        <div
          className={`call-wave ${phase === "talking" || listening ? "speaking" : ""}`}
          aria-hidden="true"
        >
          <span /> <span /> <span /> <span /> <span />
        </div>

        {caption && (
          <div className="call-caption" aria-live="polite">
            {caption}
          </div>
        )}

        <div className="call-controls">
          <button
            type="button"
            className={listening ? "mic-on" : ""}
            title={listening ? "Berhenti dengar" : "Bicara"}
            aria-label={listening ? "Berhenti dengar" : "Bicara"}
            onClick={() => onToggleMic?.()}
            disabled={!sttSupported}
          >
            {listening ? (
              <i className="bi bi-stop-fill" aria-hidden="true" />
            ) : (
              <i className="bi bi-mic-fill" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="end"
            title="Akhirkan panggilan"
            aria-label="Akhirkan panggilan"
            onClick={() => onEnd?.()}
          >
            <i className="bi bi-telephone-x-fill" aria-hidden="true" />
          </button>
        </div>

        {!sttSupported && (
          <div className="call-warn">
            Browser ini tidak mendukung mic. Gunakan Chrome, Edge, atau Safari.
          </div>
        )}
      </div>
    </div>
  );
}