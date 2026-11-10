import { Image } from "react-native";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export const MAX_PHOTO_BYTES = 100_000;

/** Check actual encoded bytes: JPEG quality alone cannot guarantee a file size. */
export async function compressPhoto(uri: string) {
  const size = await new Promise<{ width: number; height: number }>(
    (resolve, reject) =>
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
  for (let edge = 1600; edge >= 100; edge = Math.floor(edge * 0.7)) {
    const scale = Math.min(1, edge / Math.max(size.width, size.height));
    const context = ImageManipulator.manipulate(uri);
    let rendered;
    try {
      context.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
      });
      rendered = await context.renderAsync();
      for (const compress of [0.82, 0.65, 0.45]) {
        const image = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress,
          base64: true,
        });
        if (!image.base64) throw new Error("Unable to encode photo.");
        const padding = image.base64.endsWith("==")
          ? 2
          : image.base64.endsWith("=")
            ? 1
            : 0;
        const bytes = Math.floor((image.base64.length * 3) / 4) - padding;
        if (bytes > 0 && bytes < MAX_PHOTO_BYTES)
          return {
            uri: image.uri,
            size: bytes,
            mimeType: "image/jpeg" as const,
          };
      }
    } finally {
      rendered?.release();
      context.release();
    }
  }
  throw new Error(
    "This photo could not be compressed under 100 KB. Choose another photo.",
  );
}
