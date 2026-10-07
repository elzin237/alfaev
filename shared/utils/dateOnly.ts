export interface DateOnlyParts {
  year: number;
  month: number;
  day: number;
}

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: string): DateOnlyParts | null {
  const match = dateOnlyPattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}
