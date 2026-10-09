import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DocumentationPdfActionsMenuProps {
  recordName: string;
  hasPdf: boolean;
  disabled: boolean;
  onUpload: () => void;
  onRemove: () => void;
}

interface MenuPosition {
  left: number;
  top: number;
}

function DocumentationPdfActionsMenu({
  recordName,
  hasPdf,
  disabled,
  onUpload,
  onRemove,
}: DocumentationPdfActionsMenuProps) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => buttonRef.current?.focus());
  }

  function positionMenu() {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const gap = 6;
    const edge = 8;
    const buttonBounds = button.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    const maxLeft = Math.max(edge, window.innerWidth - menuBounds.width - edge);
    const left = Math.min(Math.max(edge, buttonBounds.right - menuBounds.width), maxLeft);
    const below = buttonBounds.bottom + gap;
    const top = below + menuBounds.height <= window.innerHeight - edge
      ? below
      : Math.max(edge, buttonBounds.top - menuBounds.height - gap);
    setPosition({ left, top });
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    positionMenu();
    queueMicrotask(() => menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const handlePositionChange = () => positionMenu();
    document.addEventListener("mousedown", handleOutsidePointer);
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      window.removeEventListener("resize", handlePositionChange);
      window.removeEventListener("scroll", handlePositionChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open]);

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close();
    }
  }

  const menu = open && createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={`PDF actions for ${recordName}`}
      onKeyDown={handleMenuKeyDown}
      style={position ? { left: position.left, top: position.top } : undefined}
      className={`fixed z-[60] min-w-44 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl ${position ? "visible" : "invisible"}`}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => { close(true); onUpload(); }}
        className="flex w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-zinc-400"
      >
        {hasPdf ? "Replace PDF" : "Upload PDF"}
      </button>
      {hasPdf && (
        <button
          type="button"
          role="menuitem"
          onClick={() => { close(); onRemove(); }}
          className="flex w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:bg-red-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500"
        >
          Remove PDF
        </button>
      )}
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`PDF actions for ${recordName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close(true);
          }
        }}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        PDF <span aria-hidden="true" className="text-xs">▾</span>
      </button>
      {menu}
    </>
  );
}

export default DocumentationPdfActionsMenu;
