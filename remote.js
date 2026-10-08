/* global firebase */
/* mputraramadhani agents — Remote Website.
 *
 * Sistem "kode saja" — tanpa login apa pun.
 * 1. User memasukkan kode rahasia dari VS Code (Pengaturan → Akses Remote →
 *    "Buat Kode Baru"). Website membaca remoteBind/{code} → mendapat uid akun.
 * 2. Website membuat sesi di agents-code-ai/remote/{uid}/sessions/{key}.
 *    Rules Firebase hanya mengizinkan ini bila kodenya benar-benar terdaftar
 *    di remoteBind (jadi kode = bukti akses, tanpa perlu akun atau password).
 * 3. Chat: extension menyalin percakapan aktif ke remote/{uid}/mirror/{key}
 *    (website membacanya), pesan website masuk lewat inbox/{key}.
 * 4. Sesi hanya diakhiri dari extension (Keluarkan / Hapus Kode) atau logout
 *    dari website ini.
 */

"use strict"

const DATABASE_URL = "https://database-moyomo-default-rtdb.firebaseio.com"
// Firebase Web API keys identify the Firebase project; database rules and
// Firebase Authentication still enforce all access control.
const FIREBASE_WEB_API_KEY = "AIzaSyDsm-pXC9h1XfJDwWUbmiMV5DoY4EIAOr4"
const FIREBASE_CONFIG = {
  apiKey: FIREBASE_WEB_API_KEY,
  authDomain: "database-moyomo.firebaseapp.com",
  databaseURL: DATABASE_URL,
  projectId: "database-moyomo",
  storageBucket: "database-moyomo.firebasestorage.app",
}

const STORE_KEY = "agentsRemote.pairing.v1"
const $ = (id) => document.getElementById(id)

// ── Theme ───────────────────────────────────────────────────────────────────
;(function initTheme() {
  const html = document.documentElement
  const stored = localStorage.getItem("theme")
  if (stored) {
    html.setAttribute("data-theme", stored)
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.setAttribute("data-theme", "dark")
  } else {
    html.setAttribute("data-theme", "light")
  }
})()
const ONLINE_WINDOW_MS = 45_000
const HEARTBEAT_MS = 20_000
const CHAT_TTL_MS = 5 * 60 * 60 * 1000 // 5 Jam TTL
const LOCAL_HISTORY_PREFIX = "agents_code_remote_history_"

function getLocalHistory(sessionKey) {
  if (!sessionKey) return []
  try {
    const raw = localStorage.getItem(`${LOCAL_HISTORY_PREFIX}${sessionKey}`)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCAL_HISTORY_PREFIX}${sessionKey}=([^;]*)`))
    if (match) {
      try { return JSON.parse(decodeURIComponent(match[1])) } catch {}
    }
  }
  return []
}

function saveLocalHistory(sessionKey, messages) {
  if (!sessionKey || !Array.isArray(messages)) return
  try {
    const trimmed = messages.slice(-100)
    localStorage.setItem(`${LOCAL_HISTORY_PREFIX}${sessionKey}`, JSON.stringify(trimmed))
  } catch (e) {
    try {
      const trimmed = messages.slice(-20)
      document.cookie = `${LOCAL_HISTORY_PREFIX}${sessionKey}=${encodeURIComponent(JSON.stringify(trimmed))}; path=/; max-age=86400; SameSite=Lax`
    } catch {}
  }
}

let db = null
let pairing = null // { uid, code, sessionKey }
let watches = [] // { ref, event, handler }
let heartbeatTimer = null
let mirrorWatch = null // { ref, handler }
let pending = [] // [{ text, at }] pesan optimistic sebelum tercatat di mirror
let currentMirror = null // Menyimpan snapshot mirror percakapan aktif untuk deteksi URL

const views = ["view-pair", "view-chat", "view-kicked"]

function showView(id) {
  for (const v of views) $(v).classList.toggle("hidden", v !== id)
}

function setError(id, message) {
  const el = $(id)
  if (!message) {
    el.classList.add("hidden")
    el.textContent = ""
    return
  }
  el.textContent = message
  el.classList.remove("hidden")
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ── Deteksi & Pembukaan URL di Browser Remote ────────────────────────────────

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

// Ekstraksi seluruh URL dari pesan dan tool output di sesi aktif (urut terbaru)
function extractUrlsFromMirror() {
  if (!currentMirror || !currentMirror.messages) return { published: [], local: [] }
  const rawUrls = []
  const urlRegex = /https?:\/\/[^\s<>"'`()]+/gi

  const sorted = Object.values(currentMirror.messages)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

  for (const m of sorted) {
    if (typeof m.content === "string") {
      const matches = m.content.match(urlRegex)
      if (matches) rawUrls.push(...matches)
    }
    if (Array.isArray(m.tools)) {
      for (const t of m.tools) {
        if (t && typeof t.output === "string") {
          const matches = t.output.match(urlRegex)
          if (matches) rawUrls.push(...matches)
        }
      }
    }
  }

  const cleanList = rawUrls
    .map((u) => u.replace(/[.,;:!?)]+$/, ""))
    .filter((u) => {
      try {
        new URL(u)
        return true
      } catch {
        return false
      }
    })

  const unique = Array.from(new Set(cleanList))
  const published = []
  const local = []

  for (const u of unique) {
    try {
      const parsed = new URL(u)
      if (isLocalHostname(parsed.hostname)) {
        local.push(u)
      } else {
        published.push(u)
      }
    } catch {}
  }

  return { published, local }
}

