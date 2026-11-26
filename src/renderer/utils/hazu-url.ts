/** The browser link to a Hazu item in the configured environment. */
export function hazuItemUrl(env: string | undefined, id: string): string {
  const base = env === 'io' ? 'https://hazu.io' : env === 'dev' ? 'https://dev.hazu.swiss' : 'https://hazu.swiss';
  return `${base}/${id}`;
}
