import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { credentials, useCloudinary } from "./photos.js";
import {
  readMomentPhoto,
  removeMomentPhoto,
  storeMomentPhoto,
} from "./social-storage.js";

const unavailable = (message: string) =>
  Object.assign(new Error(message), { status: 503 });
const directory = () =>
  path.resolve(process.env.CHAT_MEDIA_DIR || ".chat-media");
const file = (asset: string) => {
  if (!/^[a-f0-9-]{36}\.bin$/.test(asset))
    throw new Error("Invalid private chat asset.");
  return path.join(directory(), asset);
};

/** Stores a chat attachment privately. Photos share the Moment photo storage. */
export async function storeChatAttachment(
  bytes: Buffer,
  owner: string,
  kind: "image" | "file",
) {
  if (kind === "image") return storeMomentPhoto(bytes, owner);
  if (useCloudinary()) {
    const publicId = `along/chat/${owner}/${crypto.randomUUID()}`;
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            ...credentials(),
            public_id: publicId,
            resource_type: "raw",
            type: "authenticated",
            overwrite: false,
            timeout: 30000,
          },
          (error, result) =>
            error || !result
              ? reject(error ?? new Error("Missing upload result"))
              : resolve(),
        );
        stream.on("error", reject);
        stream.end(bytes);
      });
    } catch {
      throw unavailable("The file could not be uploaded. Please retry.");
    }
    return `cloudinary-raw:${publicId}`;
  }
  // Private local development storage. Never mount this directory as static files.
  await mkdir(directory(), { recursive: true });
  const asset = `${crypto.randomUUID()}.bin`;
  await writeFile(file(asset), bytes, { flag: "wx", mode: 0o600 });
  return `local-file:${asset}`;
}
export async function readChatAttachment(asset: string) {
  if (asset.startsWith("local-file:")) return readFile(file(asset.slice(11)));
  if (!asset.startsWith("cloudinary-raw:")) return readMomentPhoto(asset);
  // The signed delivery URL stays on the API; access checks run before this call.
  const url = cloudinary.url(asset.slice(15), {
    ...credentials(),
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "raw",
  });
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) throw new Error();
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw unavailable("The file could not be loaded. Please retry.");
  }
}
export async function removeChatAttachment(asset: string) {
  if (asset.startsWith("local-file:"))
    await unlink(file(asset.slice(11))).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  else if (asset.startsWith("cloudinary-raw:"))
    await cloudinary.uploader
      .destroy(asset.slice(15), {
        ...credentials(),
        resource_type: "raw",
        type: "authenticated",
        invalidate: true,
      })
      .catch(() => undefined);
  else await removeMomentPhoto(asset);
}
