import { mapDbError, type PostgrestLikeError } from "../errors.js";

/** PostgREST returns at most this many rows per request (`max_rows` in supabase/config.toml). */
export const PAGE_ROWS = 1000;

/**
 * Read every row of a query, a page at a time, so a long list is never cut short at 1000 rows.
 * `page` must order by something unique (end with `.order("id")`) or rows can repeat or go missing.
 */
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestLikeError | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw mapDbError(error);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_ROWS) return rows;
  }
}
