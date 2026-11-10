import sharp from "sharp";

export const MAX_PHOTO_BYTES = 100_000;

/** Normalize orientation, strip metadata and enforce the byte budget before storage. */
export async function compressPhoto(input: Buffer): Promise<Buffer> {
  for (let edge = 1600; edge >= 100; edge = Math.floor(edge * 0.7)) {
    for (const quality of [82, 65, 45]) {
      const bytes = await sharp(input, {
        limitInputPixels: 40000000,
        animated: false,
      })
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (bytes.length > 0 && bytes.length < MAX_PHOTO_BYTES) return bytes;
    }
  }
  throw new Error("This photo could not be compressed under 100 KB.");
}
