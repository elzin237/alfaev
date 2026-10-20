import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";

import type { ProjectAlertNotification } from "../services/projectAlertService";

interface MenuPosition {
  left: number;
  top: number;
}

interface DashboardAlertActionsMenuProps {
  item: ProjectAlertNotification;
  disabled: boolean;
  onDismissRequest: (
    item: ProjectAlertNotification,
    returnFocusTo: HTMLButtonElement,
  ) => void;
}

function DashboardAlertActionsMenu({
  item,
  disabled,
  onDismissRequest,
}: DashboardAlertActionsMenuProps) {
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
    const left = Math.min(
      Math.max(edge, buttonBounds.right - menuBounds.width),
      maxLeft,
    );
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
    queueMicrotask(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        close();
      }
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
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close();
    }
  }

  const menu = open && createPortal(
    <div
      ref={menuRef}
      data-dashboard-alert-layer="menu"
      id={menuId}
      role="menu"
      aria-label={`Actions for ${item.activityTitle}`}
      onKeyDown={handleMenuKeyDown}
      style={position ? { left: position.left, top: position.top } : undefined}
      className={`fixed z-[70] min-w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl ${
        position ? "visible" : "invisible"
      }`}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          const returnFocusTo = buttonRef.current;
          if (!returnFocusTo) return;
          close();
          onDismissRequest(item, returnFocusTo);
        }}
        className="flex w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:bg-red-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500"
      >
        Dismiss notification
      </button>
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions for ${item.activityTitle}`}
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
        className="m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Ellipsis aria-hidden="true" className="size-5" strokeWidth={2} />
      </button>
      {menu}
    </>
  );
}

export default DashboardAlertActionsMenu;
