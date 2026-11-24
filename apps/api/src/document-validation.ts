import { inflateRawSync } from "node:zlib";

const invalid = () =>
  Object.assign(
    new Error(
      "This file is unsupported or contains features Along cannot accept. Choose a PDF, plain text, CSV or a macro-free .docx, .xlsx or .pptx document.",
    ),
    { status: 400 },
  );
const officeParts: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "word/document.xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "xl/workbook.xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "ppt/presentation.xml",
};

/** Inspect bytes and Office ZIP structure; no archive extraction or active document execution. */
export function validateDocument(bytes: Buffer, mime: string) {
  if (!bytes.length) throw invalid();
  if (mime === "text/plain" || mime === "text/csv") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw invalid();
    }
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
      /^\s*(?:<!doctype\s+html|<html\b|<script\b|#!)/i.test(text)
    )
      throw invalid();
    return;
  }
  if (mime === "application/pdf") {
    if (
      !/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(
        bytes.subarray(0, 12).toString("ascii"),
      ) ||
      !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))
    )
      throw invalid();
    // Restrict active and embedded content; this is not an antivirus guarantee.
    if (
      /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(
        bytes.toString("latin1"),
      )
    )
      throw invalid();
    return;
  }
  const primary = officeParts[mime];
  if (!primary || bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw invalid();
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (
    !count ||
    count > 1000 ||
    start + size !== end ||
    bytes.readUInt16LE(end + 8) !== count
  )
    throw invalid();
  const names = new Set<string>();
  let offset = start,
    expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw invalid();
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      compressed = bytes.readUInt32LE(offset + 20),
      length = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      local = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extra + comment;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      next > end ||
      local + 30 > start ||
      bytes.readUInt32LE(local) !== 0x04034b50
    )
      throw invalid();
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (
      !name ||
      name.includes("\0") ||
      names.has(name) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      /(?:vbaProject|embeddings\/|\.exe$|\.dll$|\.js$|\.ps1$)/i.test(name)
    )
      throw invalid();
    names.add(name);
    expanded += length;
    if (
      expanded > 50 * 1024 * 1024 ||
      length > Math.max(compressed * 200, 1024 * 1024)
    )
      throw invalid();
    const localNameLength = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28),
      dataStart = local + 30 + localNameLength + localExtra;
    if (
      dataStart + compressed > start ||
      bytes
        .subarray(local + 30, local + 30 + localNameLength)
        .toString("utf8") !== name ||
      bytes.readUInt16LE(local + 8) !== method
    )
      throw invalid();
    if (name === "[Content_Types].xml" || name === primary) {
      if (length > 5 * 1024 * 1024) throw invalid();
      const packed = bytes.subarray(dataStart, dataStart + compressed);
      let xml: Buffer;
      try {
        xml =
          method === 0
            ? packed
            : inflateRawSync(packed, { maxOutputLength: 5 * 1024 * 1024 });
      } catch {
        throw invalid();
      }
      if (
        xml.length !== length ||
        !xml.toString("utf8").trimStart().startsWith("<") ||
        /<!DOCTYPE|<!ENTITY|macroEnabled/i.test(xml.toString("utf8"))
      )
        throw invalid();
    }
    offset = next;
  }
  if (
    offset !== end ||
    !names.has("[Content_Types].xml") ||
    !names.has(primary)
  )
    throw invalid();
}