// Cek apakah pesan adalah perintah untuk membuka website di browser remote
function parseOpenIntent(text) {
  const trimmed = String(text || "").trim()

  // 1. Perintah dengan URL eksplisit: "buka https://site.com", "open localhost:3000"
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

  // 2. Perintah generik: "buka website", "buka web", "buka link", "open website", "buka", "open"
  if (/^(?:buka|open)(?:\s+(?:website|web|link|situs|page|url|halaman|browser))?$/i.test(trimmed)) {
    return { isCommand: true, explicitUrl: null }
  }

  return { isCommand: false, explicitUrl: null }
}

function handleOpenWebsite(commandText, explicitUrl) {
  const { published, local } = extractUrlsFromMirror()
  let targetUrl = explicitUrl
  let isPublish = false

  if (!targetUrl) {
    // Prioritaskan URL publish (agar bisa diakses lewat internet tanpa LAN)
    if (published.length > 0) {
      targetUrl = published[0]
      isPublish = true
    } else if (local.length > 0) {
      targetUrl = local[0]
      isPublish = false
    }
  } else {
    try {
      const parsed = new URL(targetUrl)
      isPublish = !isLocalHostname(parsed.hostname)
    } catch {}
  }

  // Buka langsung di browser perangkat remote
  if (targetUrl) {
    try {
      window.open(targetUrl, "_blank", "noopener")
    } catch (e) {
      console.warn("Popup window.open diblokir browser:", e)
    }
  }

  renderRemoteOpenCard(commandText, targetUrl, isPublish, published, local)
}

function renderRemoteOpenCard(commandText, targetUrl, isPublish, published, local) {
  const container = $("messages")
  const div = document.createElement("div")
  div.className = "msg user open-command-card"

  if (!targetUrl) {
    div.innerHTML =
      '<div class="open-card-head"><span class="open-badge">⚠️ Tidak Ada URL Terdeteksi</span></div>' +
      '<div class="open-url-text" style="color:var(--ink-3)">Belum ada link website aktif yang terdeteksi dari percakapan AI.</div>' +
      '<p class="small-text muted" style="margin-bottom:6px">Ketik URL langsung, contoh: <code>buka https://domain-anda.com</code></p>' +
      '<span class="meta">Perintah Remote · browser perangkat ini</span>'
  } else {
    const altUrls = isPublish ? local : published
    let altButtons = ""
    if (altUrls.length > 0) {
      const altUrl = altUrls[0]
      const altLabel = isPublish ? "💻 Buka Link Lokal" : "🌐 Buka Link Publish (Internet)"
      altButtons = `<a class="open-action-btn alt-btn" href="${escapeHtml(altUrl)}" target="_blank" rel="noopener">${altLabel}</a>`
    }

    div.innerHTML =
      `<div class="open-card-head"><span class="open-badge">🚀 Buka di Browser Remote</span>` +
      `<span class="open-type ${isPublish ? "publish" : "local"}">${isPublish ? "🌐 Link Publish (Internet)" : "💻 Link Lokal"}</span></div>` +
      `<div class="open-url-text">${escapeHtml(targetUrl)}</div>` +
      `<div class="open-btn-group">` +
      `<a class="open-action-btn" href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener">Buka Tab Baru ↗</a>` +
      `${altButtons}` +
      `</div>` +
      `<span class="meta">Dibuka langsung di browser perangkat ini</span>`
  }

  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

function deviceLabel() {
  const ua = navigator.userAgent || ""
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox" : "Browser"
  const os = /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : ""
  return `Website (${[browser, os].filter(Boolean).join(" · ")})`
}

function watch(ref, event, handler) {
  ref.on(event, handler)
  watches.push({ ref, event, handler })
}

function clearWatches() {
  for (const w of watches) w.ref.off(w.event, w.handler)
  watches = []
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (mirrorWatch) {
    mirrorWatch.ref.off("value", mirrorWatch.handler)
    mirrorWatch = null
  }
  pending = []
}

/* ---------- Pairing (kode saja) ---------- */

function loadStoredPairing() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    if (value && value.uid && value.code && value.sessionKey) return value
  } catch { /* korup → anggap tidak ada */ }
  return null
}

