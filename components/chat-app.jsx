"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import { useSpeechSynthesis } from "@/lib/use-speech-synthesis";
import {
  saveSettings,
  loadSettings,
  saveConversations,
  loadConversations,
  deleteConversation,
  deleteConversationByDate,
  deleteAllConversations,
  groupConversationsByDate,
  usePersistence,
} from "@/lib/persistence";
import CallModal from "./call-modal";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "groq", label: "Groq" },
  { id: "mistral", label: "Mistral" },
  { id: "custom", label: "Custom (OpenAI-compatible)" },
];

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  custom: "",
};

const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: DEFAULT_MODELS.openai,
  voiceURI: "",
  speechRate: 1,
  lang: "id-ID",
  autoSpeak: false,
  systemPrompt: "Kamu asisten yang membantu, jawaban singkat dan jelas.",
};

export function ChatApp() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [callOpen, setCallOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [modelList, setModelList] = useState([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [feedback, setFeedback] = useState({ text: "", email: "", rating: 0 });
  const [rating, setRating] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);

  // Muat settings + konversasi dari IndexedDB setelah mount
  useEffect(() => {
    (async () => {
      const [loadedSettings, loadedConvs] = await Promise.all([
        loadSettings(DEFAULT_SETTINGS),
        loadConversations(),
      ]);
      setSettings(loadedSettings);
      setConversations(loadedConvs);
      setLoaded(true);
    })();
  }, []);

  // Persist ke IndexedDB
  usePersistence({ conversations, settings, loaded });

  const {
    listening,
    supported: sttSupported,
    start: startSTT,
    stop: stopSTT,
  } = useSpeechRecognition({
    lang: settings.lang,
    continuous: false,
    onResult: ({ transcript }) => {
      setInput((prev) => (prev ? prev + " " : "") + transcript.trim());
    },
    onEnd: ({ error: micError } = {}) => {
      if (micError) setError(micError);
      else setError(null);
    },
  });

  const {
    speaking,
    supported: ttsSupported,
    voices,
    speak,
    cancel: cancelSpeech,
  } = useSpeechSynthesis();

  // Auto scroll ke bawah
  const activeConversation = conversations.find((c) => c.id === activeId);
  const messages = activeConversation?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  const updateSettings = (patch) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      if (patch.provider && !patch.model) {
        next.model = DEFAULT_MODELS[patch.provider] || "";
      }
      return next;
    });

  const newConversation = useCallback(() => {
    stopSTT();
    cancelSpeech();
    abortRef.current?.abort();
    setActiveId(null);
    setAttachedImages([]);
    setError(null);
  }, [stopSTT, cancelSpeech]);

  // Ambil daftar model dari provider
  const fetchModels = useCallback(async () => {
    if (!settings.apiKey) return;
    setModelLoading(true);
    try {
      const q = new URLSearchParams({
        provider: settings.provider,
        apiKey: settings.apiKey,
        ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      });
      const res = await fetch(`/api/models?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal ambil model");
      setModelList(data.models);
    } catch (e) {
      setError(e.message);
    } finally {
      setModelLoading(false);
    }
  }, [settings]);

  // Hapus satu konversasi
  const removeConversation = useCallback((id) => {
    deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      abortRef.current?.abort();
      setActiveId(null);
    }
  }, [activeId]);

  const getHistoryBase = (conv, newUserMsg) => {
    const msgs = conv?.messages
      ? [...conv.messages, newUserMsg]
      : [newUserMsg];
    return msgs
      .filter((m) => m.role !== "error")
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images } : {}),
      }));
  };

  // Streaming SSE: kirim pesan, update placeholder asisten per chunk
  const streamSend = useCallback(async (conversationId, apiMessages) => {
    abortRef.current = new AbortController();
    setStreaming(true);
    let full = "";

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortRef.current.signal,
      body: JSON.stringify({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: apiMessages,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            const snapshot = full;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === conversationId
                  ? {
                      ...c,
                      messages: [
                        ...c.messages.slice(0, -1),
                        { role: "assistant", content: snapshot },
                      ],
                    }
                  : c
              )
            );
          }
        } catch {
          /* partial line */
        }
      }
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: [
                ...c.messages.slice(0, -1),
                { role: "assistant", content: full || "(respon kosong)" },
              ],
            }
          : c
      )
    );
    return full;
  }, [settings]);

  // Kirim pesan dengan streaming SSE
  const send = useCallback(
    async (text, images = []) => {
      const content = text.trim();
      if ((!content && !images.length) || loading || streaming) return;

      setError(null);

      const isNew = !activeId || !conversations.find((c) => c.id === activeId);
      const conversationId = isNew
        ? "conv-" + Date.now().toString(36)
        : activeId;

      const newUserMsg = { role: "user", content, images };
      const today = new Date().toISOString().slice(0, 10);

      if (isNew) {
        setConversations((prev) => [
          {
            id: conversationId,
            title: content.slice(0, 40) || "Chat baru",
            date: today,
            messages: [newUserMsg],
          },
          ...prev,
        ].slice(0, 50));
        setActiveId(conversationId);
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, date: today, messages: [...c.messages, newUserMsg] }
              : c
          )
        );
      }

      // Placeholder asisten kosong untuk streaming
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, { role: "assistant", content: "" }] }
            : c
        )
      );

      setInput("");
      setAttachedImages([]);
      setLoading(true);

      const baseConv = isNew
        ? { messages: [newUserMsg] }
        : conversations.find((c) => c.id === conversationId);
      const apiMessages = [
        { role: "system", content: settings.systemPrompt },
        ...getHistoryBase(baseConv, newUserMsg),
      ];

      if (images.length) {
        const lastUser = apiMessages[apiMessages.length - 1];
        lastUser.content = [
          ...(content ? [{ type: "text", text: content }] : []),
          ...images.map((src) => ({
            type: "image_url",
            image_url: { url: src },
          })),
        ];
      }

      try {
        const reply = await streamSend(conversationId, apiMessages);
        if (settings.autoSpeak && reply) {
          speak(reply, { voiceURI: settings.voiceURI, rate: settings.speechRate });
        }
        return reply;
      } catch (err) {
        if (err.name === "AbortError") {
          // dibatalkan user, placeholder sudah terisi sebagian
        } else {
          setError(err.message);
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    messages: [
                      ...c.messages.slice(0, -1),
                      { role: "error", content: err.message },
                    ],
                  }
                : c
            )
          );
        }
      } finally {
        setStreaming(false);
        setLoading(false);
      }
    },
    [activeId, conversations, loading, streaming, settings, speak, streamSend]
  );

  const stopStreaming = () => abortRef.current?.abort();

  const submit = () => send(input, attachedImages);

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onFile = (e) => {
    const files = Array.from(e.target.files || []);
    Promise.all(
      files.map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(f);
          })
      )
    ).then((urls) => setAttachedImages((prev) => [...prev, ...urls]));
    e.target.value = "";
  };

  const toggleSTT = () => {
    if (listening) stopSTT();
    else startSTT();
  };

  const speakLast = () => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (last) speak(last.content, { voiceURI: settings.voiceURI, rate: settings.speechRate });
  };

  // Riwayat: group per tanggal
  const groupedHistory = groupConversationsByDate(conversations);

  const handleDeleteByDate = (dateKey) => {
    deleteConversationByDate(dateKey);
    setConversations((prev) =>
      prev.filter((c) => {
        const d = c.date || (c.updatedAt ? new Date(c.updatedAt).toISOString().slice(0, 10) : "unknown");
        return d !== dateKey;
      })
    );
  };

  const handleDeleteAll = () => {
    if (!window.confirm("Hapus semua konversasi? Tindakan ini tidak bisa dibatalkan.")) return;
    deleteAllConversations();
    setConversations([]);
    setActiveId(null);
  };

  const openConversationFromHistory = (id) => {
    setActiveId(id);
    setHistoryOpen(false);
    setSidebarOpen(false);
  };

  const submitFeedback = async () => {
    if (!feedback.text.trim()) return;
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...feedback, type: "feedback" }),
    });
    setFeedbackOpen(false);
    setFeedback({ text: "", email: "", rating: 0 });
  };

  const submitRate = async () => {
    if (!rating) return;
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, type: "rate" }),
    });
    setRateOpen(false);
    setRating(0);
  };

  // Cek apakah pesan terakhir asisten masih streaming (untuk kursor ▍)
  const isStreamingLastAssistant =
    streaming && messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <>
      <header className="header">
        <button
          className="btn menu-toggle"
          title="Buka sidebar"
          aria-label="Buka sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        <h1>BYOK Chat AI</h1>
        <div className="actions">
          <button className="btn primary" onClick={() => setCallOpen(true)}>
            📞 Call
          </button>
          <button className="btn" onClick={newConversation}>
            + New
          </button>
        </div>
      </header>

      <div className="body">
        {sidebarOpen && (
          <div
            className="sidebar-backdrop show"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="section-title">Bring Your Own Key</div>

          <div className="field">
            <label>Provider</label>
            <select
              value={settings.provider}
              onChange={(e) => updateSettings({ provider: e.target.value })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              value={settings.apiKey}
              placeholder="sk-..."
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
            />
            <div className="hint">
              Key disimpan hanya di browser (IndexedDB). Tidak dikirim ke
              server mana pun kecuali ke provider AI pilihanmu.
            </div>
          </div>

          {settings.provider === "custom" && (
            <div className="field">
              <label>Base URL</label>
              <input
                type="text"
                value={settings.baseUrl}
                placeholder="https://api.contoh.com/v1"
                onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              />
            </div>
          )}

          <div className="field">
            <label>Model</label>
            <input
              type="text"
              list="model-options"
              value={settings.model}
              placeholder="gpt-4o-mini"
              onChange={(e) => updateSettings({ model: e.target.value })}
            />
            <datalist id="model-options">
              {modelList.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              className="btn small"
              disabled={modelLoading || !settings.apiKey}
              onClick={fetchModels}
            >
              {modelLoading ? "Memuat…" : "🔄 Fetch Models"}
            </button>
          </div>

          <div className="section-title">Voice</div>

          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={settings.autoSpeak}
                onChange={(e) => updateSettings({ autoSpeak: e.target.checked })}
              />
              Auto-speak balasan
            </label>
          </div>

          {settings.autoSpeak && (
            <div className="field">
              <label>Voice</label>
              <select
                value={settings.voiceURI}
                onChange={(e) => updateSettings({ voiceURI: e.target.value })}
              >
                <option value="">(default)</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>System prompt</label>
            <input
              type="text"
              value={settings.systemPrompt}
              onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
            />
          </div>

          <div className="section-title">Konversasi</div>
          <div className="conversations">
            {conversations.length === 0 && (
              <div className="hint">Belum ada percakapan.</div>
            )}
            {conversations.map((c) => (
              <div key={c.id} className="conv-row">
                <button
                  className={`item ${c.id === activeId ? "active" : ""}`}
                  onClick={() => setActiveId(c.id)}
                >
                  {c.title}
                </button>
                <button
                  className="icon-btn conv-delete"
                  title="Hapus percakapan"
                  onClick={() => removeConversation(c.id)}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>

          {/* ── Riwayat ── */}
          <div className="section-title">
            <button className="btn small link" onClick={() => setHistoryOpen(!historyOpen)}>
              📂 Riwayat {historyOpen ? "▲" : "▼"}
            </button>
          </div>
          {historyOpen && (
            <div className="history-panel">
              {Object.entries(groupedHistory).map(([dateKey, convs]) => (
                <div key={dateKey} className="history-date-group">
                  <div className="history-date-header">
                    <span className="history-date-label">{dateKey}</span>
                    <span className="hint">{convs.length} chat</span>
                    <button
                      className="icon-btn"
                      title={`Hapus semua pada ${dateKey}`}
                      onClick={() => handleDeleteByDate(dateKey)}
                    >
                      🗑
                    </button>
                  </div>
                  {convs.map((c) => (
                    <button
                      key={c.id}
                      className="item history-item"
                      onClick={() => openConversationFromHistory(c.id)}
                    >
                      ↩️ {c.title}
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(groupedHistory).length > 0 && (
                <button className="btn danger small" onClick={handleDeleteAll}>
                  🗑 Hapus Semua
                </button>
              )}
            </div>
          )}

          {/* ── Umpan Balik ── */}
          <div className="section-title">Umpan Balik</div>
          <div className="feedback-buttons">
            <button className="btn small" onClick={() => setFeedbackOpen(true)}>
              💬 Beri Umpan Balik
            </button>
            <button className="btn small" onClick={() => setRateOpen(true)}>
              ⭐ Rate App
            </button>
            <button className="btn small" onClick={() => setSupportOpen(true)}>
              🛟 Dukungan
            </button>
          </div>
        </aside>

        <section className="main">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="big">💬</div>
                <div>Mulai percakapan atau tekan tombol 📞 Call.</div>
                <div className="hint">
                  Pastikan API key sudah diisi di panel kiri.
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`message ${
                    m.role === "user" ? "user" : m.role === "error" ? "error" : "assistant"
                  }`}
                >
                  {m.images?.length > 0 && (
                    <div>
                      {m.images.map((src, j) => (
                        <img key={j} src={src} alt={`lampiran ${j}`} />
                      ))}
                    </div>
                  )}
                  {m.content}
                  {i === messages.length - 1 &&
                    isStreamingLastAssistant &&
                    <span className="stream-cursor">▍</span>}
                </div>
              ))
            )}
            {loading && <div className="typing">AI sedang mengetik…</div>}
            <div ref={messagesEndRef} />
          </div>

          {attachedImages.length > 0 && (
            <div className="attached-images">
              {attachedImages.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`lampiran ${i}`}
                  onError={(e) => (e.target.style.display = "none")}
                />
              ))}
            </div>
          )}

          <div className="composer">
            <button
              className="icon-btn"
              title="Lampirkan gambar (vision)"
              onClick={() => fileInputRef.current?.click()}
            >
              🖼
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={onFile}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={sttSupported ? "Ketik atau tekan mic untuk bicara…" : "Ketik pesan…"}
              rows={1}
            />
            {sttSupported && (
              <button
                className={`icon-btn ${listening ? "active" : ""}`}
                title={listening ? "Berhenti dengar" : "Bicara (STT)"}
                onClick={toggleSTT}
              >
                {listening ? "⏹" : "🎙"}
              </button>
            )}
            {ttsSupported && (
              <button
                className={`icon-btn ${speaking ? "active" : ""}`}
                title="Baca balasan terakhir (TTS)"
                onClick={speakLast}
              >
                🔊
              </button>
            )}
            {streaming ? (
              <button className="btn danger" onClick={stopStreaming}>
                ⏹ Stop
              </button>
            ) : (
              <button
                className={`btn primary ${loading ? "danger" : ""}`}
                disabled={loading}
                onClick={submit}
              >
                {loading ? "…" : "Kirim"}
              </button>
            )}
          </div>
        </section>
      </div>

      {callOpen && (
        <CallModal
          settings={settings}
          onClose={() => setCallOpen(false)}
          onSend={send}
          speak={speak}
        />
      )}

      {/* ── Modal Feedback ── */}
      {feedbackOpen && (
        <div className="modal-overlay" onClick={() => setFeedbackOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>💬 Beri Umpan Balik</h3>
            <textarea
              value={feedback.text}
              onChange={(e) => setFeedback({ ...feedback, text: e.target.value })}
              placeholder="Apa yang bisa kami perbaiki?"
              rows={4}
              autoFocus
            />
            <input
              type="email"
              value={feedback.email}
              onChange={(e) => setFeedback({ ...feedback, email: e.target.value })}
              placeholder="Email (opsional)"
            />
            <div className="rating-input">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`star ${feedback.rating >= n ? "active" : ""}`}
                  onClick={() => setFeedback({ ...feedback, rating: n })}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setFeedbackOpen(false)}>
                Batal
              </button>
              <button
                className="btn primary"
                disabled={!feedback.text.trim()}
                onClick={submitFeedback}
              >
                Kirim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Rate ── */}
      {rateOpen && (
        <div className="modal-overlay" onClick={() => setRateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>⭐ Rate App</h3>
            <p>Seberapa puas Anda dengan BYOK Chat AI?</p>
            <div className="rating-input large">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`star large ${rating >= n ? "active" : ""}`}
                  onClick={() => setRating(n)}
                >
                  ★
                </button>
              ))}
            </div>
            {rating > 0 && <p className="hint">Terima kasih atas rating Anda!</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setRateOpen(false)}>
                Tutup
              </button>
              <button className="btn primary" disabled={!rating} onClick={submitRate}>
                Kirim Rating
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Support ── */}
      {supportOpen && (
        <div className="modal-overlay" onClick={() => setSupportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🛟 Dukungan</h3>
            <p>Ada masalah atau pertanyaan? Hubungi kami:</p>
            <ul className="support-links">
              <li>
                <a href="mailto:support@byokchat.example">📧 support@byokchat.example</a>
              </li>
              <li>
                <a
                  href="https://github.com/byok-chat/byok-chat"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🐛 Laporan Bug (GitHub)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/byok-chat/byok-chat/wiki"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  📖 Dokumentasi / FAQ
                </a>
              </li>
            </ul>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setSupportOpen(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ChatApp;
