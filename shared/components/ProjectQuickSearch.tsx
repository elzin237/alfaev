import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router";

import { useProjectSearch } from "../../features/projects/hooks/useProjectSearch";
import { getProjectStatusPresentation } from "../../features/projects/projectStatus";
import type { ProjectSearchItem } from "../../features/projects/services/projectService";

const searchDebounceMs = 200;

interface ProjectQuickSearchProps {
  enabled: boolean;
}

function ProjectQuickSearch({ enabled }: ProjectQuickSearchProps) {
  const navigate = useNavigate();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedQuery = query.trim();
  const searchQuery = useProjectSearch(debouncedQuery, enabled);
  const queryIsSettled = normalizedQuery.length > 0 &&
    normalizedQuery === debouncedQuery;
  const results = queryIsSettled && searchQuery.data?.ok
    ? searchQuery.data.value
    : [];
  const popupOpen = enabled && open && normalizedQuery.length > 0;
  const loading = popupOpen && (!queryIsSettled || searchQuery.isPending);
  const failed = popupOpen && queryIsSettled && (
    searchQuery.isError || searchQuery.data?.ok === false
  );

  useEffect(() => {
    if (!normalizedQuery) {
      setDebouncedQuery("");
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(normalizedQuery);
    }, searchDebounceMs);

    return () => window.clearTimeout(timeout);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!popupOpen || results.length === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((current) =>
      current >= 0 && current < results.length ? current : 0
    );
  }, [popupOpen, results]);

  useEffect(() => {
    const handleOutsidePointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleOutsidePointer);
    return () => document.removeEventListener("mousedown", handleOutsidePointer);
  }, []);

  const selectProject = (project: ProjectSearchItem) => {
    setQuery("");
    setDebouncedQuery("");
    setOpen(false);
    setActiveIndex(-1);
    navigate(`/projects/${project.projectId}`);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (popupOpen) event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (results.length > 0) {
        setActiveIndex((current) => (current + 1) % results.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (results.length > 0) {
        setActiveIndex((current) =>
          current <= 0 ? results.length - 1 : current - 1
        );
      }
      return;
    }

    if (event.key === "Enter" && popupOpen && activeIndex >= 0) {
      const activeProject = results[activeIndex];
      if (activeProject) {
        event.preventDefault();
        selectProject(activeProject);
      }
    }
  };

  if (!enabled) return null;

  return (
    <div ref={containerRef} className="relative hidden h-11 w-80 lg:block">
      <div className="flex h-full items-center gap-2 rounded-xl border border-zinc-200 px-4 transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200">
        <Search size={18} aria-hidden="true" className="shrink-0 text-zinc-400" />
        <input
          type="search"
          role="combobox"
          aria-label="Search projects"
          aria-autocomplete="list"
          aria-expanded={popupOpen}
          aria-controls={popupOpen ? listboxId : undefined}
          aria-activedescendant={
            popupOpen && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          maxLength={100}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(nextQuery.trim().length > 0);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (normalizedQuery) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Pretraga projekata..."
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
        />
      </div>

      {popupOpen && (
        <div
          id={listboxId}
          role={!loading && !failed && results.length > 0
            ? "listbox"
            : undefined}
          aria-label={!loading && !failed && results.length > 0
            ? "Project search results"
            : undefined}
          className="absolute right-0 top-12 z-50 max-h-80 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
        >
          {loading ? (
            <p role="status" className="px-3 py-2 text-sm text-zinc-500">
              Searching Projects...
            </p>
          ) : failed ? (
            <p role="alert" className="px-3 py-2 text-sm text-red-700">
              Projects could not be searched.
            </p>
          ) : results.length === 0 ? (
            <p role="status" className="px-3 py-2 text-sm text-zinc-500">
              No matching Projects.
            </p>
          ) : (
            <>
              {results.map((project, index) => {
                const status = getProjectStatusPresentation(project.status);
                return (
                  <div
                    key={project.projectId}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectProject(project)}
                    className={`cursor-pointer rounded-lg px-3 py-2 text-left transition ${
                      index > 0 ? "mt-1 " : ""
                    }${
                      index === activeIndex
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold">
                      {project.name}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectQuickSearch;
