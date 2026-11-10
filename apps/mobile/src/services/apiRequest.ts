type ApiResponse = Pick<Response, "status" | "ok" | "json">;

/** Expo 58 fetch rejects RN's { uri, name, type } FormData files. XHR reads them natively. */
export function apiRequest(
  url: string,
  options: RequestInit,
  native: boolean,
): Promise<ApiResponse> {
  if (!native || !(options.body instanceof FormData))
    return fetch(url, options);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const signal = options.signal;
    const abortError = () =>
      Object.assign(new Error("Upload aborted."), { name: "AbortError" });
    const abort = () => {
      xhr.abort();
      finish();
      reject(abortError());
    };
    const finish = () => signal?.removeEventListener("abort", abort);
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    xhr.open(options.method ?? "GET", url);
    xhr.timeout = 45000;
    const headers = new Headers(options.headers);
    headers.forEach((value, key) => {
      // Native networking generates the boundary for the actual file parts.
      if (key.toLowerCase() !== "content-type")
        xhr.setRequestHeader(key, value);
    });
    xhr.onload = () => {
      finish();
      const status = xhr.status,
        responseText = xhr.responseText;
      resolve({
        status,
        ok: status >= 200 && status < 300,
        json: async () => JSON.parse(responseText),
      });
    };
    xhr.onerror = () => {
      finish();
      reject(new Error("Upload failed. Check your connection and try again."));
    };
    xhr.ontimeout = xhr.onabort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener("abort", abort);
    try {
      xhr.send(options.body as FormData);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
