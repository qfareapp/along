import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./document-validation.js";

// A stored ZIP with correct local headers, central directory, sizes and CRCs.
function officeZip(entries: Record<string, string>) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [filename, content] of Object.entries(entries)) {
    const name = Buffer.from(filename),
      bytes = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, bytes);
    central.push(directory, name);
    offset += header.length + name.length + bytes.length;
  }
  const index = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(local.length / 3, 8);
  end.writeUInt16LE(local.length / 3, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

test("macro-free Office ZIP containers pass, while macros and traversal entries fail", () => {
  const mime =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const entries = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml":
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  };
  assert.doesNotThrow(() => validateDocument(officeZip(entries), mime));
  assert.throws(() =>
    validateDocument(
      officeZip({ ...entries, "word/vbaProject.bin": "macro" }),
      mime,
    ),
  );
  assert.throws(() =>
    validateDocument(
      officeZip({ ...entries, "../outside.xml": "<xml/>" }),
      mime,
    ),
  );
  assert.throws(() =>
    validateDocument(
      officeZip({ ...entries, "[Content_Types].xml": "<macroEnabled/>" }),
      mime,
    ),
  );
});
