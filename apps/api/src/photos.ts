import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { config } from "./config.js";

const fail = (message: string) =>
  Object.assign(new Error(message), { status: 503 });
export function credentials() {
  if (
    !config.CLOUDINARY_CLOUD_NAME ||
    !config.CLOUDINARY_API_KEY ||
    !config.CLOUDINARY_API_SECRET
  )
    throw fail(
      "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in apps/api/.env.",
    );
  return {
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
  };
}
export function useCloudinary() {
  if (config.PHOTO_STORAGE === "mongodb") return false;
  const configured = !!(
    config.CLOUDINARY_CLOUD_NAME ||
    config.CLOUDINARY_API_KEY ||
    config.CLOUDINARY_API_SECRET
  );
  if (config.PHOTO_STORAGE === "cloudinary" || configured) {
    credentials();
    return true;
  }
  return false;
}
export async function storePhoto(bytes: Buffer, owner: string) {
  if (!useCloudinary()) return { bytes };
  const publicId = `along/profiles/${owner}/${crypto.randomUUID()}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          ...credentials(),
          public_id: publicId,
          resource_type: "image",
          type: "authenticated",
          format: "jpg",
          overwrite: false,
          timeout: 20000,
        },
        (error, result) =>
          error || !result
            ? reject(error ?? new Error("Missing upload result"))
            : resolve(),
      );
      stream.on("error", reject);
      stream.end(bytes);
    });
    return { cloudinaryPublicId: publicId };
  } catch {
    throw fail(
      "Cloudinary upload failed. Check the backend Cloudinary credentials and connection, then retry.",
    );
  }
}
export async function deleteCloudinaryPhoto(publicId: string) {
  try {
    await cloudinary.uploader.destroy(publicId, {
      ...credentials(),
      resource_type: "image",
      type: "authenticated",
      invalidate: true,
    });
  } catch {
    throw fail("Cloudinary could not remove the photo. Please retry.");
  }
}
export async function readCloudinaryPhoto(publicId: string) {
  // The signed delivery URL stays on the API. Eligibility and block checks run before calling this function.
  const url = cloudinary.url(publicId, {
    ...credentials(),
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "image",
    format: "jpg",
  });
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error();
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw fail("Your photo could not be loaded from Cloudinary. Please retry.");
  }
}
