import { useEffect, useId, useRef, useState } from "react";

import { useProjectActivityImage } from "../hooks/useProjectActivity";

interface ProjectActivityImageProps {
  projectId: string;
  activityId: string;
  title: string;
  altText: string | null;
}

function useVisibleOnce() {
  const elementRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (visible || typeof IntersectionObserver === "undefined") return;
    const element = elementRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return { elementRef, visible };
}

function ProjectActivityImage({
  projectId,
  activityId,
  title,
  altText,
}: ProjectActivityImageProps) {
  const { elementRef, visible } = useVisibleOnce();
  const imageQuery = useProjectActivityImage(projectId, activityId, visible);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const effectiveAlt = imageQuery.data?.altText ?? altText ?? title;

  useEffect(() => {
    if (!viewerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewerOpen(false);
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [viewerOpen]);

  const imageUnavailable = imageQuery.isError ||
    (imageQuery.data && failedUrl === imageQuery.data.signedUrl);

  return (
    <div ref={elementRef} className="mt-3 w-full max-w-[300px]">
      {!visible || imageQuery.isPending ? (
        <div role="status" className="flex aspect-[30/19] max-h-[190px] items-center justify-center rounded-xl bg-zinc-100 text-sm text-zinc-500">
          Loading image...
        </div>
      ) : imageUnavailable ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p role="alert" className="text-sm text-zinc-600">
            The Activity image could not be loaded.
          </p>
          <button
            type="button"
            onClick={() => {
              setFailedUrl(null);
              void imageQuery.refetch();
            }}
            className="mt-3 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Try image again
          </button>
        </div>
      ) : imageQuery.data ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setViewerOpen(true)}
          className="block w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 text-left shadow-sm transition hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          aria-label={`Open image for ${title}`}
        >
          <img
            src={imageQuery.data.signedUrl}
            alt={effectiveAlt}
            onError={() => {
              if (failedUrl !== imageQuery.data?.signedUrl) {
                setFailedUrl(imageQuery.data?.signedUrl ?? null);
                void imageQuery.refetch();
              }
            }}
            className="aspect-[30/19] max-h-[190px] w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </button>
      ) : null}

      {viewerOpen && imageQuery.data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <h2 id={titleId} className="truncate text-lg font-bold text-zinc-900">
                {title}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setViewerOpen(false)}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Close image viewer
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-4">
              <img
                src={imageQuery.data.signedUrl}
                alt={effectiveAlt}
                className="mx-auto max-h-[80vh] max-w-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default ProjectActivityImage;
