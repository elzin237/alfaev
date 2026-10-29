const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sarajevo", day: "numeric", month: "short", year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sarajevo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function formatHistoryTimestamp(timestamp: string): string {
  const instant = new Date(timestamp);
  return `${dateFormatter.format(instant)} · ${timeFormatter.format(instant)}`;
}

export function formatHistoryDeadline(date: string): string {
  // This is a Sarajevo calendar date, not an expiry instant. A UTC-noon
  // formatting anchor preserves its day through Sarajevo's DST transitions.
  return dateFormatter.format(new Date(`${date}T12:00:00Z`));
}
