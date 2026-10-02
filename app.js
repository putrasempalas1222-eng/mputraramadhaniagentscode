'use strict'
document.documentElement.classList.add('js')

/* ── Mobile nav toggle ── */
;(function () {
  var toggle = document.querySelector('.nav-toggle')
  var links = document.querySelector('.nav-links')
  var nav = document.querySelector('.nav')
  if (!toggle || !links) return

  function closeMenu() {
    links.classList.remove('open')
    if (nav) nav.classList.remove('menu-open')
    toggle.textContent = '\u2630'
    toggle.setAttribute('aria-expanded', 'false')
    document.body.style.overflow = ''
  }

  function openMenu() {
    links.classList.add('open')
    if (nav) nav.classList.add('menu-open')
    toggle.textContent = '\u2715'
    toggle.setAttribute('aria-expanded', 'true')
    document.body.style.overflow = 'hidden'
  }

  toggle.addEventListener('click', function () {
    toggle.classList.add('spin')
    toggle.addEventListener('animationend', function () { toggle.classList.remove('spin') }, { once: true })
    if (links.classList.contains('open')) closeMenu()
    else openMenu()
  })

  // Close on nav link click
  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', closeMenu)
  })

  // Close on click outside menu
  document.addEventListener('click', function (e) {
    if (links.classList.contains('open') && !links.contains(e.target) && !toggle.contains(e.target)) {
      closeMenu()
    }
  })

  // Close on scroll
  window.addEventListener('scroll', function () {
    if (links.classList.contains('open')) closeMenu()
  }, { passive: true })

  // Close on resize to desktop
  window.addEventListener('resize', function () {
    if (window.innerWidth > 768 && links.classList.contains('open')) closeMenu()
  })
})()

/* ── Theme toggle ── */
;(function () {
  var btn = document.getElementById('themeToggle')
  if (!btn) return
  var html = document.documentElement
  var stored = localStorage.getItem('theme')
  if (stored) html.setAttribute('data-theme', stored)
  else if (window.matchMedia('(prefers-color-scheme: light)').matches)
    html.setAttribute('data-theme', 'light')
  btn.addEventListener('click', function (e) {
    e.preventDefault()
    var next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    html.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    var toast = document.getElementById('toast')
    if (toast) {
      toast.textContent = next === 'light' ? 'Light mode enabled' : 'Dark mode enabled'
      toast.classList.add('show')
      setTimeout(function () { toast.classList.remove('show') }, 1400)
    }
  })
})()

/* ── Back to top ── */
;(function () {
  var btn = document.getElementById('backToTop')
  if (!btn) return
  window.addEventListener('scroll', function () {
    btn.classList.toggle('visible', window.scrollY > 260)
  }, { passive: true })
})()

/* ── Copy install command ── */
;(function () {
  var wraps = document.querySelectorAll('.code-wrap')
  wraps.forEach(function (wrap) {
    var code = wrap.querySelector('code')
    var btn = wrap.querySelector('.copy-btn')
    if (!code || !btn) return
    btn.addEventListener('click', function () {
      var text = code.textContent.trim()
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = 'Copied!'
          btn.classList.add('copied')
          setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied') }, 1400)
        })
      }
    })
  })
})()

/* ── Fade-up on scroll ── */
;(function () {
  var items = document.querySelectorAll('.fade-up')
  if (!items.length) return
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.08, rootMargin: '0px 0px -12px 0px' })
    items.forEach(function (el) { observer.observe(el) })
  } else {
    items.forEach(function (el) { el.classList.add('visible') })
  }
})()

/* ── Reveal bertahap untuk semua item ── */
;(function () {
  var groups = [
    { sel: '.features .feat', step: 70 },
    { sel: '.step', step: 90 },
    { sel: '.faq-item', step: 60 }
  ]
  var all = []
  groups.forEach(function (g) {
    document.querySelectorAll(g.sel).forEach(function (el, i) {
      el.classList.add('reveal')
      el.style.transitionDelay = Math.min(i * g.step, 420) + 'ms'
      all.push(el)
    })
  })
  if (!all.length) return
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target) }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    all.forEach(function (el) { obs.observe(el) })
  } else {
    all.forEach(function (el) { el.classList.add('visible') })
  }
})()

/* ── Bayangan nav saat scroll ── */
;(function () {
  var nav = document.querySelector('.nav')
  if (!nav) return
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 8) }
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})()
/* ── Tab title / favicon tiap tema (opsional) ── */
;(function () {
  var link = document.querySelector('link[rel="icon"]')
  if (link) return
  var icon = document.createElement('link')
  icon.rel = 'icon'
  icon.href = 'logo.png'
  document.head.appendChild(icon)
})()

