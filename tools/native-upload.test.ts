import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { apiRequest } from "../apps/mobile/src/services/apiRequest.ts";
import { installFormDataPatch } from "../apps/mobile/node_modules/expo/src/winter/FormData.ts";
import { convertFormDataAsync } from "../apps/mobile/node_modules/expo/src/winter/fetch/convertFormData.ts";

// Use the installed Expo FormData patch and converter to reproduce the device failure.
class NativeFormData {
  _parts: [string, unknown][] = [];
}
const ExpoFormData = installFormDataPatch(
  NativeFormData as unknown as typeof FormData,
);
const original = {
  FormData: globalThis.FormData,
  XMLHttpRequest: globalThis.XMLHttpRequest,
  fetch: globalThis.fetch,
};
class UploadRequest {
  static requests: UploadRequest[] = [];
  status = 201;
  responseText = '{"data":{"id":"uploaded-moment"}}';
  timeout = 0;
  headers: Record<string, string> = {};
  body: unknown;
  method = "";
  url = "";
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  constructor() {
    UploadRequest.requests.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}
before(() => {
  globalThis.FormData = ExpoFormData as unknown as typeof FormData;
  globalThis.XMLHttpRequest = UploadRequest as unknown as typeof XMLHttpRequest;
});
beforeEach(() => {
  UploadRequest.requests = [];
  globalThis.fetch = async () => {
    throw new Error("Native file uploads must not use fetch.");
  };
});
after(() => Object.assign(globalThis, original));
function photoForm() {
  const form = new ExpoFormData();
  form.append(
    "payload",
    JSON.stringify({ type: "photo", audience: "matches" }),
  );
  form.append("photo", {
    uri: "file:///cache/moment.jpg",
    name: "moment.jpg",
    type: "image/jpeg",
  });
  return form as unknown as FormData;
}
const upload = (body = photoForm(), signal?: AbortSignal) =>
  apiRequest(
    "https://example.test/social/moments",
    {
      method: "POST",
      body,
      signal,
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "multipart/form-data",
      },
    },
    true,
  );

test("installed Expo fetch reproduces Unsupported FormDataPart for the status photo", async () => {
  await assert.rejects(
    convertFormDataAsync(photoForm()),
    /Unsupported FormDataPart implementation/,
  );
});
test("native photo uploads bypass Expo fetch and preserve file URI, payload, and auth with a native boundary", async () => {
  const form = photoForm(),
    pending = upload(form),
    xhr = UploadRequest.requests[0];
  assert.equal(xhr.body, form);
  assert.equal(xhr.method, "POST");
  assert.equal(xhr.url, "https://example.test/social/moments");
  assert.equal(xhr.headers.authorization, "Bearer fixture");
  assert.equal(xhr.headers["content-type"], undefined);
  assert.equal(xhr.timeout, 45000);
  xhr.onload!();
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal((await response.json()).data.id, "uploaded-moment");
});
test("a rejected session response preserves its status and the upload body can be retried", async () => {
  const form = photoForm(),
    pending = upload(form),
    xhr = UploadRequest.requests[0];
  xhr.status = 401;
  xhr.responseText = '{"error":{"message":"Session expired"}}';
  xhr.onload!();
  const response = await pending;
  assert.equal(response.status, 401);
  assert.equal(response.ok, false);
  assert.equal((await response.json()).error.message, "Session expired");
  const retry = upload(form);
  assert.equal(UploadRequest.requests[1].body, form);
  UploadRequest.requests[1].onload!();
  assert.equal((await retry).ok, true);
});
test("native upload network errors and timeouts reject without hanging", async () => {
  const network = upload();
  UploadRequest.requests[0].onerror!();
  await assert.rejects(network, /Check your connection/);
  const timeout = upload();
  UploadRequest.requests[1].ontimeout!();
  await assert.rejects(timeout, { name: "AbortError" });
});
test("aborted uploads stop the native request and completed uploads release their abort listener", async () => {
  const controller = new AbortController(),
    pending = upload(photoForm(), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const completedController = new AbortController(),
    completed = upload(photoForm(), completedController.signal);
  const xhr = UploadRequest.requests[1];
  xhr.onload!();
  await completed;
  xhr.abort = () => {
    throw new Error("Completed request must not be aborted");
  };
  completedController.abort();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(upload(photoForm(), alreadyAborted.signal), {
    name: "AbortError",
  });
  assert.equal(UploadRequest.requests[2].body, undefined);
});
test("web photo uploads and native text statuses retain the regular fetch transport", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"data":{"id":"posted"}}', { status: 201 });
  };
  assert.equal(
    (
      await apiRequest(
        "https://example.test",
        { method: "POST", body: photoForm() },
        false,
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await apiRequest(
        "https://example.test",
        {
          method: "POST",
          body: JSON.stringify({ type: "text", text: "Hello" }),
        },
        true,
      )
    ).ok,
    true,
  );
  assert.equal(calls, 2);
  assert.equal(UploadRequest.requests.length, 0);
});
