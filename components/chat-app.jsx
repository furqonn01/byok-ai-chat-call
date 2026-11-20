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
import IosSelect from "./ios-select";
import ModelCombobox from "./model-combobox";
import { TTS_LANGS, STT_LANGS } from "@/lib/speech-langs";
import { prefetchWhisper } from "@/lib/whisper-client";

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
  ttsLang: "id",
  sttLang: "id-ID",
  autoSpeak: false,
  systemPrompt: "Kamu asisten yang membantu, jawaban singkat dan jelas.",
};

export function ChatApp() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [showKey, setShowKey] = useState(false);
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
  const textareaRef = useRef(null);

  // ── Mode panggilan (loop dikendalikan di sini) ──
  const [callPhase, setCallPhase] = useState("connecting");
  const [callSeconds, setCallSeconds] = useState(0);
  const [callLastText, setCallLastText] = useState("");
  const callModeRef = useRef(false);
  const callTranscriptRef = useRef("");
  const sendRef = useRef(null);
  const speakRef = useRef(null);
  const startSTTRef = useRef(null);
  const stopSTTRef = useRef(null);
  const callTurnRef = useRef(null);

  // Muat settings + konversasi dari IndexedDB setelah mount
  useEffect(() => {
    (async () => {
      const [loadedSettings, loadedConvs] = await Promise.all([
        loadSettings(DEFAULT_SETTINGS),
        loadConversations(),
      ]);
      setSettings(loadedSettings);
      setConversations(loadedConvs);
      // Daftar model di-cache agar tetap ada setelah refresh
      let cached = [];
      try {
        cached = JSON.parse(localStorage.getItem("sharkie-models") || "[]");
      } catch {
        cached = [];
      }
      if (Array.isArray(cached) && cached.length) setModelList(cached);
      setLoaded(true);
    })();

    // Kunjungan pertama: unduh model Whisper di background (idle) agar
    // transkripsi offline siap saat dibutuhkan. Diam saja bila gagal.
    const idle =
      window.requestIdleCallback || ((fn) => setTimeout(fn, 4000));
    idle(() => prefetchWhisper());
  }, []);

  // Persist ke IndexedDB
  usePersistence({ conversations, settings, loaded });

  const {
    listening,
    supported: sttSupported,
    start: startSTT,
    stop: stopSTT,
  } = useSpeechRecognition({
    lang: settings.sttLang,
    continuous: false,
    onResult: ({ final, interim: partial }) => {
      if (final) {
        callTranscriptRef.current = (callTranscriptRef.current + " " + final).trim();
        if (!callModeRef.current) {
          setInput((prev) => (prev ? prev + " " : "") + final.trim());
        }
      }
      setInterim(partial || "");
    },
    onEnd: ({ error: micError } = {}) => {
      setInterim("");
      if (micError) setError(micError);
      else setError(null);

      // Selesai bicara di mode panggilan → kirim transkrip ke AI
      if (callModeRef.current && callTranscriptRef.current.trim()) {
        const said = callTranscriptRef.current.trim();
        callTranscriptRef.current = "";
        callTurnRef.current?.(said);
      }
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

  const updateSettings = (patch) => {
    // Ganti provider: reset model ke default & buang cache daftar model lama
    if (patch.provider) {
      setModelList([]);
      try {
        localStorage.removeItem("sharkie-models");
      } catch {
        /* ignore */
      }
    }
    setSettings((s) => {
      const next = { ...s, ...patch };
      if (patch.provider && !patch.model) {
        next.model = DEFAULT_MODELS[patch.provider] || "";
      }
      return next;
    });
  };

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
      // Cache lintas-refresh supaya dropdown tidak kosong setelah reload
      try {
        localStorage.setItem("sharkie-models", JSON.stringify(data.models));
      } catch {
        /* storage penuh / private mode */
      }
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
      .filter((m) => m.role !== "error" && (m.content?.trim() || m.images?.length))
      .map((m) => {
        if (!m.images?.length) {
          return { role: m.role, content: m.content };
        }
        return {
          role: m.role,
          content: [
            ...(m.content?.trim() ? [{ type: "text", text: m.content }] : []),
            ...m.images.map((src) => ({
              type: "image_url",
              image_url: { url: src },
            })),
          ],
        };
      });
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
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setLoading(true);

      const baseConv = isNew
        ? { messages: [newUserMsg] }
        : conversations.find((c) => c.id === conversationId);
      const apiMessages = [
        { role: "system", content: settings.systemPrompt },
        ...getHistoryBase(baseConv, newUserMsg),
      ];

      try {
        const reply = await streamSend(conversationId, apiMessages);
        if (settings.autoSpeak && reply) {
          speak(reply, {
            voiceURI: settings.voiceURI,
            rate: settings.speechRate,
            lang: settings.ttsLang,
          });
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

  // ── Loop mode panggilan ──
  // greeting → TTS selesai → STT → transkrip final → kirim → TTS → STT …
  const callSay = useCallback(
    (text, onDone) => {
      if (!text) {
        onDone?.();
        return;
      }
      speakRef.current?.(text, {
        voiceURI: settings.voiceURI,
        rate: settings.speechRate,
        lang: settings.ttsLang,
        onEnd: () => {
          if (!callModeRef.current) return;
          onDone?.();
        },
      });
    },
    [settings.voiceURI, settings.speechRate, settings.ttsLang]
  );

  const callListen = useCallback(() => {
    if (!callModeRef.current) return;
    callTranscriptRef.current = "";
    setCallPhase("listening");
    startSTTRef.current?.();
  }, []);

  const callTurn = useCallback(
    async (userText) => {
      if (!callModeRef.current || !userText?.trim()) {
        callListen();
        return;
      }
      setCallPhase("talking");
      setCallLastText("");
      const reply = await sendRef.current?.(userText, []);
      if (!callModeRef.current) return;
      if (reply) {
        setCallLastText(reply);
        callSay(reply, callListen);
      } else {
        callListen();
      }
    },
    [callSay, callListen]
  );

  const endCall = useCallback(() => {
    callModeRef.current = false;
    stopSTTRef.current?.();
    cancelSpeech();
    setCallOpen(false);
    setCallPhase("connecting");
    setCallSeconds(0);
    setCallLastText("");
    setInterim("");
  }, [cancelSpeech]);

  const startCall = useCallback(() => {
    if (!settings.apiKey) {
      setError("Isi API key dulu sebelum memulai panggilan.");
      return;
    }
    callModeRef.current = true;
    setCallSeconds(0);
    setCallLastText("");
    setCallPhase("connecting");
    setCallOpen(true);

    const greeting = "Halo! Saya Sharkie. Ada yang bisa saya bantu?";
    setCallLastText(greeting);
    setTimeout(() => {
      if (!callModeRef.current) return;
      callSay(greeting, callListen);
    }, 350);
  }, [settings.apiKey, callSay, callListen]);

  // Timer durasi panggilan
  useEffect(() => {
    if (!callOpen) return;
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [callOpen]);

  const toggleCallMic = () => {
    if (listening) stopSTT();
    else {
      callTranscriptRef.current = "";
      startSTT();
    }
  };

  // Sinkronkan ref agar loop panggilan selalu memakai versi terbaru
  useEffect(() => {
    sendRef.current = send;
    speakRef.current = speak;
    startSTTRef.current = startSTT;
    stopSTTRef.current = stopSTT;
    callTurnRef.current = callTurn;
  });

  const submit = () => send(input, attachedImages);

  // Auto-resize textarea mengikuti isi (maks 140px)
  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  };

  const onInputChange = (e) => {
    setInput(e.target.value);
    resizeTextarea();
  };

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
    if (last)
      speak(last.content, {
        voiceURI: settings.voiceURI,
        rate: settings.speechRate,
        lang: settings.ttsLang,
      });
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
    <div className="app">
      <header className="header">
        <button
          className="btn menu-toggle"
          title="Buka sidebar"
          aria-label="Buka sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          <i className="bi bi-list" aria-hidden="true" />
        </button>
        <h1>Sharkie AI Chat-Call</h1>
        <div className="actions">
          <button className="btn primary" onClick={startCall}>
            <i className="bi bi-telephone-fill" aria-hidden="true" /> Call
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
            <IosSelect
              value={settings.provider}
              onChange={(v) => updateSettings({ provider: v })}
              options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
              ariaLabel="Pilih provider"
            />
          </div>

          <div className="field">
            <label htmlFor="api-key-input">API Key</label>
            <form
              className="api-key-form"
              onSubmit={(e) => e.preventDefault()}
              autoComplete="on"
            >
              <div className="api-key-wrap">
                <input
                  id="api-key-input"
                  type={showKey ? "text" : "password"}
                  value={settings.apiKey}
                  placeholder="sk-..."
                  autoComplete="off"
                  onChange={(e) => updateSettings({ apiKey: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn key-toggle"
                  aria-label={showKey ? "Sembunyikan API key" : "Tampilkan API key"}
                  onClick={() => setShowKey((v) => !v)}
                >
                  <i
                    className={showKey ? "bi bi-eye-slash" : "bi bi-eye"}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </form>
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
            <ModelCombobox
              value={settings.model}
              onChange={(v) => updateSettings({ model: v })}
              options={modelList}
            />
            <button
              className="btn small"
              disabled={modelLoading || !settings.apiKey}
              onClick={fetchModels}
            >
              {modelLoading ? (
                "Memuat…"
              ) : (
                <>
                  <i className="bi bi-arrow-repeat" aria-hidden="true" /> Fetch
                  Models
                </>
              )}
            </button>
          </div>

          <div className="section-title">Suara & Bahasa</div>

          <div className="field">
            <label className="switch-row">
              <span>Auto-speak balasan</span>
              <input
                type="checkbox"
                className="switch"
                checked={settings.autoSpeak}
                onChange={(e) => updateSettings({ autoSpeak: e.target.checked })}
              />
            </label>
          </div>

          <div className="field">
            <label>Bahasa suara AI (TTS)</label>
            <IosSelect
              value={settings.ttsLang}
              onChange={(v) => updateSettings({ ttsLang: v })}
              options={TTS_LANGS.map((l) => ({ value: l.code, label: l.label }))}
              ariaLabel="Bahasa suara AI"
            />
            <div className="hint">Suara Google, jalan di semua browser.</div>
          </div>

          <div className="field">
            <label>Bahasa input mic (STT)</label>
            <IosSelect
              value={settings.sttLang}
              onChange={(v) => updateSettings({ sttLang: v })}
              options={STT_LANGS.map((l) => ({ value: l.code, label: l.label }))}
              ariaLabel="Bahasa input mic"
            />
          </div>

          <div className="field">
            <label>
              Kecepatan bicara — {settings.speechRate.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.speechRate}
              style={{
                "--p": `${((settings.speechRate - 0.5) / 1.5) * 100}%`,
              }}
              onChange={(e) =>
                updateSettings({ speechRate: Number(e.target.value) })
              }
            />
          </div>

          {settings.autoSpeak && voices.length > 0 && (
            <div className="field">
              <label>Voice fallback (offline)</label>
              <IosSelect
                value={settings.voiceURI}
                onChange={(v) => updateSettings({ voiceURI: v })}
                options={[
                  { value: "", label: "(default)" },
                  ...voices.map((v) => ({
                    value: v.voiceURI,
                    label: `${v.name} (${v.lang})`,
                  })),
                ]}
                ariaLabel="Voice fallback"
              />
              <div className="hint">
                Dipakai hanya bila Google TTS gagal.
              </div>
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
                  onClick={() => {
                    setActiveId(c.id);
                    setSidebarOpen(false);
                  }}
                >
                  {c.title}
                </button>
                <button
                  className="icon-btn conv-delete"
                  title="Hapus percakapan"
                  onClick={() => removeConversation(c.id)}
                >
                  <i className="bi bi-trash3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          {/* ── Riwayat ── */}
          <div className="section-title">
            <button className="btn small link" onClick={() => setHistoryOpen(!historyOpen)}>
              <i className="bi bi-clock-history" aria-hidden="true" /> Riwayat{" "}
              <i
                className={`bi bi-chevron-${historyOpen ? "up" : "down"}`}
                aria-hidden="true"
              />
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
                      <i className="bi bi-trash3" aria-hidden="true" />
                    </button>
                  </div>
                  {convs.map((c) => (
                    <button
                      key={c.id}
                      className="item history-item"
                      onClick={() => openConversationFromHistory(c.id)}
                    >
                      <i className="bi bi-box-arrow-in-right" aria-hidden="true" /> {c.title}
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(groupedHistory).length > 0 && (
                <button className="btn danger small" onClick={handleDeleteAll}>
                  <i className="bi bi-trash3" aria-hidden="true" /> Hapus Semua
                </button>
              )}
            </div>
          )}

          {/* ── Umpan Balik ── */}
          <div className="section-title">Umpan Balik</div>
          <div className="feedback-buttons">
            <button className="btn small" onClick={() => setFeedbackOpen(true)}>
              <i className="bi bi-chat-dots" aria-hidden="true" /> Beri Umpan Balik
            </button>
            <button className="btn small" onClick={() => setRateOpen(true)}>
              <i className="bi bi-star" aria-hidden="true" /> Rate App
            </button>
            <button className="btn small" onClick={() => setSupportOpen(true)}>
              <i className="bi bi-life-preserver" aria-hidden="true" /> Dukungan
            </button>
          </div>
        </aside>

        <section className="main">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="big">
                  <i className="bi bi-chat-dots-fill" aria-hidden="true" />
                </div>
                <div>Mulai percakapan atau tekan tombol Call.</div>
                <div className="hint">
                  Isi API key di panel pengaturan dulu.
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`message ${
                    m.role === "user" ? "user" : m.role === "error" ? "error" : "assistant"
                  }${messages[i + 1]?.role === m.role && m.role !== "error" ? " grouped" : ""}`}
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
                    <span className="stream-cursor" />}
                </div>
              ))
            )}
            {loading && <div className="typing">AI sedang mengetik…</div>}
            <div ref={messagesEndRef} />
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
              <span>{error}</span>
              <button
                className="icon-btn"
                aria-label="Tutup pesan galat"
                onClick={() => setError(null)}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </div>
          )}

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

          {listening && (
            <div className="listening-bar" role="status" aria-live="polite">
              <span className="dot-wave">
                <span /> <span /> <span />
              </span>
              <span className="listening-text">
                {interim ? interim : "Mendengarkan…"}
              </span>
            </div>
          )}

          <div className="composer">
            <button
              className="icon-btn"
              title="Lampirkan gambar (vision)"
              onClick={() => fileInputRef.current?.click()}
            >
              <i className="bi bi-image" aria-hidden="true" />
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
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKey}
              placeholder={
              listening
                ? "Mendengarkan… bicara sekarang"
                : sttSupported
                  ? "Ketik atau tekan mic untuk bicara…"
                  : "Ketik pesan…"
            }
              rows={1}
            />
            {sttSupported && (
              <button
                className={`icon-btn ${listening ? "active listening" : ""}`}
                title={listening ? "Berhenti dengar" : "Bicara (STT)"}
                aria-label={listening ? "Berhenti dengar" : "Bicara"}
                onClick={toggleSTT}
              >
                {listening ? (
                  <span className="mic-pulse">
                    <i className="bi bi-stop-fill" aria-hidden="true" />
                  </span>
                ) : (
                  <i className="bi bi-mic-fill" aria-hidden="true" />
                )}
              </button>
            )}
            {ttsSupported && (
              <button
                className={`icon-btn ${speaking ? "active" : ""}`}
                title="Baca balasan terakhir (TTS)"
                onClick={speakLast}
              >
                <i className="bi bi-volume-up-fill" aria-hidden="true" />
              </button>
            )}
            {streaming ? (
              <button className="btn danger" onClick={stopStreaming}>
                <i className="bi bi-stop-fill" aria-hidden="true" /> Stop
              </button>
            ) : (
              <button
                className={`btn primary ${loading ? "danger" : ""}`}
                disabled={loading}
                onClick={submit}
              >
                {loading ? (
                  <span className="spinner" aria-label="Mengirim" />
                ) : (
                  <i className="bi bi-arrow-up" aria-label="Kirim" />
                )}
              </button>
            )}
          </div>
        </section>
      </div>

      {callOpen && (
        <CallModal
          phase={callPhase}
          seconds={callSeconds}
          lastText={callLastText}
          interim={interim}
          listening={listening}
          sttSupported={sttSupported}
          onToggleMic={toggleCallMic}
          onEnd={endCall}
        />
      )}

      {/* ── Modal Feedback ── */}
      {feedbackOpen && (
        <div className="modal-overlay" onClick={() => setFeedbackOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              <i className="bi bi-chat-dots" aria-hidden="true" /> Beri Umpan
              Balik
            </h3>
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
            <h3>
              <i className="bi bi-star" aria-hidden="true" /> Rate App
            </h3>
            <p>Seberapa puas Anda dengan Sharkie AI Chat-Call?</p>
            <div className="rating-input large">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`star large ${rating >= n ? "active" : ""}`}
                  aria-label={`Beri ${n} bintang`}
                  onClick={() => setRating(n)}
                >
                  <i className="bi bi-star-fill" aria-hidden="true" />
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
            <h3>
              <i className="bi bi-life-preserver" aria-hidden="true" /> Dukungan
            </h3>
            <p>Ada masalah atau pertanyaan? Hubungi kami:</p>
            <ul className="support-links">
              <li>
                <a href="mailto:support@byokchat.example">
                  <i className="bi bi-envelope" aria-hidden="true" /> support@byokchat.example
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/byok-chat/byok-chat"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i className="bi bi-bug" aria-hidden="true" /> Laporan Bug (GitHub)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/byok-chat/byok-chat/wiki"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i className="bi bi-book" aria-hidden="true" /> Dokumentasi / FAQ
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
    </div>
  );
}

export default ChatApp;
