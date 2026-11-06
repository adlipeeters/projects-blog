export interface AppConfig {
  authority: string;
  clientId: string;
  loginUrl: string;
}

/** Written at deploy time, so one build runs against any stack. */
export async function loadConfig(): Promise<AppConfig> {
  const response = await fetch('/config.json');
  if (!response.ok) throw new Error('config.json is missing');
  return (await response.json()) as AppConfig;
}
