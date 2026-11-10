import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import {
  useCloudinary,
  storePhoto,
  readCloudinaryPhoto,
  deleteCloudinaryPhoto,
} from "./photos.js";
const directory = () =>
  path.resolve(process.env.SOCIAL_MEDIA_DIR || ".social-media");
const file = (asset: string) => {
  if (!/^[a-f0-9-]{36}\.jpg$/.test(asset))
    throw new Error("Invalid private media asset.");
  return path.join(directory(), asset);
};
export async function storeMomentPhoto(bytes: Buffer, owner: string) {
  if (useCloudinary()) {
    const stored = await storePhoto(bytes, owner);
    if (!stored.cloudinaryPublicId) throw new Error("Private upload failed.");
    return `cloudinary:${stored.cloudinaryPublicId}`;
  }
  // Private local development storage. Never mount this directory as static files.
  await mkdir(directory(), { recursive: true });
  const asset = `${crypto.randomUUID()}.jpg`;
  await writeFile(file(asset), bytes, { flag: "wx", mode: 0o600 });
  return `local:${asset}`;
}
export async function readMomentPhoto(asset: string) {
  return asset.startsWith("cloudinary:")
    ? readCloudinaryPhoto(asset.slice(11))
    : readFile(file(asset.slice(6)));
}
export async function removeMomentPhoto(asset: string) {
  if (asset.startsWith("cloudinary:"))
    await deleteCloudinaryPhoto(asset.slice(11));
  else
    await unlink(file(asset.slice(6))).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
}
