/** Public assets stay relative to the deployed application, including Pages subpaths. */
export function assetUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
