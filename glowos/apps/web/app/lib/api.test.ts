/**
 * Tests for apiFetch — the central API client used throughout the web app.
 *
 * Critical path: 401 → silent token refresh → retry.
 * This path was the root cause of a breakage on the marketing automation
 * page that bypassed apiFetch and hit the API directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "./api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns parsed JSON for a 200 response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      makeJsonResponse({ data: "hello" })
    );
    const result = await apiFetch("/merchant/test");
    expect(result).toEqual({ data: "hello" });
  });

  it("attaches Authorization header from localStorage", async () => {
    localStorage.setItem("access_token", "my-access-token");
    vi.mocked(global.fetch).mockResolvedValueOnce(makeJsonResponse({ ok: true }));

    await apiFetch("/merchant/test");

    const call = vi.mocked(global.fetch).mock.calls[0];
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers?.["Authorization"]).toBe("Bearer my-access-token");
  });

  it("throws ApiError with status for non-2xx responses", async () => {
    // Use a non-401 error so we don't trigger the refresh logic
    vi.mocked(global.fetch).mockResolvedValueOnce(
      makeJsonResponse({ message: "Not found" }, 404)
    );
    // Single call → assert both shape AND status on the same caught error.
    // Two awaited expects would consume two mocked responses; the second falls
    // through to real fetch and ECONNREFUSEDs in CI.
    const err = await apiFetch("/merchant/missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404 });
  });

  it("retries once after 401 with refreshed token", async () => {
    localStorage.setItem("access_token", "old-token");
    localStorage.setItem("refresh_token", "valid-refresh-token");

    const mockFetch = vi.mocked(global.fetch);

    // Call 1: original request → 401
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ error: "Unauthorized" }, 401));
    // Call 2: refresh token endpoint → success
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ access_token: "new-token", refresh_token: "new-refresh" })
    );
    // Call 3: retry with new token → success
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: "refreshed" }));

    const result = await apiFetch("/merchant/protected");

    expect(result).toEqual({ data: "refreshed" });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // The third call should have the new token
    const retryCall = mockFetch.mock.calls[2];
    const retryHeaders = retryCall?.[1]?.headers as Record<string, string>;
    expect(retryHeaders?.["Authorization"]).toBe("Bearer new-token");

    // localStorage is updated
    expect(localStorage.getItem("access_token")).toBe("new-token");
    expect(localStorage.getItem("refresh_token")).toBe("new-refresh");
  });

  it("redirects to /login when refresh token call fails", async () => {
    localStorage.setItem("access_token", "old-token");
    localStorage.setItem("refresh_token", "expired-refresh-token");

    const mockFetch = vi.mocked(global.fetch);

    // Original request → 401
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ error: "Unauthorized" }, 401));
    // Refresh attempt → 401 (refresh token expired)
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ error: "Refresh expired" }, 401));

    // Intercept the location redirect attempt without reassigning window.location
    // (jsdom supports Object.defineProperty as the safe way to mock location).
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, set href(_v: string) { hrefSetter(_v); } },
    });

    let thrownError: unknown;
    try {
      await apiFetch("/merchant/protected");
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeInstanceOf(ApiError);
    expect((thrownError as ApiError).status).toBe(401);
  });

  it("does NOT attempt refresh for public endpoints (e.g., /auth/login)", async () => {
    localStorage.setItem("access_token", "some-token");
    const mockFetch = vi.mocked(global.fetch);

    // /auth/login returns 401 (wrong password) — should NOT trigger refresh
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Invalid credentials" }, 401));

    await expect(apiFetch("/auth/login", { method: "POST" })).rejects.toThrow(ApiError);

    // Only 1 fetch call — no refresh attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT attempt refresh for /booking/* public endpoints", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Not found" }, 401));

    await expect(apiFetch("/booking/some-slug/slots")).rejects.toThrow(ApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
