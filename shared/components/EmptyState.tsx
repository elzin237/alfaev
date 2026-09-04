export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-bold text-zinc-900">{title}</h2>

      {description && (
        <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
      )}

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
        >
          {action.label}
        </button>
      )}
    </section>
  );
}

export default EmptyState;
