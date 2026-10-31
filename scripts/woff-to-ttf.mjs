/**
 * WOFF 1.0 → TTF (לגופנים העבריים החופשיים ב-assets/fonts/hebrew — MuPDF לא קורא WOFF).
 * הקבצים מגיעים מחבילות @fontsource (OFL); הרצה חד-פעמית כשמוסיפים גופן:
 *   node scripts/woff-to-ttf.mjs <in.woff> <out.ttf>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export function woffToTtf(buf) {
  if (buf.readUInt32BE(0) !== 0x774f4646) throw new Error('לא WOFF')
  const flavor = buf.readUInt32BE(4), n = buf.readUInt16BE(12)
  const tables = []
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20, tag = buf.readUInt32BE(o), off = buf.readUInt32BE(o + 4), comp = buf.readUInt32BE(o + 8), orig = buf.readUInt32BE(o + 12), sum = buf.readUInt32BE(o + 16)
    const raw = buf.subarray(off, off + comp)
    const data = comp < orig ? inflateSync(raw) : Buffer.from(raw)
    if (data.length !== orig) throw new Error('גודל טבלה לא תואם')
    tables.push({ tag, sum, data })
  }
  tables.sort((a, b) => a.tag - b.tag)
  let p2 = 1, lg = 0; while (p2 * 2 <= n) { p2 *= 2; lg++ }
  const head = Buffer.alloc(12 + n * 16)
  head.writeUInt32BE(flavor, 0); head.writeUInt16BE(n, 4); head.writeUInt16BE(p2 * 16, 6); head.writeUInt16BE(lg, 8); head.writeUInt16BE(n * 16 - p2 * 16, 10)
  let off = head.length; const parts = [head]
  tables.forEach((t, i) => {
    const r = 12 + i * 16
    head.writeUInt32BE(t.tag, r); head.writeUInt32BE(t.sum, r + 4); head.writeUInt32BE(off, r + 8); head.writeUInt32BE(t.data.length, r + 12)
    const pad = (4 - (t.data.length % 4)) % 4
    parts.push(t.data, Buffer.alloc(pad)); off += t.data.length + pad
  })
  return Buffer.concat(parts)
}

if (process.argv[2] && process.argv[3]) writeFileSync(process.argv[3], woffToTtf(readFileSync(process.argv[2])))