function saveStoredPairing(value) {
  if (value) localStorage.setItem(STORE_KEY, JSON.stringify(value))
  else localStorage.removeItem(STORE_KEY)
}

async function pairWithCode(code) {
  setError("pair-error")
  const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (clean.length < 4) {
    setError("pair-error", "Masukkan kode rahasia dari Pengaturan → Akses Remote.")
    return
  }
  $("pair-btn").disabled = true
  try {
    // Kode → uid akun, lewat binding publik yang dibuat extension.
    let bind
    try {
      const snap = await db.ref(`agents-code-ai/remoteBind/${clean}`).get()
      bind = snap.exists() && snap.val() ? snap.val() : null
    } catch (error) {
      setError(
        "pair-error",
        "Gagal memeriksa kode: " + ((error && error.message) || "coba lagi"),
      )
      return
    }
    const uid = bind && typeof bind.uid === "string" ? bind.uid : ""
    if (!uid) {
      setError(
        "pair-error",
        "Kode tidak ditemukan. Pastikan extension versi 1.0.143+ sudah di-update, buat kode baru di Pengaturan → Akses Remote, lalu coba lagi.",
      )
      return
    }
    const sessionRef = db.ref(`agents-code-ai/remote/${uid}/sessions`).push()
    await sessionRef.set({
      code: clean,
      device: deviceLabel(),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    })
    pairing = { uid, code: clean, sessionKey: sessionRef.key }
    saveStoredPairing(pairing)
    $("code-input").value = ""
    enterChat()
  } catch (error) {
    setError("pair-error", "Gagal memasangkan: " + ((error && error.message) || "coba lagi"))
  } finally {
    $("pair-btn").disabled = false
  }
}

function handlePair() {
  pairWithCode($("code-input").value)
}

/* ---------- Chat ---------- */

function remoteRef(path) {
  return db.ref(`agents-code-ai/remote/${pairing.uid}${path}`)
}

function enterChat() {
  showView("view-chat")
  $("chat-account").textContent = `Kode ${pairing.code} · sesi terhubung`
  $("messages").innerHTML =
    '<div class="empty-note">Menunggu extension online…<br /><span class="muted small-text">Pastikan VS Code terbuka dan kode masih berlaku di Pengaturan → Akses Remote.</span></div>'
  setupChatWatches()
}

function setupChatWatches() {
  clearWatches()
  if (!pairing) return
  const base = `agents-code-ai/remote/${pairing.uid}`

  // Sesi dihapus dari extension (Keluarkan / Hapus Kode) → website tidak bisa lanjut.
  watch(db.ref(`${base}/sessions/${pairing.sessionKey}`), "value", (snap) => {
    if (!snap.exists()) kicked("Sesi diakhiri dari extension — remote dikeluarkan atau kode rahasianya dihapus/di-generate ulang.")
  })

  // Heartbeat: extension memakai lastSeen untuk daftar remote terhubung.
  const sessionRef = db.ref(`${base}/sessions/${pairing.sessionKey}/lastSeen`)
  heartbeatTimer = setInterval(() => sessionRef.set(Date.now()).catch(() => undefined), HEARTBEAT_MS)
  sessionRef.set(Date.now()).catch(() => undefined)

  // Status extension + model aktif + katalog model untuk pemilih di website.
  watch(db.ref(`${base}/state`), "value", (snap) => {
    applyExtensionState(snap.val())
  })

  // Pilihan model yang disimpan website untuk pasangan kode ini.
  watch(db.ref(`${base}/sessions/${pairing.sessionKey}/remoteModel`), "value", (snap) => {
    const val = snap.exists() && typeof snap.val() === "string" ? snap.val() : ""
    setModelPickerValue(val)
  })

  const modelSelect = $("chat-model-select")
  if (modelSelect && !modelSelect.dataset.bound) {
    modelSelect.dataset.bound = "1"
    modelSelect.addEventListener("change", () => {
      const value = modelSelect.value
      const ref = db.ref(`${base}/sessions/${pairing.sessionKey}/remoteModel`)
      if (value) {
        ref.set(value).catch(() => setError("chat-error", "Gagal menyimpan pilihan model di Firebase."))
      } else {
        ref.remove().catch(() => undefined)
      }
    })
  }

  // Percakapan aktif — disalin extension ke mirror agar website tidak perlu
  // membaca node percakapan akun (tetap privat, owner-only).
  const mirrorRef = db.ref(`${base}/mirror/${pairing.sessionKey}`)
  const handler = (snap) => renderMirror(snap.val())
  mirrorWatch = { ref: mirrorRef, handler }
  watches.push({ ref: mirrorRef, event: "value", handler })
  mirrorRef.on("value", handler)

  // Pesan yang gagal dikirim extension (mis. model bermasalah) muncul di sini.
  watch(db.ref(`${base}/outbox/${pairing.sessionKey}`), "value", (snap) => {
    renderOutboxError(snap.val())
  })
}

