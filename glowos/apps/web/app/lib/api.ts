/**
 * Resolve the API base URL.
 *
 * On the server (Node.js runtime) we prefer the non-public `API_URL` env var
 * because `NEXT_PUBLIC_*` vars are only guaranteed to be available if they were
 * set at *build time* or explicitly configured in Vercel project settings.
 * `API_URL` is a standard server-side env var that is always read at runtime.
 *
 * On the client we fall back to `NEXT_PUBLIC_API_URL` which Next.js inlines
 * into the JS bundle at build time.
 *
 * Both fall back to localhost for local development.
 */
function getApiUrl(): string {
  // Server-side: prefer the server-only env var, then the public one
  if (typeof window === 'undefined') {
    return (
      process.env.API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:3001'
    );
  }
  // Client-side: NEXT_PUBLIC_* is inlined at build time
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

// ─── Custom error class that carries HTTP status ──────────────────────────────

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// ─── Token refresh lock ───────────────────────────────────────────────────────
// When multiple requests fail with 401 simultaneously, only one should attempt
// the refresh. Others wait for the same promise to resolve.

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken =
    typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null;
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${getApiUrl()}/auth/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

function refreshTokenWithLock(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = tryRefreshToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  localStorage.removeItem('merchant');
  window.location.href = '/login';
}

// ─── Main fetch helper ────────────────────────────────────────────────────────

export async function apiFetch(path: string, options?: RequestInit) {
  const { headers: extraHeaders, ...rest } = options ?? {};

  // Auto-attach Authorization header from localStorage if not already provided
  const buildHeaders = (): Record<string, string> => {
    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Merge caller-supplied headers
    if (extraHeaders) {
      const incoming =
        extraHeaders instanceof Headers
          ? Object.fromEntries(extraHeaders.entries())
          : Array.isArray(extraHeaders)
            ? Object.fromEntries(extraHeaders)
            : (extraHeaders as Record<string, string>);
      Object.assign(hdrs, incoming);
    }

    // Auto-attach token on the client if caller didn't supply one
    if (!hdrs['Authorization'] && typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) {
        hdrs['Authorization'] = `Bearer ${token}`;
      }
    }

    return hdrs;
  };

  const doFetch = (hdrs: Record<string, string>) =>
    fetch(`${getApiUrl()}${path}`, { ...rest, headers: hdrs });

  let headers = buildHeaders();
  let res = await doFetch(headers);

  // ── Handle 401: attempt token refresh and retry once ──────────────────────
  if (res.status === 401 && typeof window !== 'undefined') {
    // Public endpoints never require merchant auth — a 401 here means the
    // request itself was rejected (e.g., wrong OTP code), not that the
    // merchant session expired. Skip the refresh/redirect dance for these.
    const isPublicEndpoint =
      path === '/auth/login' ||
      path === '/auth/signup' ||
      path === '/auth/refresh-token' ||
      path.startsWith('/booking/') ||
      path.startsWith('/customer-auth/') ||
      path.startsWith('/review/');

    if (!isPublicEndpoint) {
      const refreshed = await refreshTokenWithLock();

      if (refreshed) {
        // Update the Authorization header with the new token and retry
        const newToken = localStorage.getItem('access_token');
        if (newToken) {
          headers = { ...headers, Authorization: `Bearer ${newToken}` };
        }
        res = await doFetch(headers);
      } else {
        // Refresh failed — session is truly expired
        redirectToLogin();
        throw new ApiError(401, 'Session expired. Please log in again.');
      }
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { message?: string }).message || 'API error';
    throw new ApiError(res.status, message, body);
  }

  return res.json();
}