/* ── Buka halaman di browser default ── */
;(function () {
  document.querySelectorAll('[data-open-browser]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      var url = btn.dataset.openBrowser || location.href
      if (window.open) window.open(url, '_blank', 'noopener')
    })
  })
})()

/* ── Pilihan bahasa ID / EN ── */
;(function () {
  var dict = {
    id: {
      'nav.downloads': 'Unduhan',
      'nav.features': 'Fitur',
      'nav.install': 'Instalasi',
      'nav.shortcuts': 'Pintasan',
      'nav.faq': 'FAQ',
      'nav.cta': 'Unduh',
      'hero.badge': 'Ekstensi VS Code',
      'hero.title': 'Agen coding AI<br><span>pintar</span> untuk VS Code',
      'hero.desc': 'Agent Manager, worktree paralel, autocomplete inline, dan dukungan penuh untuk semua model AI lewat proxy lokal.',
      'hero.marketplace': 'Buka Marketplace',
      'hero.browser': 'Buka di Browser',
      'logos.label': 'Didukung oleh model Deep Putra',
      'dl.label': 'Unduhan',
      'dl.title': 'File Ekstensi',
      'dl.sub': 'Pilih versi dan pasang langsung ke VS Code.',
      'dl.descLatest': 'Agen coding AI dengan Agent Manager, autocomplete, dan dukungan multi-provider',
      'dl.btn': 'Unduh',
      'dl.latest': 'TERBARU',
      'dl.prev': 'v1.0.116 — Rilis stabil sebelumnya',
      'dl.legacy': 'v1.0.115 — Build lama',
      'dl.archived': 'Diarsipkan',
      'feat.label': 'Fitur',
      'feat.title': 'Apa yang dikerjakan',
      'feat.sub': 'Semua yang kamu butuhkan untuk menulis kode lebih cepat dengan bantuan AI.',
      'feat.manager': 'Agent Manager',
      'feat.managerDesc': 'Jalankan banyak agen AI secara paralel di worktree Git terisolasi. Tiap sesi dapat cabang dan tugas sendiri.',
      'feat.autocomplete': 'Autocomplete Inline',
      'feat.autocompleteDesc': 'Prediksi edit berikutnya dengan UX lompat-ke-edit. Tekan Tab untuk menerima saran langsung di kode kamu.',
      'feat.terminal': 'Integrasi Terminal',
      'feat.terminalDesc': 'Jelaskan, perbaiki, atau tambahkan output terminal ke konteks langsung dari editor. AI memahami error build kamu secara langsung.',
      'feat.multi': 'Multi-Provider',
      'feat.multiDesc': 'Terhubung ke Anthropic, OpenAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, dan banyak lagi lewat satu proxy terpadu.',
      'feat.catalog': 'Katalog Model Kustom',
      'feat.catalogDesc': 'Dashboard admin untuk mengelola provider, model, harga, dan overhead token per model tanpa menyentuh kode.',
      'feat.reasoning': 'Kontrol Penalaran',
      'feat.reasoningDesc': 'Ubah tingkat usaha penalaran dengan Ctrl+.. Beralih antara pemikiran cepat dan dalam per sesi.',
      'feat.memory': 'Memori Proyek',
      'feat.memoryDesc': 'Konteks persisten antar sesi. Agen mempelajari struktur proyek, konvensi, dan keputusan kamu.',
      'feat.browser': 'Otomasi Browser',
      'feat.browserDesc': 'Panel browser eksperimental berbasis Playwright. Biarkan agen berinteraksi dengan halaman web untuk pengujian dan riset.',
      'install.label': 'Instalasi',
      'install.title': 'Mulai dalam 4 langkah',
      'install.sub': 'Pasang ekstensi dan mulai coding dengan AI dalam hitungan menit.',
      'install.s1': 'Unduh file VSIX',
      'install.s1Desc': 'Pilih versi di atas dan klik Unduh. File mandiri — tidak perlu internet setelah diunduh.',
      'install.s2': 'Pasang lewat baris perintah',
      'install.s2Desc': 'Buka terminal di VS Code dan jalankan:',
      'copy': 'Salin',
      'install.s3': 'Muat Ulang VS Code',
      'install.s3Desc': 'Tekan <kbd>Ctrl+Shift+P</kbd>, ketik <code>Reload Window</code>, lalu Enter. Panel Agen muncul di sidebar.',
      'install.s4': 'Atur provider kamu',
      'install.s4Desc': 'Buka Pengaturan, cari <code>Agents Code</code>, lalu atur provider dan model default.',
      'short.label': 'Referensi',
      'short.title': 'Pintasan Keyboard',
      'short.sub': 'Kuasai pintasan ini untuk bekerja lebih cepat dengan MPutraRamadhani Agents Code Ai.',
      'short.th1': 'Pintasan',
      'short.th2': 'Tindakan',
      'short.r1': 'Fokus input chat',
      'short.r2': 'Buka Agent Manager',
      'short.r3': 'Aktifkan auto-approve',
      'short.r4': 'Buat perintah terminal',
      'short.r5': 'Picu autocomplete inline',
      'short.r6': 'Terima saran edit berikutnya',
      'short.r7': 'Tutup saran / panel',
      'short.r8': 'Ubah tingkat usaha penalaran',
      'short.r9': 'Lompat ke sesi agen 1–9',
      'short.r10': 'Worktree Agent Manager baru',
      'short.r11': 'Worktree baru cepat',
      'short.r12': 'Alihkan panel diff',
      'short.r13': 'Cari di Agent Manager',
      'short.r14': 'Buka pull request',
      'faq.label': 'FAQ',
      'faq.title': 'Pertanyaan Umum',
      'faq.sub': 'Jawaban cepat untuk memulai.',
      'faq.q1': 'Apakah ekstensi ini gratis?',
      'faq.a1': 'Ya. Ekstensi open-source di bawah MIT. Sebagian provider AI mungkin punya biaya sendiri — cek halaman harga masing-masing.',
      'faq.q2': 'Apakah saya perlu API key?',
      'faq.a2': 'Setidaknya satu key provider diperlukan untuk chat atau autocomplete. Tambahkan lewat pengaturan ekstensi atau dashboard admin.',
      'faq.q3': 'Bisakah saya pakai model lokal sendiri?',
      'faq.a3': 'Ya. Endpoint apa pun yang kompatibel dengan OpenAI bisa dipakai. Tambahkan provider di dashboard admin dan model muncul otomatis.',
      'faq.q4': 'Bagaimana cara kerja worktree Agent Manager?',
      'faq.a4': 'Tiap sesi agen mendapat worktree Git terisolasi (checkout paralel). Perubahan di-commit ke cabang terpisah sehingga tidak pernah konflik.',
      'faq.q5': 'Di mana data saya disimpan?',
      'faq.a5': 'Sesi dan riwayat tersimpan lokal di <code>~/.config/agents-code-ai/</code>. Firebase hanya untuk admin — bukan isi percakapan.',
      'footer.copy': '© 2026 M Putra Ramadhani · Lisensi MIT'
    },
    en: {
      'nav.downloads': 'Downloads',
      'nav.features': 'Features',
      'nav.install': 'Install',
      'nav.shortcuts': 'Shortcuts',
      'nav.faq': 'FAQ',
      'nav.cta': 'Download',
      'hero.badge': 'VS Code Extension',
      'hero.title': 'Your AI coding<br><span>agent</span> for VS Code',
      'hero.desc': 'Agent Manager, parallel worktrees, inline autocomplete, and full support for all AI models through a local proxy.',
      'hero.marketplace': 'Get on Marketplace',
      'hero.browser': 'Open in Browser',
      'logos.label': 'Powered by Deep Putra models',
      'dl.label': 'Downloads',
      'dl.title': 'Extension Files',
      'dl.sub': 'Pick a version and install directly into VS Code.',
      'dl.descLatest': 'AI coding agent with Agent Manager, autocomplete, and multi-provider support',
      'dl.btn': 'Download',
      'dl.latest': 'LATEST',
      'dl.prev': 'v1.0.116 — Previous stable release',
      'dl.legacy': 'v1.0.115 — Legacy build',
      'dl.archived': 'Archived',
      'feat.label': 'Features',
      'feat.title': 'What it does',
      'feat.sub': 'Everything you need to ship code faster with AI assistance.',
      'feat.manager': 'Agent Manager',
      'feat.managerDesc': 'Run multiple AI agents in parallel across isolated Git worktrees. Each session gets its own branch and task assignment.',
      'feat.autocomplete': 'Inline Autocomplete',
      'feat.autocompleteDesc': 'Next-edit predictions with jump-to-edit UX. Press Tab to accept suggested changes directly in your code.',
      'feat.terminal': 'Terminal Integration',
      'feat.terminalDesc': 'Explain, fix, or add terminal output to context right from the editor. AI understands your build errors live.',
      'feat.multi': 'Multi-Provider',
      'feat.multiDesc': 'Connect to Anthropic, OpenAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, and many more through a single unified proxy.',
      'feat.catalog': 'Custom Model Catalog',
      'feat.catalogDesc': 'Admin dashboard to manage providers, models, pricing, and per-model token overhead without touching code.',
      'feat.reasoning': 'Reasoning Control',
      'feat.reasoningDesc': 'Cycle reasoning effort levels with Ctrl+.. Switch between fast and deep thinking per session on the fly.',
      'feat.memory': 'Project Memory',
      'feat.memoryDesc': 'Persistent context across sessions. The agent learns your project structure, conventions, and decisions.',
      'feat.browser': 'Browser Automation',
      'feat.browserDesc': 'Experimental Playwright-based browser panel. Let the agent interact with web pages for testing and research.',
      'install.label': 'Installation',
      'install.title': 'Get started in 4 steps',
      'install.sub': 'Install the extension and start coding with AI in minutes.',
      'install.s1': 'Download the VSIX file',
      'install.s1Desc': 'Pick a version above and click Download. The file is self-contained — no internet required after download.',
      'install.s2': 'Install via command line',
      'install.s2Desc': 'Open a terminal in VS Code and run:',
      'copy': 'Copy',
      'install.s3': 'Reload VS Code',
      'install.s3Desc': 'Press <kbd>Ctrl+Shift+P</kbd>, type <code>Reload Window</code>, and hit Enter. The Agent panel will appear in the sidebar.',
      'install.s4': 'Configure your provider',
      'install.s4Desc': 'Open Settings, search for <code>Agents Code</code>, and set your default provider and model.',
      'short.label': 'Reference',
      'short.title': 'Keyboard Shortcuts',
      'short.sub': 'Master these shortcuts to work faster with MPutraRamadhani Agents Code Ai.',
      'short.th1': 'Shortcut',
      'short.th2': 'Action',
      'short.r1': 'Focus chat input',
      'short.r2': 'Open Agent Manager',
      'short.r3': 'Toggle auto-approve',
      'short.r4': 'Generate terminal command',
      'short.r5': 'Trigger inline autocomplete',
      'short.r6': 'Accept next edit suggestion',
      'short.r7': 'Dismiss suggestion / close panel',
      'short.r8': 'Cycle reasoning effort level',
      'short.r9': 'Jump to agent session 1–9',
      'short.r10': 'New Agent Manager worktree',
      'short.r11': 'Quick new worktree',
      'short.r12': 'Toggle diff panel',
      'short.r13': 'Search in Agent Manager',
      'short.r14': 'Open pull request',
      'faq.label': 'FAQ',
      'faq.title': 'Common questions',
      'faq.sub': 'Quick answers to help you get started.',
      'faq.q1': 'Is this extension free?',
      'faq.a1': 'Yes. The extension is open-source under MIT. Some AI providers may have their own usage costs — check each provider\'s pricing page.',
      'faq.q2': 'Do I need an API key?',
      'faq.a2': 'At least one provider key is required to use chat or autocomplete features. Add it through the extension settings or the admin dashboard.',
      'faq.q3': 'Can I use my own local models?',
      'faq.a3': 'Yes. Any OpenAI-compatible endpoint works. Add your provider in the admin dashboard and the model appears automatically.',
      'faq.q4': 'How do Agent Manager worktrees work?',
      'faq.a4': 'Each agent session gets its own isolated Git worktree (a parallel checkout). Changes commit to separate branches so they never conflict.',
      'faq.q5': 'Where is my data stored?',
      'faq.a5': 'Sessions and history live locally in <code>~/.config/agents-code-ai/</code>. Firebase is used only for admin management — not for conversation content.',
      'footer.copy': '© 2026 M Putra Ramadhani · MIT License'
    }
  }

  var saved = null
  try { saved = localStorage.getItem('lang') } catch (e) {}
  var lang = saved === 'en' || saved === 'id' ? saved : 'id'

  function apply(l) {
    var t = dict[l] || dict.id
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n')
      if (t[k] != null) el.textContent = t[k]
    })
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-html')
      if (t[k] != null) el.innerHTML = t[k]
    })
    document.documentElement.lang = l
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.lang === l)
    })
  }

  document.querySelectorAll('.lang-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      apply(b.dataset.lang)
      try { localStorage.setItem('lang', b.dataset.lang) } catch (e) {}
    })
  })

  apply(lang)
})()