function renderOutboxError(outbox) {
  if (!outbox || typeof outbox !== "object") {
    setError("chat-error")
    return
  }
  const entries = Object.values(outbox).filter((m) => m && typeof m.error === "string")
  if (!entries.length) {
    setError("chat-error")
    return
  }
  entries.sort((a, b) => (a.at || 0) - (b.at || 0))
  const message = entries[entries.length - 1].error
  setError("chat-error", "Pesan belum masuk ke percakapan: " + message)
}

function applyExtensionState(state) {
  const statusEl = $("chat-status")
  if (!state || typeof state.lastSeen !== "number") {
    statusEl.textContent = "Extension: menunggu…"
    statusEl.className = "status waiting"
    return
  }
  const online = Date.now() - state.lastSeen < ONLINE_WINDOW_MS
  statusEl.textContent = online ? "Extension: Terhubung" : "Extension: Tidak aktif — buka VS Code"
  statusEl.className = `status ${online ? "online" : "offline"}`
  if (Array.isArray(state.models)) renderModelPicker(state.models)
}

let lastModelsJson = ""

function renderModelPicker(models) {
  const select = $("chat-model-select")
  if (!select) return
  const json = JSON.stringify(models)
  if (json === lastModelsJson) return
  lastModelsJson = json
  const current = select.value
  select.innerHTML = '<option value="">Otomatis (default)</option>'
  for (const m of models) {
    if (!m || typeof m.provider !== "string" || typeof m.id !== "string") continue
    const value = `${m.provider}/${m.id}`
    const label = typeof m.name === "string" && m.name ? m.name : value
    const opt = document.createElement("option")
    opt.value = value
    opt.textContent = label
    select.appendChild(opt)
  }
  select.disabled = false
  setModelPickerValue(current)
}

function setModelPickerValue(value) {
  const select = $("chat-model-select")
  if (!select) return
  if (value && !Array.from(select.options).some((o) => o.value === value)) {
    const opt = document.createElement("option")
    opt.value = value
    opt.textContent = value
    select.appendChild(opt)
  }
  select.value = value
}

// Buang pesan sampah/noise (mis. banner "Official ELF Gateway") yang muncul
// sebagai teks tak jelas dari penyedia model. Hapus baris yang cocok lalu
// kembalikan null bila seluruh isi pesan hanya noise.
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

let attachedImages = []

// Kompres & konversi File gambar ke base64 Data URL (maks 1280px) agar cepat terkirim
function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      return reject(new Error("Hanya file gambar yang didukung."))
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Format gambar tidak valid."))
      img.onload = () => {
        const MAX_DIM = 1280
        let w = img.width
        let h = img.height
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w > h) {
            h = Math.round((h * MAX_DIM) / w)
            w = MAX_DIM
          } else {
            w = Math.round((w * MAX_DIM) / h)
            h = MAX_DIM
          }
        }
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        ctx.drawImage(img, 0, 0, w, h)
        const isPng = file.type === "image/png"
        const mime = isPng ? "image/png" : "image/jpeg"
        const dataUrl = canvas.toDataURL(mime, isPng ? 0.9 : 0.82)
        resolve(dataUrl)
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

async function handleAddFiles(files) {
  if (!files || !files.length) return
  const list = Array.from(files).filter((f) => f && f.type && f.type.startsWith("image/"))
  if (!list.length) return
  setError("chat-error")
  for (const file of list) {
    if (attachedImages.length >= 6) {
      setError("chat-error", "Maksimal 6 gambar per pesan.")
      break
    }
    try {
      const dataUrl = await fileToCompressedDataUrl(file)
      attachedImages.push(dataUrl)
    } catch (err) {
      setError("chat-error", "Gagal memproses gambar: " + (err.message || "coba lagi"))
    }
  }
  renderAttachmentPreviews()
}

function renderAttachmentPreviews() {
  const bar = $("attachment-preview-bar")
  if (!bar) return
  if (!attachedImages.length) {
    bar.innerHTML = ""
    bar.classList.add("hidden")
    return
  }
  bar.classList.remove("hidden")
  bar.innerHTML = attachedImages
    .map(
      (src, idx) => `
    <div class="attach-thumb-wrapper">
      <img class="attach-thumb" src="${src}" alt="Lampiran" />
      <button type="button" class="attach-remove-btn" data-idx="${idx}" title="Hapus">✕</button>
    </div>
  `
    )
    .join("")

  for (const btn of bar.querySelectorAll(".attach-remove-btn")) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      const idx = Number(btn.dataset.idx)
      if (!Number.isNaN(idx)) {
        attachedImages.splice(idx, 1)
        renderAttachmentPreviews()
      }
    })
  }
}

