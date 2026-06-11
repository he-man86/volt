// ZIP builder for CODESYS .package files — uses STORE (no compression).
// CODESYS validates CRC against decompressed content; different zlib versions
// produce different compressed bytes for the same input, causing CRC mismatch.
// STORE mode guarantees byte-identical content.
const fs = require("fs")
const path = require("path")

function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0) } return (c ^ 0xffffffff) >>> 0 }
function w16(arr, v, o) { arr.writeUInt16LE(v, o); return o + 2 }
function w32(arr, v, o) { arr.writeUInt32LE(v, o); return o + 4 }

function buildEntry(fullPath, relativePath) {
  const data = fs.readFileSync(fullPath)
  const name = Buffer.from(relativePath, "utf8")
  const crc = crc32(data)
  const size = data.length

  const local = Buffer.alloc(30 + name.length + size)
  let o = 0
  o = w32(local, 0x04034b50, o); o = w16(local, 20, o); o = w16(local, 0, o); o = w16(local, 0, o)  // comp=STORE
  o = w16(local, 0, o); o = w16(local, 0, o); o = w32(local, crc, o); o = w32(local, size, o); o = w32(local, size, o)
  o = w16(local, name.length, o); o = w16(local, 0, o)
  name.copy(local, o); data.copy(local, o + name.length)
  return { local, crc, size, name }
}

function main() {
  const srcDir = process.argv[2]
  const outFile = process.argv[3]
  if (!srcDir || !outFile) { console.error("Usage: node zip-builder.cjs <src-dir> <output.package>"); process.exit(1) }

  const entries = []
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = prefix ? prefix + "/" + entry.name : entry.name
      if (entry.isDirectory()) { walk(full, rel); continue }
      entries.push(buildEntry(full, rel.replace(/\\/g, "/")))
    }
  }
  walk(srcDir, "")

  if (entries.length === 0) { console.error("No files found"); process.exit(1) }

  // package.manifest FIRST, then alphabetical
  entries.sort((a, b) => {
    const na = a.name.toString("utf8"), nb = b.name.toString("utf8")
    if (na === "package.manifest") return -1
    if (nb === "package.manifest") return 1
    return na.localeCompare(nb)
  })

  const pieces = []
  const cdEntries = []
  let offset = 0

  for (const e of entries) {
    pieces.push(e.local)
    const cd = Buffer.alloc(46 + e.name.length)
    let o = 0
    o = w32(cd, 0x02014b50, o); o = w16(cd, 20, o); o = w16(cd, 20, o); o = w16(cd, 0, o); o = w16(cd, 0, o)
    o = w16(cd, 0, o); o = w16(cd, 0, o); o = w32(cd, e.crc, o); o = w32(cd, e.size, o); o = w32(cd, e.size, o)
    o = w16(cd, e.name.length, o); o = w16(cd, 0, o); o = w16(cd, 0, o)
    o = w16(cd, 0, o); o = w16(cd, 0, o); o = w32(cd, 0, o); o = w32(cd, offset, o)
    e.name.copy(cd, o)
    cdEntries.push(cd)
    offset += e.local.length
  }

  pieces.push(Buffer.concat(cdEntries))

  const eocd = Buffer.alloc(22)
  let o = 0
  o = w32(eocd, 0x06054b50, o); o = w16(eocd, 0, o); o = w16(eocd, 0, o)
  o = w16(eocd, entries.length, o); o = w16(eocd, entries.length, o)
  o = w32(eocd, Buffer.concat(cdEntries).length, o); o = w32(eocd, offset, o); o = w16(eocd, 0, o)
  pieces.push(eocd)

  const result = Buffer.concat(pieces)
  fs.writeFileSync(outFile, result)
  console.log(`Package: ${outFile} (${result.length} bytes, ${entries.length} files)`)
  for (const e of entries) console.log(`  ${e.name.toString("utf8")} (${e.size} bytes STORE)`)
}

main()
