"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Combobox model: input teks (bebas ketik) + panel glass berisi daftar model
 * dari provider. Tampilan panel identik dengan IosSelect.
 */
export default function ModelCombobox({
  value,
  onChange,
  options = [],
  placeholder = "gpt-4o-mini",
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const id = useId();

  const filtered = value
    ? options.filter((m) => m.toLowerCase().includes(value.toLowerCase()))
    : options;

  const hasList = options.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.focus();
        return;
      }
      if (!filtered.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => {
          const dir = e.key === "ArrowDown" ? 1 : -1;
          const start = i < 0 ? (dir === 1 ? 0 : filtered.length - 1) : i;
          return (start + dir + filtered.length) % filtered.length;
        });
      }
      if (e.key === "Enter" && activeIndex >= 0 && activeIndex < filtered.length) {
        e.preventDefault();
        onChange(filtered[activeIndex]);
        setOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, activeIndex, filtered, onChange]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={`ios-select model-select ${open ? "open" : ""}`} ref={rootRef}>
      <div className="model-input-wrap">
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label="Model"
          aria-expanded={open}
          aria-controls={id}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            if (hasList) setOpen(true);
          }}
          onFocus={() => hasList && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && hasList && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />
        {hasList && (
          <button
            type="button"
            className="model-chevron"
            aria-label={open ? "Tutup daftar model" : "Buka daftar model"}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
          >
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
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="ios-select-panel" role="listbox" id={id} ref={listRef}>
          {filtered.slice(0, 200).map((m, i) => {
            const isSelected = m === value;
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-active={i === activeIndex}
                className={`ios-select-option ${isSelected ? "selected" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <span>{m}</span>
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