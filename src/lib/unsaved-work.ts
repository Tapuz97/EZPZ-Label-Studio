export const CLOSE_WARNING_PREFERENCE = "ezpz-label-studio:skip-close-warning";

export function shouldConfirmDiscard(dirty: ReadonlyMap<string, boolean>, skipWarning: boolean, scope?: string): boolean {
  if (skipWarning) return false;
  return scope === undefined ? [...dirty.values()].some(Boolean) : dirty.get(scope) === true;
}
