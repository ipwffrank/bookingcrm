import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Public redirect for short links minted by services/api/src/lib/short-links.ts.
 * Resolves via the API so DB access stays server-side and Next stays unaware
 * of Drizzle / DATABASE_URL. The API exposes a tiny GET /s/:code endpoint
 * that returns { url } or 404.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const res = await fetch(`${API_URL}/s/${code}`, { cache: "no-store" });
  if (!res.ok) {
    return new NextResponse("Link not found", { status: 404 });
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    return new NextResponse("Link not found", { status: 404 });
  }
  return NextResponse.redirect(data.url, 302);
}
