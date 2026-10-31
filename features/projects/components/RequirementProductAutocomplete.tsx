import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";

import { planningProductChoiceLimit, type PlanningProductChoice } from "../services/projectPlanningService";

const productLabel = (product: PlanningProductChoice) => `${product.name} — ${product.serialNumber}`;

export function RequirementProductAutocomplete({
  choices, pending, error, onRetry, search, onSearch, initialProduct, onSelect, disabled,
}: {
  choices: PlanningProductChoice[];
  pending: boolean;
  error: string | null;
  onRetry: () => void;
  search: string;
  onSearch: (value: string) => void;
  initialProduct: PlanningProductChoice | null;
  onSelect: (productId: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(initialProduct);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 256 });
  const query = search.trim();
  // Mirror the existing search contract: name contains / serial prefix.
  // Only search the authorized results supplied by the existing query hook.
  const results = choices.filter(choice => !query ||
    choice.name.toLowerCase().includes(query.toLowerCase()) || choice.serialNumber.startsWith(query));
  const popupOpen = open && !disabled;
  const available = !pending && !error ? results : [];
  const active = available[activeIndex];

  useEffect(() => { inputRef.current?.focus(); }, []);

  useLayoutEffect(() => {
    if (!popupOpen) return;
    function place() {
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const flip = below < 160 && above > below;
      const maxHeight = Math.max(0, Math.min(256, flip ? above : below));
      setPosition({ left: rect.left, width: rect.width, maxHeight,
        top: flip ? rect.top - maxHeight - 4 : rect.bottom + 4 });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [popupOpen]);

  useEffect(() => {
    if (popupOpen && active) {
      document.getElementById(`${id}-option-${active.productId}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [popupOpen, active, id]);

  useEffect(() => {
    if (!popupOpen) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!fieldRef.current?.contains(target) && !popupRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [popupOpen]);

  function select(product: PlanningProductChoice) {
    setSelected(product);
    onSelect(product.productId);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-zinc-800">Product</label>
      <div ref={fieldRef} className="relative mt-2">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={popupOpen}
          aria-controls={popupOpen ? `${id}-results` : undefined}
          aria-activedescendant={popupOpen && active ? `${id}-option-${active.productId}` : undefined}
          aria-describedby={`${id}-help`}
          autoComplete="off"
          placeholder="Search by name or serial number"
          value={selected ? productLabel(selected) : search}
          disabled={disabled}
          className="w-full rounded-xl border border-zinc-300 bg-white py-3 pl-4 pr-16 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-50"
          onFocus={() => setOpen(true)}
          onChange={event => {
            setSelected(null);
            onSelect("");
            onSearch(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onBlur={event => {
            if (!fieldRef.current?.contains(event.relatedTarget as Node) &&
              !popupRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
          }}
          onKeyDown={event => {
            if (event.key === "Escape" && popupOpen) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActiveIndex(-1);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex(index => available.length === 0 ? -1 :
                !popupOpen || index < 0 ? (step === 1 ? 0 : available.length - 1) :
                  (index + step + available.length) % available.length);
            } else if (event.key === "Enter" && popupOpen) {
              event.preventDefault();
              if (active) select(active);
            } else if (event.key === "Tab") setOpen(false);
          }}
        />
        {(selected || search) && (
          <button type="button" aria-label="Clear Product selection" disabled={disabled}
            className="absolute right-7 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            onClick={() => {
              setSelected(null); onSelect(""); onSearch(""); setActiveIndex(-1);
              inputRef.current?.focus(); setOpen(true);
            }}><X size={16} aria-hidden="true" /></button>
        )}
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      </div>
      <p id={`${id}-help`} className="mt-1 text-xs text-zinc-500">Search by Product name or serial number. Use arrow keys and Enter to select.</p>
      {popupOpen && createPortal(
        <div ref={popupRef} style={position}
          className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white p-1 shadow-xl"
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault(); event.stopPropagation();
              inputRef.current?.focus(); setOpen(false);
            }
          }}>
          {pending ? <p role="status" className="px-3 py-3 text-sm text-zinc-500">Loading Product choices...</p> :
            error ? <p role="alert" className="px-3 py-3 text-sm text-red-700">{error}{" "}
              <button type="button" className="rounded underline focus:ring-2 focus:ring-zinc-400" onClick={onRetry}>Try again</button>
            </p> : available.length === 0 ?
              <p role="status" className="px-3 py-3 text-sm text-zinc-500">No products found</p> : null}
              <ul id={`${id}-results`} role="listbox" aria-label="Product search results" aria-busy={pending}>
                {available.map((choice, index) => (
                  <li key={choice.productId} id={`${id}-option-${choice.productId}`} role="option"
                    aria-selected={selected?.productId === choice.productId}
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(choice)}
                    className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${index === activeIndex ? "bg-zinc-100" : "hover:bg-zinc-50"}`}>
                    <span className="block break-words font-semibold text-zinc-900">{choice.name}</span>
                    <span className="block text-xs text-zinc-500">{choice.serialNumber} · {choice.productKind === "pcb_finished_good" ? "Finished PCB Product" : "Component"}</span>
                  </li>
                ))}
              </ul>
          {!pending && !error && choices.length >= planningProductChoiceLimit &&
            <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">Showing up to {planningProductChoiceLimit} matches. Refine your search to find more Products.</p>}
        </div>, document.body,
      )}
    </div>
  );
}
