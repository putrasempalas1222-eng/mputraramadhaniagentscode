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
const ONLINE_WINDOW_MS = 45_000
const HEARTBEAT_MS = 20_000

let db = null
let pairing = null // { uid, code, sessionKey }
let watches = [] // { ref, event, handler }
let heartbeatTimer = null
let mirrorWatch = null // { ref, handler }
let pending = [] // [{ text, at }] pesan optimistic sebelum tercatat di mirror

const $ = (id) => document.getElementById(id)
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

  // Status extension + model aktif.
  watch(db.ref(`${base}/state`), "value", (snap) => {
    applyExtensionState(snap.val())
  })

  // Percakapan aktif — disalin extension ke mirror agar website tidak perlu
  // membaca node percakapan akun (tetap privat, owner-only).
  const mirrorRef = db.ref(`${base}/mirror/${pairing.sessionKey}`)
  const handler = (snap) => renderMirror(snap.val())
  mirrorWatch = { ref: mirrorRef, handler }
  watches.push({ ref: mirrorRef, event: "value", handler })
  mirrorRef.on("value", handler)
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
  if (typeof state.model === "string" && state.model) $("chat-model").textContent = state.model
}

function renderMirror(mirror) {
  const container = $("messages")
  const data = mirror && typeof mirror === "object" && mirror.messages ? mirror.messages : null
  const title = mirror && typeof mirror.title === "string" ? mirror.title : ""

  // Bubble "mengirim…" gugur begitu pesannya muncul di mirror.
  if (data) {
    const entries = Object.values(data)
      .filter((m) => m && typeof m.content === "string" && typeof m.role === "string")
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    pending = pending.filter(
      (p) => !entries.some((m) => m.role === "user" && m.content === p.text && (m.createdAt || 0) >= p.at - 2000),
    )
  }

  if (!data || !Object.keys(data).length) {
    const head = title ? `<strong>${escapeHtml(title)}</strong><br />` : ""
    container.innerHTML =
      `<div class="empty-note">${head}Belum ada pesan di sesi ini.<br />` +
      '<span class="muted small-text">Ketik di bawah — pesan diteruskan ke AI melalui extension.</span></div>'
    return
  }

  let html = ""
  if (title) html += `<div class="empty-note" style="padding:6px"><strong>${escapeHtml(title)}</strong></div>`
  for (const m of Object.values(data).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    if (!m || typeof m.content !== "string") continue
    const role = m.role === "user" ? "user" : "assistant"
    // Ringkasan aktivitas tool (respon, edit, dll.) dari extension.
    let toolsHtml = ""
    if (Array.isArray(m.tools) && m.tools.length) {
      toolsHtml = `<div class="tool-line">${m.tools
        .map((t) => {
          const name = t && typeof t.name === "string" && t.name ? t.name : "tool"
          const state = t && typeof t.state === "string" && t.state ? ` · ${t.state}` : ""
          return `<span class="tool-chip">🛠 ${escapeHtml(name)}${escapeHtml(state)}</span>`
        })
        .join("")}</div>`
    }
    html += `<div class="msg ${role}">${toolsHtml}${escapeHtml(m.content)}<span class="meta">${
      role === "user" ? "Anda" : "Agents Code AI"
    }</span></div>`
  }
  for (const p of pending) {
    html += `<div class="msg user pending" data-pending="${p.at}">${escapeHtml(p.text)}<span class="meta">Anda · mengirim…</span></div>`
  }
  container.innerHTML = html
  container.scrollTop = container.scrollHeight
}

async function sendMessage() {
  const input = $("compose")
  const text = input.value.trim()
  if (!text || !pairing) return
  input.value = ""
  pending.push({ text, at: Date.now() })
  renderPendingOnly()
  try {
    await remoteRef(`/inbox/${pairing.sessionKey}`).push({ text, at: Date.now() })
  } catch (error) {
    pending = pending.filter((p) => p.text !== text)
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
    div.className = "msg user pending"
    div.dataset.pending = String(p.at)
    div.innerHTML = `${escapeHtml(p.text)}<span class="meta">Anda · mengirim…</span>`
    container.appendChild(div)
  }
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
  $("compose").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

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