function setupImageLightboxEvents(container) {
  for (const img of container.querySelectorAll(".remote-image")) {
    img.addEventListener("click", () => {
      openLightbox(img.src)
    })
  }
}

function openLightbox(src) {
  const modal = $("image-lightbox")
  const img = $("lightbox-img")
  if (!modal || !img) return
  img.src = src
  modal.classList.remove("hidden")
}

function closeLightbox() {
  const modal = $("image-lightbox")
  if (!modal) return
  modal.classList.add("hidden")
  const img = $("lightbox-img")
  if (img) img.src = ""
}

const USER_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`
const AI_LOGO_IMG = `<img class="author-avatar ai-avatar logo-img" src="logo.png" alt="Agents Code AI" />`
const BRAIN_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-4 4 4 4 0 0 0 4 4v1a4 4 0 0 0 4 4 4 4 0 0 0 4-4v-1a4 4 0 0 0 4-4 4 4 0 0 0-4-4V6a4 4 0 0 0-4-4z"></path></svg>`

function formatChatMarkdown(text) {
  if (!text) return ""
  const codeBlocks = []
  let safe = String(text).replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length
    const cleanCode = code.replace(/^\n+|\n+$/g, "")
    codeBlocks.push(
      `<div class="chat-code-block">` +
      `<div class="code-header"><span class="code-lang">${escapeHtml(lang || "CODE")}</span><button type="button" class="copy-code-btn" onclick="copySnippet(this)">Salin</button></div>` +
      `<pre><code>${escapeHtml(cleanCode)}</code></pre>` +
      `</div>`
    )
    return `@@@CODEBLOCK_${idx}@@@`
  })

  safe = escapeHtml(safe)

  const inlineCodes = []
  safe = safe.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = inlineCodes.length
    inlineCodes.push(`<code class="inline-code">${code}</code>`)
    return `@@@INLINECODE_${idx}@@@`
  })
  safe = safe.replace(/''([^']+)''/g, (_m, code) => {
    const idx = inlineCodes.length
    inlineCodes.push(`<code class="inline-code">${code}</code>`)
    return `@@@INLINECODE_${idx}@@@`
  })

  // Bold: **text** or __text__
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  safe = safe.replace(/__([^_]+)__/g, "<strong>$1</strong>")

  // Italic: *text* or _text_
  safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  safe = safe.replace(/_([^_]+)_/g, "<em>$1</em>")

  // Strikethrough: ~~text~~
  safe = safe.replace(/~~([^~]+)~~/g, "<del>$1</del>")

  // Headings: ###, ##, #
  safe = safe.replace(/^### (.*?)$/gm, '<h4 class="chat-heading">$1</h4>')
  safe = safe.replace(/^## (.*?)$/gm, '<h3 class="chat-heading">$1</h3>')
  safe = safe.replace(/^# (.*?)$/gm, '<h2 class="chat-heading">$1</h2>')

  // Blockquotes: > quote
  safe = safe.replace(/^> (.*?)$/gm, '<blockquote class="chat-quote">$1</blockquote>')

  // Lists: - or *
  safe = safe.replace(/^[*-] (.*?)$/gm, '<li class="chat-list-item">$1</li>')
  safe = safe.replace(/^\d+\. (.*?)$/gm, '<li class="chat-list-item chat-list-ordered">$1</li>')

  // URLs
  safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a class="chat-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>')

  // Restore inline code
  safe = safe.replace(/@@@INLINECODE_(\d+)@@@/g, (_m, idx) => inlineCodes[Number(idx)] || "")

  // Restore code blocks
  safe = safe.replace(/@@@CODEBLOCK_(\d+)@@@/g, (_m, idx) => codeBlocks[Number(idx)] || "")

  return safe
}

function copySnippet(btn) {
  const pre = btn.closest(".chat-code-block")?.querySelector("pre code")
  if (!pre) return
  navigator.clipboard.writeText(pre.textContent || "").then(() => {
    const orig = btn.textContent
    btn.textContent = "Disalin!"
    btn.classList.add("copied")
    setTimeout(() => {
      btn.textContent = orig
      btn.classList.remove("copied")
    }, 2000)
  })
}
window.copySnippet = copySnippet

function renderMirror(mirror) {
  const now = Date.now()
  const updatedAt = mirror && typeof mirror === "object" && typeof mirror.updatedAt === "number" ? mirror.updatedAt : 0
  const isExpired = updatedAt > 0 && now - updatedAt >= CHAT_TTL_MS

  if (isExpired) {
    currentMirror = null
    const container = $("messages")
    const titleEl = $("chat-title")
    if (titleEl) titleEl.classList.add("hidden")
    container.innerHTML =
      '<div class="empty-note"><strong>Sesi di-reset (5 jam)</strong><br />Riwayat percakapan telah dibersihkan otomatis setelah 5 jam.<br />' +
      '<span class="muted small-text">Ketik pesan di bawah atau lampirkan gambar untuk memulai sesi baru.</span></div>'
    return
  }

  currentMirror = mirror
  const container = $("messages")
  const rawData = mirror && typeof mirror === "object" && mirror.messages ? mirror.messages : null
  const title = mirror && typeof mirror.title === "string" ? mirror.title : ""

  const titleEl = $("chat-title")
  if (titleEl) {
    if (title) {
      titleEl.textContent = title
      titleEl.title = title
      titleEl.classList.remove("hidden")
    } else {
      titleEl.classList.add("hidden")
    }
  }

  // Filter hanya pesan dalam rentang 5 jam
  let data = null
  if (rawData && typeof rawData === "object") {
    const valid = Object.entries(rawData).filter(([, m]) => {
      if (!m || typeof m !== "object") return false
      const created = typeof m.createdAt === "number" ? m.createdAt : 0
      return created === 0 || now - created < CHAT_TTL_MS
    })
    if (valid.length > 0) {
      data = Object.fromEntries(valid)
    }
  }

  // Sinkronkan dan simpan riwayat di cache lokal browser (localStorage/cookie)
  const sessionKey = pairing?.sessionKey || ""
  let allEntries = []
  if (data) {
    const remoteEntries = Object.values(data)
      .filter((m) => m && (typeof m.content === "string" || Array.isArray(m.images) || Array.isArray(m.tools)) && typeof m.role === "string")

    const localEntries = getLocalHistory(sessionKey)
    const mapBySig = new Map()
    for (const item of [...localEntries, ...remoteEntries]) {
      const sig = `${item.role || ""}_${item.createdAt || 0}_${(item.content || "").slice(0, 40)}`
      mapBySig.set(sig, item)
    }
    allEntries = Array.from(mapBySig.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    saveLocalHistory(sessionKey, allEntries)

    // Bubble "mengirim…" gugur begitu pesannya muncul di mirror.
    pending = pending.filter(
      (p) => !allEntries.some((m) => m.role === "user" && m.content === p.text && (m.createdAt || 0) >= p.at - 4000),
    )
  } else {
    allEntries = getLocalHistory(sessionKey).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  }

  if (!allEntries.length) {
    const head = title ? `<strong>${escapeHtml(title)}</strong><br />` : ""
    container.innerHTML =
      `<div class="empty-note">${head}Belum ada pesan di sesi ini.<br />` +
      '<span class="muted small-text">Ketik di bawah atau lampirkan gambar — pesan diteruskan ke AI melalui extension.</span></div>'
    return
  }

  let html = ""
  for (const m of allEntries) {
    if (!m) continue
    const rawContent = typeof m.content === "string" ? m.content : ""
    const clean = cleanContent(rawContent)
    const hasImages = Array.isArray(m.images) && m.images.length > 0
    const hasTools = Array.isArray(m.tools) && m.tools.length > 0
    if (clean === null && !hasImages && !hasTools) continue

    const isUser = m.role === "user"
    const authorName = isUser ? "Anda" : "Agents Code AI"
    const authorAvatar = isUser
      ? `<span class="author-avatar user-avatar">${USER_ICON_SVG}</span>`
      : AI_LOGO_IMG
    const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""

    let toolsHtml = ""
    if (hasTools) {
      toolsHtml = `<div class="tool-line">${m.tools
        .map((t) => {
          const name = t && typeof t.name === "string" && t.name ? t.name : "tool"
          const status = t && typeof t.status === "string" && t.status ? t.status : "unknown"
          const tTitle = t && typeof t.title === "string" && t.title ? t.title : ""
          const input = t && typeof t.input === "string" && t.input ? t.input : ""
          const output = t && typeof t.output === "string" && t.output ? t.output : ""
          const error = t && typeof t.error === "string" && t.error ? t.error : ""
          return (
            `<div class="tool-card"><div class="tool-head"><span class="tool-name">${escapeHtml(name)}</span>` +
            `<span class="tool-status ${escapeHtml(status)}">${escapeHtml(status)}</span></div>` +
            (tTitle ? `<div class="tool-title">${escapeHtml(tTitle)}</div>` : "") +
            (input ? `<details class="tool-details"><summary>Argumen / perintah</summary><pre>${escapeHtml(input)}</pre></details>` : "") +
            (output ? `<details class="tool-details" open><summary>Hasil</summary><pre>${escapeHtml(output)}</pre></details>` : "") +
            (error ? `<div class="tool-error">${escapeHtml(error)}</div>` : "") +
            `</div>`
          )
        })
        .join("")}</div>`
    }

    let reasoningHtml = ""
    if (typeof m.reasoning === "string" && m.reasoning) {
      reasoningHtml = `<details class="reasoning"><summary><span class="reasoning-badge">${BRAIN_ICON_SVG} Penalaran AI</span></summary><pre>${escapeHtml(m.reasoning)}</pre></details>`
    }

    let imagesHtml = ""
    if (hasImages) {
      imagesHtml = `<div class="msg-images">${m.images
        .filter((src) => typeof src === "string" && (src.startsWith("data:image/") || src.startsWith("http")))
        .map((src) => `<img class="remote-image" src="${src}" alt="Gambar lampiran" loading="lazy" />`)
        .join("")}</div>`
    }

    const textContent = clean !== null ? formatChatMarkdown(clean) : ""

    const authorHeader = isUser
      ? `<div class="msg-author-tag"><span class="author-name">${escapeHtml(authorName)}</span>${authorAvatar}</div>`
      : `<div class="msg-author-tag">${authorAvatar}<span class="author-name">${escapeHtml(authorName)}</span></div>`

    html += `<div class="msg-wrapper ${isUser ? "user" : "assistant"}">` +
      `${authorHeader}` +
      `<div class="msg ${isUser ? "user" : "assistant"}">` +
      `${toolsHtml}${reasoningHtml}${imagesHtml}` +
      (textContent ? `<div class="msg-text">${textContent}</div>` : "") +
      (timeStr ? `<div class="msg-footer">${timeStr}</div>` : "") +
      `</div></div>`
  }

  for (const p of pending) {
    let pImagesHtml = ""
    if (Array.isArray(p.images) && p.images.length) {
      pImagesHtml = `<div class="msg-images">${p.images
        .map((src) => `<img class="remote-image" src="${src}" alt="Lampiran pending" />`)
        .join("")}</div>`
    }
    html += `<div class="msg-wrapper user pending" data-pending="${p.at}">` +
      `<div class="msg-author-tag"><span class="author-name">Anda</span><span class="author-avatar user-avatar">${USER_ICON_SVG}</span></div>` +
      `<div class="msg user pending-bubble">` +
      `${pImagesHtml}` +
      (p.text ? `<div class="msg-text">${formatChatMarkdown(p.text)}</div>` : "") +
      `<div class="msg-footer"><span class="pending-spinner"></span> Mengirim…</div>` +
      `</div></div>`
  }

  container.innerHTML = html
  setupImageLightboxEvents(container)
  container.scrollTop = container.scrollHeight
}

function autoResizeTextarea() {
  const textarea = $("compose")
  if (!textarea) return
  textarea.style.height = "auto"
  if (textarea.value) {
    const newHeight = Math.min(textarea.scrollHeight, 160)
    textarea.style.height = `${newHeight}px`
  }
}

async function sendMessage() {
  const input = $("compose")
  const text = input.value.trim()
  const images = [...attachedImages]
  if (!text && !images.length) return
  if (!pairing) return

  input.value = ""
  input.style.height = "auto"
  attachedImages = []
  renderAttachmentPreviews()
  setError("chat-error")

  // Tangani perintah pembukaan website di browser remote (tanpa membuka di laptop)
  const openIntent = parseOpenIntent(text)
  if (openIntent.isCommand && !images.length) {
    handleOpenWebsite(text, openIntent.explicitUrl)
    return
  }

  pending.push({ text, images, at: Date.now() })
  renderPendingOnly()
  try {
    const payload = { text, at: Date.now() }
    if (images.length) payload.images = images
    await remoteRef(`/inbox/${pairing.sessionKey}`).push(payload)
  } catch (error) {
    pending = pending.filter((p) => p.text !== text || p.images !== images)
    renderPendingOnly()
    alert("Pesan gagal terkirim: " + ((error && error.message) || "coba lagi"))
  }
}

function renderPendingOnly() {
  const container = $("messages")
  const note = container.querySelector(".empty-note")
  if (note) note.remove()
  for (const p of pending) {
    if (container.querySelector(`[data-pending="${p.at}"]`)) continue
    const div = document.createElement("div")
    div.className = "msg-wrapper user pending"
    div.dataset.pending = String(p.at)
    let pImagesHtml = ""
    if (Array.isArray(p.images) && p.images.length) {
      pImagesHtml = `<div class="msg-images">${p.images
        .map((src) => `<img class="remote-image" src="${src}" alt="Lampiran pending" />`)
        .join("")}</div>`
    }
    div.innerHTML = `<div class="msg-author-tag"><span class="author-name">Anda</span><span class="author-avatar user-avatar">${USER_ICON_SVG}</span></div>` +
      `<div class="msg user pending-bubble">` +
      `${pImagesHtml}` +
      (p.text ? `<div class="msg-text">${escapeHtml(p.text)}</div>` : "") +
      `<div class="msg-footer"><span class="pending-spinner"></span> Mengirim…</div>` +
      `</div>`
    container.appendChild(div)
  }
  setupImageLightboxEvents(container)
  container.scrollTop = container.scrollHeight
}

/* ---------- Keluar / kicked ---------- */

async function handleLogout() {
  const wasPairing = pairing
  pairing = null
  saveStoredPairing(null)
  clearWatches()
  if (wasPairing) {
    try {
      await db.ref(`agents-code-ai/remote/${wasPairing.uid}/sessions/${wasPairing.sessionKey}`).remove()
    } catch { /* biarkan extension yang membersihkan */ }
  }
  showView("view-pair")
}

function kicked(reason) {
  clearWatches()
  pairing = null
  saveStoredPairing(null)
  $("kicked-reason").textContent = reason
  showView("view-kicked")
}

/* ---------- Bootstrap ---------- */

function initialise() {
  firebase.initializeApp(FIREBASE_CONFIG)
  db = firebase.database()

  $("pair-btn").addEventListener("click", handlePair)
  $("code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handlePair()
  })
  $("code-input").addEventListener("input", (e) => {
    e.target.value = String(e.target.value).toUpperCase().replace(/[^A-Z0-9]/g, "")
  })
  $("chat-logout").addEventListener("click", handleLogout)
  $("kicked-back").addEventListener("click", () => {
    pairing = null
    saveStoredPairing(null)
    showView("view-pair")
  })
  $("send-btn").addEventListener("click", sendMessage)
  $("compose").addEventListener("input", autoResizeTextarea)
  $("compose").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  const attachBtn = $("attach-btn")
  const fileInput = $("file-input")
  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click())
    fileInput.addEventListener("change", (e) => {
      handleAddFiles(e.target.files)
      fileInput.value = ""
    })
  }

  // Paste gambar langsung ke chat dari clipboard (Ctrl+V / Cmd+V)
  window.addEventListener("paste", (e) => {
    if ($("view-chat").classList.contains("hidden")) return
    const items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData))?.items
    if (!items) return
    const files = []
    for (const item of items) {
      if (item.type && item.type.indexOf("image") !== -1) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length) {
      e.preventDefault()
      handleAddFiles(files)
    }
  })

  // Drag & drop gambar ke halaman chat
  const chatView = $("view-chat")
  if (chatView) {
    chatView.addEventListener("dragover", (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    chatView.addEventListener("drop", (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer && e.dataTransfer.files) {
        handleAddFiles(e.dataTransfer.files)
      }
    })
  }

  // Lightbox tutup
  const lbClose = $("lightbox-close")
  const lbModal = $("image-lightbox")
  if (lbClose) lbClose.addEventListener("click", closeLightbox)
  if (lbModal) {
    lbModal.addEventListener("click", (e) => {
      if (e.target === lbModal) closeLightbox()
    })
  }

  // Theme toggle: light ↔ dark persis seperti navbar landing page.
  const themeBtn = $("themeToggle")
  if (themeBtn) {
    themeBtn.addEventListener("click", (e) => {
      e.preventDefault()
      const html = document.documentElement
      const current = html.getAttribute("data-theme") || "light"
      const next = current === "light" ? "dark" : "light"
      html.setAttribute("data-theme", next)
      localStorage.setItem("theme", next)
    })
  }

  handleStart()
}

// Kode dari link "Buka di website" di extension (?code=…) diprioritaskan,
// lalu pairing tersimpan dari sesi sebelumnya; jika tidak ada → form kode.
function handleStart() {
  const params = new URLSearchParams(location.search)
  const codeParam = params.get("code")
  if (codeParam) {
    history.replaceState(null, "", location.pathname)
    pairing = null
    saveStoredPairing(null)
    $("code-input").value = codeParam
    pairWithCode(codeParam)
    return
  }
  const stored = loadStoredPairing()
  if (stored) {
    // Validasi sesi masih ada (belum dikeluarkan dari extension).
    db.ref(`agents-code-ai/remote/${stored.uid}/sessions/${stored.sessionKey}`)
      .get()
      .then((snap) => {
        if (snap.exists()) {
          pairing = stored
          enterChat()
        } else {
          pairing = null
          saveStoredPairing(null)
          showView("view-pair")
        }
      })
      .catch(() => showView("view-pair"))
  } else {
    pairing = null
    showView("view-pair")
  }
}

initialise()
