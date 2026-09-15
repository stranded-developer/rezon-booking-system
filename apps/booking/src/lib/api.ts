/** Calls to the Raceground API. The API prices and books everything; this site only shows it. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Supabase access token; member pricing and the account area (6c-3). */
  token?: string | null;
  /** Server components: how long Next may reuse the answer. */
  revalidateSeconds?: number;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.revalidateSeconds === undefined ? { cache: "no-store" as const } : { next: { revalidate: opts.revalidateSeconds } }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, "network", "We couldn't reach Raceground. Please check your connection and try again.");
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const error = (json.error ?? {}) as { code?: string; message?: string; details?: unknown };
    const details = error.details;
    // A 422 lists the fields that are wrong; show the first one rather than "Some fields are invalid".
    const field = Array.isArray(details) ? (details[0] as { message?: unknown } | undefined) : undefined;
    const message = typeof field?.message === "string" ? field.message : (error.message ?? `Something went wrong (${res.status})`);
    throw new ApiRequestError(res.status, error.code ?? "unknown", message, details);
  }
  return json as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");
