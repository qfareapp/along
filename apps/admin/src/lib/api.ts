let csrf = "";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/admin${path}`, {
      ...options,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json();
    if (!response.ok)
      throw new ApiError(
        body.error?.issues?.[0]?.message ??
          body.error?.message ??
          "Request failed.",
        response.status,
      );
    if (body.data?.csrf) csrf = body.data.csrf;
    return body.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new ApiError("The API took too long to respond. Try again.", 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export const json = (value: unknown) => JSON.stringify(value);
