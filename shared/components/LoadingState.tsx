export interface LoadingStateProps {
  message?: string;
}

function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-40 items-center justify-center gap-3 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <span
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-red-600"
      />
      <span className="text-sm font-medium text-zinc-600">{message}</span>
    </div>
  );
}

export default LoadingState;
