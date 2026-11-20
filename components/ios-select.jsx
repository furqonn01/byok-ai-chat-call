"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Dropdown bergaya iOS: tombol frosted glass + panel glassmorphism,
 * animasi spring, tutup saat klik luar / Esc, navigasi keyboard.
 *
 * Dipakai untuk Provider, Bahasa TTS/STT, dan Voice fallback.
 */
export default function IosSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = "Pilih…",
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const id = useId();

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => {
          const dir = e.key === "ArrowDown" ? 1 : -1;
          const start = i < 0 ? (dir === 1 ? 0 : options.length - 1) : i;
          return (start + dir + options.length) % options.length;
        });
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        onChange(options[activeIndex].value);
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, activeIndex, options, onChange]);

  useEffect(() => {
    if (open) {
      const i = options.findIndex((o) => o.value === value);
      setActiveIndex(i);
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector('[data-active="true"]')
          ?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [open, options, value]);

  return (
    <div className={`ios-select ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="ios-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? "" : "placeholder"}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 6.5 8 10.5l4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="ios-select-panel" role="listbox" id={id} ref={listRef}>
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-active={i === activeIndex}
                className={`ios-select-option ${isSelected ? "selected" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {isSelected && (
                  <svg className="check" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M3.5 8.5 6.5 11.5 12.5 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}