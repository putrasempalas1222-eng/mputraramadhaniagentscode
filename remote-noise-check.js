const assert = require("assert")

const NOISE_PATTERNS = [
  /official\s+elf\s+gateway/i,
  /dilarang\s+memperjual\s*beli/i,
  /laporkan\s+pelanggaran/i,
  /reseller\s+liar/i,
  /elf_router_bot/i,
  /@elman\d+/i,
]
function cleanContent(text) {
  const lines = String(text).split("\n").filter((line) => !NOISE_PATTERNS.some((re) => re.test(line)))
  const cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return cleaned || null
}

const spam =
  "⚠️ Official ELF Gateway | Dilarang memperjual belikan akses tanpa izin! Official Bot: @Elf_router_bot | Laporkan pelanggaran/reseller liar ke @elman14"
assert.strictEqual(cleanContent(spam), null, "spam banner harus jadi null")

const mixed = "Halo, ini jawaban AI.\n" + spam + "\nSemoga membantu."
assert.strictEqual(cleanContent(mixed), "Halo, ini jawaban AI.\nSemoga membantu.", "baris spam dibuang, jawaban tetap")

assert.strictEqual(cleanContent("Jawaban normal."), "Jawaban normal.", "teks normal tidak berubah")

// ── Test deteksi perintah buka website ──────────────────────────────────────
function isLocalHostname(host) {
  if (!host) return false
  const h = String(host).toLowerCase()
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".localhost") ||
    /^192\.168\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)
  )
}

function parseOpenIntent(text) {
  const trimmed = String(text || "").trim()
  const urlMatch = trimmed.match(
    /^(?:buka|open)(?:\s+(?:website|web|link|situs|page|url|halaman|browser))?\s+(https?:\/\/\S+|localhost(?::\d+)?\S*|127\.0\.0\.1(?::\d+)?\S*)$/i
  )
  if (urlMatch) {
    let rawUrl = urlMatch[1].trim()
    if (!/^https?:\/\//i.test(rawUrl)) rawUrl = "http://" + rawUrl
    try {
      new URL(rawUrl)
      return { isCommand: true, explicitUrl: rawUrl }
    } catch {}
  }
  if (/^(?:buka|open)(?:\s+(?:website|web|link|situs|page|url|halaman|browser))?$/i.test(trimmed)) {
    return { isCommand: true, explicitUrl: null }
  }
  return { isCommand: false, explicitUrl: null }
}

assert.strictEqual(isLocalHostname("localhost"), true)
assert.strictEqual(isLocalHostname("127.0.0.1"), true)
assert.strictEqual(isLocalHostname("192.168.1.50"), true)
assert.strictEqual(isLocalHostname("my-site.vercel.app"), false)
assert.strictEqual(isLocalHostname("example.com"), false)

assert.deepStrictEqual(parseOpenIntent("buka website"), { isCommand: true, explicitUrl: null })
assert.deepStrictEqual(parseOpenIntent("buka web"), { isCommand: true, explicitUrl: null })
assert.deepStrictEqual(parseOpenIntent("buka link"), { isCommand: true, explicitUrl: null })
assert.deepStrictEqual(parseOpenIntent("buka"), { isCommand: true, explicitUrl: null })
assert.deepStrictEqual(parseOpenIntent("open website"), { isCommand: true, explicitUrl: null })
assert.deepStrictEqual(parseOpenIntent("buka https://demo.vercel.app"), { isCommand: true, explicitUrl: "https://demo.vercel.app" })
assert.deepStrictEqual(parseOpenIntent("buka localhost:3000"), { isCommand: true, explicitUrl: "http://localhost:3000" })
assert.deepStrictEqual(parseOpenIntent("tolong buatkan website toko"), { isCommand: false, explicitUrl: null })

console.log("remote-noise-check & open-intent OK")
