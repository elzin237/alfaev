export type FrontendEnvName = `VITE_${string}`;

export function requireEnv(
  name: FrontendEnvName,
  value: string | undefined,
): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return normalizedValue;
}
