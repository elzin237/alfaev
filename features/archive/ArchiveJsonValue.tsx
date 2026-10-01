import type { ArchiveJsonValue as ArchiveJsonData } from "./archiveService";

export function humanizeArchiveFieldName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase() === "id"
      ? "ID"
      : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "Value";
}

function ScalarValue({ value }: { value: null | boolean | number | string }) {
  if (value === null) return <span className="text-zinc-500">Null</span>;
  if (typeof value === "boolean") return <span>{value ? "True" : "False"}</span>;
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

export default function ArchiveJsonValue({
  value,
}: {
  value: ArchiveJsonData;
}) {
  if (value === null || typeof value !== "object") {
    return <ScalarValue value={value} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">Empty list</span>;
    return (
      <ol className="space-y-2 border-l border-zinc-200 pl-4">
        {value.map((item, index) => (
          <li key={index} className="text-sm text-zinc-800">
            <span className="mr-2 font-medium text-zinc-500">{index + 1}.</span>
            <ArchiveJsonValue value={item} />
          </li>
        ))}
      </ol>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-zinc-500">Empty object</span>;
  return (
    <dl className="space-y-3 border-l border-zinc-200 pl-4">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {humanizeArchiveFieldName(key)}
          </dt>
          <dd className="mt-1 text-sm text-zinc-900">
            <ArchiveJsonValue value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
