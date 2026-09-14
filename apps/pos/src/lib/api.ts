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

export interface ApiClientOptions {
  baseUrl: string;
  getJwt: () => Promise<string | null>;
  getOperatorToken: () => string | null;
  onOperatorToken: (token: string) => void;
  /** The operator session is gone (idle, expired, deactivated): show the lock screen. */
  onOperatorExpired: () => void;
  /** The device session is gone: show the sign-in screen. */
  onDeviceExpired: () => void;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Background refreshes must not keep an idle operator signed in. */
  passive?: boolean;
}

export function createApiClient(opts: ApiClientOptions) {
  return async function request<T>(path: string, { method, body, passive }: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    const jwt = await opts.getJwt();
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    const operatorToken = opts.getOperatorToken();
    if (operatorToken) headers["X-Operator-Token"] = operatorToken;
    if (passive) headers["X-Operator-Passive"] = "1";
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}${path}`, {
        method: method ?? (body !== undefined ? "POST" : "GET"),
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiRequestError(0, "network", "Can't reach the server. Check the internet connection.");
    }

    const renewed = res.headers.get("X-Operator-Token");
    if (renewed) opts.onOperatorToken(renewed);

    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const error = (json.error ?? {}) as { code?: string; message?: string; details?: unknown };
      const err = new ApiRequestError(res.status, error.code ?? "unknown", error.message ?? `Request failed (${res.status})`, error.details);
      if (res.status === 401 && err.code === "unauthenticated") opts.onDeviceExpired();
      if (res.status === 401 && err.code === "operator_required") opts.onOperatorExpired();
      if (res.status === 403 && path !== "/pos/staff" && err.message.includes("not active")) opts.onOperatorExpired();
      throw err;
    }
    return json as T;
  };
}

export type ApiRequest = ReturnType<typeof createApiClient>;
