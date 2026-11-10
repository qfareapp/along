import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { compressPhoto, MAX_PHOTO_BYTES } from "./compress-photo.js";

test("large detailed photos become decodable JPEGs strictly below 100 KB", async () => {
  const source = await sharp(randomBytes(1800 * 1400 * 3), {
    raw: { width: 1800, height: 1400, channels: 3 },
  })
    .png()
    .toBuffer();
  assert.ok(source.length > MAX_PHOTO_BYTES);
  const result = await compressPhoto(source);
  assert.ok(result.length > 0 && result.length < 100_000);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.ok(metadata.width! <= 1600 && metadata.height! <= 1600);
  assert.ok(Math.abs(metadata.width! / metadata.height! - 1800 / 1400) < 0.01);
  assert.equal(metadata.exif, undefined);
});

test("small transparent images remain small and invalid bytes are rejected", async () => {
  const source = await sharp({
    create: { width: 40, height: 60, channels: 4, background: "#F4776880" },
  })
    .png()
    .toBuffer();
  const result = await compressPhoto(source);
  assert.ok(result.length < MAX_PHOTO_BYTES);
  assert.equal((await sharp(result).metadata()).width, 40);
  await assert.rejects(compressPhoto(Buffer.from("not an image")));
});
