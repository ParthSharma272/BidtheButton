"use client";

import { useEffect, useRef } from "react";

/**
 * Accessible modal built on native <dialog>: real focus trapping, Escape to
 * close, inert background. We additionally restore focus to whatever opened
 * it, since not every browser does.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
  className = "",
  labelledBy,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: "right" | "bottom" | "center" | "full";
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      opener.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`sheet sheet-${side} ${wide ? "sheet-wide" : ""} ${className}`}
      aria-labelledby={labelledBy ?? (title ? "sheet-title" : undefined)}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet-inner">
          {title && (
            <header className="sheet-header">
              <h2 id="sheet-title">{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <CloseIcon />
              </button>
            </header>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}

export function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
