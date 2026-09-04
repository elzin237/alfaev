export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

function ErrorState({
  title = "Unable to load",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <section
      role="alert"
      className="rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm"
    >
      <div
        aria-hidden="true"
        className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 font-bold text-red-600"
      >
        !
      </div>
      <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{message}</p>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
        >
          Try again
        </button>
      )}
    </section>
  );
}

export default ErrorState;
