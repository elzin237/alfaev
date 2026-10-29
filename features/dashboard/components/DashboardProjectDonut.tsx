export default function DashboardProjectDonut({ total, segments }: {
  total: number; segments: readonly { label: string; value: number; color: string }[];
}) {
  let offset = 0;
  return <div className="relative size-32 shrink-0">
    <svg viewBox="0 0 128 128" role="img" aria-label={`Project status distribution based on ${total} ${total === 1 ? "project" : "projects"}`} className="size-full -rotate-90">
      <circle cx="64" cy="64" r="51" fill="none" stroke="#eef2f6" strokeWidth="18" />
      {total > 0 && segments.map(segment => {
        const length = segment.value / total * 100, start = offset; offset += length;
        return segment.value > 0 ? <circle key={segment.label} data-project-segment={segment.label}
          cx="64" cy="64" r="51" pathLength="100" fill="none" stroke={segment.color} strokeWidth="18"
          strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start}>
          <title>{segment.label}: {segment.value}</title>
        </circle> : null;
      })}
    </svg>
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
      <span className="text-2xl font-bold text-zinc-900">{total}</span><span className="text-[10px] leading-3 text-zinc-500">Total<br />Projects</span>
    </div>
  </div>;
}
