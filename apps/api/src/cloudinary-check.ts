import sharp from "sharp";
import crypto from "node:crypto";
import {
  storePhoto,
  readCloudinaryPhoto,
  deleteCloudinaryPhoto,
  useCloudinary,
} from "./photos.js";
let publicId: string | undefined;
try {
  if (!useCloudinary())
    throw new Error("Cloudinary storage is not configured.");
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#174F54" },
  })
    .jpeg()
    .toBuffer();
  const stored = await storePhoto(bytes, `upload-check-${crypto.randomUUID()}`);
  publicId = stored.cloudinaryPublicId;
  if (!publicId) throw new Error("Cloudinary storage is not active.");
  const downloaded = await readCloudinaryPhoto(publicId);
  if ((await sharp(downloaded).metadata()).format !== "jpeg")
    throw new Error("Photo readback failed.");
  console.log(
    "Cloudinary authenticated upload and protected readback succeeded.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Cloudinary check failed.",
  );
  process.exitCode = 1;
} finally {
  if (publicId) {
    try {
      await deleteCloudinaryPhoto(publicId);
      console.log("Temporary Cloudinary test photo removed.");
    } catch {
      console.error(
        "Temporary photo cleanup failed; rerun the check after restoring the Cloudinary connection.",
      );
      process.exitCode = 1;
    }
  }
}
