export const PAGE_SIZE = 10;
export function nextPageCursor(rows: { id: string }[]) {
  return rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : undefined;
}
export function pageRows<T>(rows: T[]) {
  return rows.slice(0, PAGE_SIZE);
}
