import { type NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
// Transport proxy only. Express owns all authentication, authorization and business logic.
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (path.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment)))
    return NextResponse.json(
      { error: { message: "Invalid API path." } },
      { status: 400 },
    );
  const base = process.env.ALONG_API_URL ?? "http://127.0.0.1:4000";
  const headers = new Headers();
  for (const name of ["cookie", "content-type", "origin", "x-csrf-token"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(
      `${base}/api/v1/admin/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text(),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (
      upstream.status !== 204 &&
      !upstream.headers.get("content-type")?.includes("application/json")
    )
      return NextResponse.json(
        {
          error: {
            code: "API_INVALID_RESPONSE",
            message:
              "The backend returned an unexpected response. Check that ALONG_API_URL points to the Express API service, not the admin dashboard.",
          },
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "set-cookie", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new NextResponse(upstream.status === 204 ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "API_UNAVAILABLE",
          message:
            "The shared Along API is unavailable. Check the backend connection.",
        },
      },
      { status: 503 },
    );
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as PUT,
  proxy as DELETE,
};
