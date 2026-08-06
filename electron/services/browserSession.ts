import { app, session, BrowserWindow, Session, DownloadItem } from 'electron'
import fetch from 'cross-fetch'
import { join, extname, basename, resolve, relative, isAbsolute } from 'path'
import { existsSync, writeFileSync, readFileSync, cpSync, rmSync } from 'fs'
import AdmZip from 'adm-zip'

/**
 * Dedicated, hardened session partition for the in-app browser (tabs + widget).
 * Kept isolated from the renderer's own session so cookies / cache / service
 * workers from browsed sites never touch the app origin.
 */
export const BROWSER_PARTITION = 'persist:fterm-browser'
// Non-persistent twin partition used when "remember me" is OFF: cookies / storage
// live only in memory and are wiped when the partition's last window closes.
export const BROWSER_SESSION_PARTITION = 'fterm-browser-session'

let blockedCount = 0
let initialized = false

// Active downloads, keyed by a monotonic id so the renderer can address them.
let dlCounter = 0
const downloads = new Map<number, DownloadItem>()
// Paths actually written by completed downloads — used to authorize open/reveal.
const savedPaths = new Set<string>()

function broadcast(channel: string, payload: any) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

// Blocked-request bursts arrive dozens at a time on ad-heavy pages; coalesce the
// IPC so we push at most one stats event per 500ms.
let statsTimer: NodeJS.Timeout | null = null
function broadcastStats() {
  if (statsTimer) return
  statsTimer = setTimeout(() => {
    statsTimer = null
    broadcast('browser:adblock-stats', { blocked: blockedCount })
  }, 500)
}

/**
 * Count requests killed by uBOL. MV3 declarativeNetRequest gives no JS callback,
 * but a cancelled request surfaces as `net::ERR_BLOCKED_BY_CLIENT` on the passive
 * `onErrorOccurred` event — no blocking listener involved, so none of the
 * webRequest-blocking instability applies here.
 */
function installBlockCounter(sess: Session) {
  sess.webRequest.onErrorOccurred((details) => {
    if (details.error && details.error.includes('ERR_BLOCKED_BY_CLIENT')) {
      blockedCount++
      broadcastStats()
    }
  })
}

/** Strip path separators / control chars from a remote-supplied filename. */
function sanitizeFilename(name: string): string {
  const cleaned = basename(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim()
  return cleaned || 'download'
}

/** Resolve a non-colliding path inside the OS Downloads folder. */
function uniquePath(filename: string): string {
  const dir = app.getPath('downloads')
  const ext = extname(filename)
  const stem = filename.slice(0, filename.length - ext.length)
  let candidate = join(dir, filename)
  let i = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${i})${ext}`)
    i++
  }
  return candidate
}

/** Harden the browser session: deny dangerous permissions, force https-friendly defaults. */
function hardenSession(sess: Session) {
  // Denylist model: block only the genuinely dangerous permissions (device access,
  // location, clipboard READ, etc.) and allow the rest. An allowlist was too strict —
  // Cloudflare Turnstile / hCaptcha rely on the Storage Access API (`storage-access`),
  // so denying everything-but-fullscreen broke CAPTCHA challenges.
  const DENIED = new Set([
    'media',                  // camera + microphone
    'geolocation',
    'notifications',
    'midi', 'midiSysex',
    'clipboard-read',         // page could exfiltrate the clipboard
    'hid', 'serial', 'usb', 'bluetooth',
    'speaker-selection',
    'persistent-storage',
    'openExternal',
    'window-management',
  ])
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(!DENIED.has(permission))
  })
  sess.setPermissionCheckHandler((_wc, permission) => {
    return !DENIED.has(permission)
  })

  // Spoof a stock Chrome UA so sites don't gate on the Electron token.
  // NOTE: session.setUserAgent() only rewrites the network UA header — it does NOT
  // change the renderer's `navigator.userAgent`, which keeps reporting "Electron/x".
  // Cloudflare Turnstile reads navigator.userAgent client-side → bot → fail. The JS
  // value is only fixed by webContents.setUserAgent() per guest (see web-contents-created).
  const ua = sess.getUserAgent().replace(/\sElectron\/[\d.]+/, '').replace(/\sfterm\/[\d.]+/i, '')
  cleanUA = ua
  sess.setUserAgent(ua)
}

// The Electron-stripped UA, applied per-webContents so navigator.userAgent matches.
//
// IMPORTANT — why there is NO sec-ch-ua rewrite or navigator.* "stealth" patching:
// Verified empirically (Electron 41) that native Electron already looks like a stock
// Chromium browser to bot checks — `navigator.webdriver` is false, `window.chrome`
// exists with `runtime` undefined (exactly like real Chrome on a normal page), and
// `navigator.userAgentData.brands` is [Chromium, Not-A.Brand] with NO "Electron" leak,
// internally consistent with the sec-ch-ua headers. The ONE thing that betrays Electron
// is the `Electron/x` token in the UA *string*. So we ONLY strip that. Earlier attempts
// to override userAgentData / mask Function.prototype.toString / rewrite sec-ch-ua
// were COUNTERPRODUCTIVE: they introduced header↔JS mismatches and left detectable
// non-native getters that Cloudflare's interactive challenge flags as tampering — and
// the global toString mask also broke YouTube's player scripts. The Turnstile demo
// passes with the UA strip alone. (Cloudflare passing test confirmed offscreen.)
let cleanUA = ''

// When true, the next downloads prompt the user for a save location (native dialog).
let askWhereToSave = false
export function setAskWhereToSave(v: boolean): boolean { askWhereToSave = v; return askWhereToSave }
export function getAskWhereToSave(): boolean { return askWhereToSave }

/** Save downloads (auto to Downloads, or via dialog) and stream progress to the renderer. */
function setupDownloads(sess: Session) {
  sess.on('will-download', (_e, item) => {
    const id = ++dlCounter
    const filename = sanitizeFilename(item.getFilename())
    if (askWhereToSave) {
      // Leaving the save path unset makes Electron show the native "Save As" dialog.
      item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), filename) })
    } else {
      item.setSavePath(uniquePath(filename))   // frictionless, app-controlled path
    }
    downloads.set(id, item)

    const emit = (state: string) => broadcast('browser:download', {
      id,
      filename: basename(item.getSavePath() || filename),
      savePath: item.getSavePath() || '',
      mimeType: item.getMimeType(),
      state,
      received: item.getReceivedBytes(),
      total: item.getTotalBytes(),
      paused: item.isPaused(),
    })

    emit('started')
    item.on('updated', (_ev, state) => emit(state === 'interrupted' ? 'interrupted' : 'progressing'))
    item.once('done', (_ev, state) => {
      emit(state) // 'completed' | 'cancelled' | 'interrupted'
      if (state === 'completed' && item.getSavePath()) {
        savedPaths.add(resolve(item.getSavePath()))
        if (savedPaths.size > 200) {
          const oldest = savedPaths.values().next().value
          if (oldest) savedPaths.delete(oldest)
        }
      }
      downloads.delete(id)
    })
  })
}

/**
 * Frame preload that neutralizes YouTube ads. Ghostery's NETWORK blocking can't —
 * YT serves ads from the same `googlevideo.com` host as the real video. uBlock kills
 * them by rewriting the innertube player response in-page; we do the same.
 *
 * This file is registered as a `type: 'frame'` preload (runs in the isolated world
 * before page scripts). It injects a <script> into the MAIN world so it can hook the
 * page's own `JSON.parse` / `Response.json` (an isolated-world hook wouldn't see them).
 */
// The in-page program (runs in the MAIN world). Hooks the innertube player
// response to strip in-video ads + injects a cosmetic stylesheet for banners.
// Reused by BOTH the early frame preload AND a main-process executeJavaScript
// fallback, guarded by `window.__ftermYT` so it only runs once per document.
const YT_PROGRAM = `(function () {
  try {
    if (!/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname)) return;
    if (window.__ftermYT) return; window.__ftermYT = 1;
    var scrub = function (o) {
      if (!o || typeof o !== 'object') return o;
      try {
        if ('adPlacements' in o) o.adPlacements = [];
        if ('adSlots' in o) o.adSlots = [];
        if ('playerAds' in o) o.playerAds = [];
        if ('adBreakHeartbeatParams' in o) delete o.adBreakHeartbeatParams;
        if (o.playerResponse) scrub(o.playerResponse);
        if (o.playerResponseBackup) scrub(o.playerResponseBackup);
      } catch (e) {}
      return o;
    };
    try { var oParse = JSON.parse; JSON.parse = function () { return scrub(oParse.apply(this, arguments)); }; } catch (e) {}
    try { var oJson = Response.prototype.json; Response.prototype.json = function () { return oJson.apply(this, arguments).then(scrub); }; } catch (e) {}
    ['ytInitialPlayerResponse', 'ytInitialData'].forEach(function (key) {
      try {
        var existing = window[key];
        var v = existing ? scrub(existing) : existing;
        Object.defineProperty(window, key, {
          configurable: true,
          get: function () { return v; },
          set: function (nv) { v = scrub(nv); },
        });
      } catch (e) {}
    });
    setInterval(function () {
      try {
        var vid = document.querySelector('video');
        if (vid && document.querySelector('.ad-showing, .ytp-ad-player-overlay')) {
          // GPU is disabled app-wide → software decode. Do NOT seek or change
          // playbackRate during ads; both crash the fragile sw decoder on long videos /
          // video changes. Just mute; the skip button below + DNR network blocking
          // remove the ad.
          try { vid.muted = true; } catch (e) {}
        }
        var skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
        if (skip) skip.click();
        document.querySelectorAll('.ytp-ad-overlay-close-button, .ytp-ad-overlay-slot').forEach(function (e) { e.remove(); });
      } catch (e) {}
    }, 300);
    var hide = [
      'ytd-display-ad-renderer','ytd-ad-slot-renderer','ytd-in-feed-ad-layout-renderer',
      'ytd-banner-promo-renderer','ytd-banner-promo-renderer-background','ytd-statement-banner-renderer',
      'ytd-promoted-sparkles-web-renderer','ytd-promoted-sparkles-text-search-renderer',
      'ytd-promoted-video-renderer','ytd-compact-promoted-video-renderer',
      'ytd-companion-slot-renderer','ytd-action-companion-ad-renderer','ytd-search-pyv-renderer',
      '#masthead-ad','#player-ads','.ytp-ad-module',
      'ytm-promoted-sparkles-web-renderer','ytm-companion-slot',
      'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
      'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    ];
    var st = document.createElement('style');
    st.textContent = hide.join(',') + '{display:none !important;}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}
})();`

// Isolated-world preload: inject YT_PROGRAM into the MAIN world via a <script> tag
// at document_start (earliest possible, so the JSON.parse hook is in place before
// the player response is parsed). CSP is stripped on YT so the inline script runs.
const YT_ADBLOCK_PRELOAD = `(function () {
  try {
    var s = document.createElement('script');
    s.textContent = ${JSON.stringify(YT_PROGRAM)};
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {}
})();`

let ytPreloadPath: string | null = null

/** Register the YouTube ad-block preload on a session (idempotent per process). */
function registerYtAdblock(sess: Session) {
  if (!ytPreloadPath) {
    ytPreloadPath = join(app.getPath('userData'), 'yt-adblock-preload.js')
    try { writeFileSync(ytPreloadPath, YT_ADBLOCK_PRELOAD, 'utf8') } catch { return }
  }
  try { sess.registerPreloadScript({ type: 'frame', filePath: ytPreloadPath }) }
  catch (e) { console.error('[browser] YT preload register failed:', e) }
}

/**
 * Strip CSP on YouTube responses so the ad-block preload's main-world <script>
 * injection isn't blocked by YT's `script-src` nonce policy. Scoped to YT hosts
 * to keep every other site's CSP intact.
 *
 * NOTE: Electron allows only ONE onHeadersReceived listener per session, and
 * Ghostery claims it while the shield is on. So `setAdblockEnabled()` re-asserts
 * this after toggling. Ghostery's actual ad blocking lives in `onBeforeRequest`
 * (a different event), so it keeps working regardless.
 */
function installCspStrip(sess: Session) {
  sess.webRequest.onHeadersReceived((details, callback) => {
    let host = ''
    try { host = new URL(details.url).hostname } catch { /* ignore */ }
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const headers = details.responseHeaders || {}
    for (const k of Object.keys(headers)) {
      const lk = k.toLowerCase()
      if (lk === 'content-security-policy' || lk === 'content-security-policy-report-only') delete headers[k]
    }
    callback({ responseHeaders: headers })
  })
}

let ubolLoaded = false

/** Resolve the read-only source uBOL directory (dev source tree or packaged resources). */
function ubolSourceDir(): string {
  // app.getAppPath() = project root in dev, app.asar in prod. The extension is
  // shipped as an extraResource (electron-builder → resources/ubol) in production
  // and lives under the source tree in dev.
  const candidates = [
    join(app.getAppPath(), 'electron', 'vendor', 'ubol'),
    join(process.resourcesPath || '', 'ubol'),
  ]
  return candidates.find(p => existsSync(join(p, 'manifest.json'))) || candidates[0]
}

// Shim injected into uBOL's ext-compat.js. Electron's Chromium extension host
// doesn't implement every chrome.* namespace uBOL touches (notably `permissions`
// and `commands`); accessing them throws and kills the service worker (Status 15),
// disabling all blocking. This applies AUTOMATICALLY on startup (see prepareUbol)
// so updating the vendored uBOL never needs a manual re-patch.
const UBOL_SHIM = `
/* FTERM-UBOL-SHIM */
;(() => {
  const noopEvent = { addListener() {}, removeListener() {}, hasListener() { return false } };
  const ensure = (name, impl) => { try { if (!webext[name]) webext[name] = impl; } catch (e) {} };
  ensure('permissions', { onRemoved: noopEvent, onAdded: noopEvent, contains: async () => true, request: async () => true, remove: async () => true, getAll: async () => ({ permissions: [], origins: [] }) });
  ensure('commands', { onCommand: noopEvent, getAll: async () => [] });
})();
`

const ubolLiveDir = () => join(app.getPath('userData'), 'ubol')

/** Read an extension's manifest version, or '' if unreadable. */
function manifestVersion(dir: string): string {
  try { return String(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version || '') } catch { return '' }
}

/** Compare dotted numeric versions (e.g. uBOL's `2026.529.1448`). >0 if a>b. */
function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** Inject the Electron compat shim into a uBOL ext-compat.js. Idempotent. */
function patchUbolShim(extCompatPath: string) {
  const code = readFileSync(extCompatPath, 'utf8')
  if (code.includes('FTERM-UBOL-SHIM')) return
  const patched = code.replace(
    /export const webext = self\.browser \|\| self\.chrome;/,
    m => m + '\n' + UBOL_SHIM,
  )
  writeFileSync(extCompatPath, patched, 'utf8')
}

/**
 * Ensure a writable, shimmed uBOL lives in userData. Copies from the vendored
 * source ONLY when the source is newer (or the live copy is missing/invalid) — so
 * a runtime auto-update (which writes a newer version into userData) is preserved
 * across restarts instead of being clobbered by the older bundled copy.
 */
function prepareUbol(): string {
  const src = ubolSourceDir()
  const dst = ubolLiveDir()
  try {
    const srcVer = manifestVersion(src)
    const dstVer = manifestVersion(dst)
    if (!dstVer || cmpVer(srcVer, dstVer) > 0) {
      try { rmSync(dst, { recursive: true, force: true }) } catch { /* ignore */ }
      cpSync(src, dst, { recursive: true })
    }
    patchUbolShim(join(dst, 'js', 'ext-compat.js'))
    return dst
  } catch (err) {
    console.error('[browser] uBOL prepare failed, loading source unpatched:', err)
    return src
  }
}

let ubolExtId: string | null = null
let ubolSession: Session | null = null

/** Load uBlock Origin Lite (MV3) into a session. Idempotent. */
async function loadUbol(sess: Session): Promise<void> {
  if (ubolLoaded) return
  const dir = prepareUbol()
  if (!existsSync(join(dir, 'manifest.json'))) {
    console.error('[browser] uBOL not found at', dir)
    return
  }
  try {
    // Electron 35+ exposes session.extensions; older builds use session.loadExtension.
    const api: any = (sess as any).extensions ?? sess
    const ext = await api.loadExtension(dir, { allowFileAccess: true })
    ubolExtId = ext?.id ?? null
    ubolSession = sess
    ubolLoaded = true
  } catch (err) {
    console.error('[browser] uBOL load failed:', err)
  }
}

/**
 * Check GitHub for a newer uBOL release; if found, download + unzip + shim into a
 * temp dir, atomically swap it into userData, and hot-reload the extension. Pinned
 * to the official uBlockOrigin/uBOL-home repo. Best-effort: any failure is logged
 * and ignored (browser keeps the current version).
 */
export interface UbolUpdateResult { updated: boolean; version: string; error?: string }

async function updateUbol(): Promise<UbolUpdateResult> {
  const cur = manifestVersion(ubolLiveDir())
  try {
    const rel: any = await fetch('https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FTerm' },
    }).then(r => (r.ok ? r.json() : null))
    if (!rel) return { updated: false, version: cur, error: 'github unreachable' }
    const tag = String(rel.tag_name || '').replace(/^v/, '')
    if (!tag || cmpVer(tag, cur) <= 0) return { updated: false, version: cur }  // already current
    const asset = (rel.assets || []).find((a: any) => /\.chromium\.zip$/.test(a.name))
    if (!asset?.browser_download_url) return { updated: false, version: cur, error: 'no asset' }

    const ab = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'FTerm' } }).then(r => r.arrayBuffer())
    const buf = Buffer.from(new Uint8Array(ab as ArrayBuffer))
    const tmp = join(app.getPath('temp'), 'fterm-ubol-' + Date.now())
    new AdmZip(buf).extractAllTo(tmp, true)
    const newVer = manifestVersion(tmp)
    if (!newVer || cmpVer(newVer, cur) <= 0) { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* */ } return { updated: false, version: cur, error: 'bad download' } }
    patchUbolShim(join(tmp, 'js', 'ext-compat.js'))

    const dst = ubolLiveDir()
    try { rmSync(dst, { recursive: true, force: true }) } catch { /* */ }
    cpSync(tmp, dst, { recursive: true })
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }

    // Hot-reload: swap the running extension. Takes full effect on next navigation.
    if (ubolSession) {
      try {
        const api: any = (ubolSession as any).extensions ?? ubolSession
        if (ubolExtId && api.removeExtension) api.removeExtension(ubolExtId)
        const ext = await api.loadExtension(dst, { allowFileAccess: true })
        ubolExtId = ext?.id ?? ubolExtId
      } catch { /* will load fresh on next restart */ }
    }
    console.log('[browser] uBOL updated:', cur || '(none)', '→', newVer)
    return { updated: true, version: newVer }
  } catch (err: any) {
    console.error('[browser] uBOL update check failed:', err)
    return { updated: false, version: cur, error: String(err?.message || err) }
  }
}

let ubolAutoUpdate = true

/** Renderer pushes the persisted preference; gates the scheduled checks. */
export function setUbolAutoUpdate(on: boolean): boolean { ubolAutoUpdate = on; return ubolAutoUpdate }

/** Current uBOL version + auto-update preference, for the Settings UI. */
export function getUbolInfo(): { version: string; autoUpdate: boolean } {
  return { version: manifestVersion(ubolLiveDir()), autoUpdate: ubolAutoUpdate }
}

/** Force an update check now (ignores the auto-update toggle). For the "Check now" button. */
export function checkUbolUpdateNow(): Promise<UbolUpdateResult> { return updateUbol() }

/** Kick off uBOL update checks: shortly after startup, then every 24h (when enabled). */
function scheduleUbolUpdates() {
  setTimeout(() => { if (ubolAutoUpdate) void updateUbol() }, 15_000)
  setInterval(() => { if (ubolAutoUpdate) void updateUbol() }, 24 * 60 * 60 * 1000)
}

/**
 * Initialize the ad/tracker blocker + download handling on the browser partition.
 * Idempotent. Uses Ghostery's prebuilt EasyList + EasyPrivacy filter set, cached to disk.
 */
export async function initBrowserSession(): Promise<void> {
  if (initialized) return
  initialized = true

  const sess = session.fromPartition(BROWSER_PARTITION)
  hardenSession(sess)
  setupDownloads(sess)

  // Harden the ephemeral partition too so "remember me OFF" gets the same
  // permission denials, UA spoof and download handling.
  const ephemeral = session.fromPartition(BROWSER_SESSION_PARTITION)
  hardenSession(ephemeral)
  setupDownloads(ephemeral)

  // YouTube ad neutralization runs independently of the network shield toggle —
  // it's in-page scriptlet surgery, not request blocking, so it just works.
  registerYtAdblock(sess)
  registerYtAdblock(ephemeral)
  installCspStrip(sess)
  installCspStrip(ephemeral)

  // Guaranteed fallback: inject YT_PROGRAM via executeJavaScript on the guest
  // webview. Runs privileged in the MAIN world (bypasses CSP) and does NOT depend
  // on the frame preload actually executing. The window.__ftermYT guard dedupes
  // against the preload. Re-injected on every navigation (SPA + full loads).
  app.on('web-contents-created', (_e, wc) => {
    try {
      if (wc.session !== sess && wc.session !== ephemeral) return
    } catch { return }
    // Strip Electron from the renderer-visible navigator.userAgent (session.setUserAgent
    // only touches network headers). Without this Turnstile sees "Electron" in JS and fails.
    if (cleanUA) { try { wc.setUserAgent(cleanUA) } catch { /* ignore */ } }
    const inject = () => { wc.executeJavaScript(YT_PROGRAM).catch(() => {}) }
    wc.on('dom-ready', inject)
    wc.on('did-navigate', inject)
    wc.on('did-navigate-in-page', inject)
    wc.on('did-frame-navigate', inject)
  })

  // Load uBlock Origin Lite (MV3, declarativeNetRequest) — the full filter-set ad
  // blocker. Vendored unpacked in the repo. MV3 DNR is supported by Electron's
  // Chromium; the legacy uBO (MV2 webRequestBlocking) is NOT, so uBOL is the one
  // that actually blocks. Persistent partition only — extensions don't load on
  // in-memory sessions.
  await loadUbol(sess)
  scheduleUbolUpdates()

  // Blocking is uBOL (native DNR) + the YouTube innertube scrub. A JS engine
  // (Ghostery ElectronBlocker) used to run here too, but its webRequest filter
  // corrupted the BROWSER process and segfaulted it after many requests
  // (minidumps: ptype=browser, ACCESS_VIOLATION at varying addresses), and it was
  // redundant with uBOL — so it is gone. Stats now come from the passive counter.
  installBlockCounter(sess)
  installBlockCounter(ephemeral)
}

/**
 * Trigger a download of an arbitrary URL (used by right-click "Download image/video").
 * `ephemeral` routes through the session-only partition so a download made in
 * "remember me OFF" mode doesn't set cookies in the persistent partition.
 */
export function downloadUrl(url: string, ephemeral = false) {
  try {
    const p = new URL(url)
    if (p.protocol !== 'http:' && p.protocol !== 'https:' && p.protocol !== 'data:' && p.protocol !== 'blob:') return
  } catch { return }
  const partition = ephemeral ? BROWSER_SESSION_PARTITION : BROWSER_PARTITION
  session.fromPartition(partition).downloadURL(url)
}

export function cancelDownload(id: number) {
  downloads.get(id)?.cancel()
}

/**
 * Guard for shell.openPath / showItemInFolder: only allow paths the user actually
 * downloaded — under the OS Downloads folder OR a path that a download item reported.
 * Stops an XSS'd renderer from opening/launching arbitrary files on disk.
 */
export function isAllowedDownloadPath(p: string): boolean {
  if (typeof p !== 'string' || !p) return false
  let target: string
  try { target = resolve(p) } catch { return false }
  // Inside the OS Downloads folder…
  const dir = resolve(app.getPath('downloads'))
  const rel = relative(dir, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return true
  // …or a path a completed download actually wrote (covers "ask where to save").
  return savedPaths.has(target)
}

export interface ClearDataOptions {
  /** Wipe disk/memory cache + HTTP auth cache. */
  cache?: boolean
  /** Wipe cookies AND site storage (localStorage, IndexedDB, service workers, …).
   *  Leaving this false preserves site logins and per-site settings (e.g. the
   *  DuckDuckGo configuration), which live in cookies/localStorage. */
  cookies?: boolean
}

/**
 * Selectively clear browsing data for BOTH browser partitions.
 * Defaults to wiping everything (back-compat) when no options are given.
 */
export async function clearBrowsingData(opts?: ClearDataOptions): Promise<void> {
  const o: ClearDataOptions = opts ?? { cache: true, cookies: true }
  const targets = [
    session.fromPartition(BROWSER_PARTITION),
    session.fromPartition(BROWSER_SESSION_PARTITION),
  ]
  for (const sess of targets) {
    if (o.cache) {
      await sess.clearCache()
      await sess.clearAuthCache()
    }
    if (o.cookies) {
      await sess.clearStorageData({
        storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'],
      })
    }
  }
}

let adblockEnabled = true

/**
 * Toggle ad/tracker blocking at runtime by loading / unloading the uBOL extension —
 * the only component that actually cancels requests. The YouTube scriptlet and the
 * CSP strip stay installed either way (in-page surgery, not network blocking).
 */
export async function setAdblockEnabled(on: boolean): Promise<boolean> {
  if (on === adblockEnabled) return adblockEnabled
  const sess = session.fromPartition(BROWSER_PARTITION)
  if (on) {
    await loadUbol(sess)
  } else if (ubolSession && ubolExtId) {
    try {
      const api: any = (ubolSession as any).extensions ?? ubolSession
      api.removeExtension?.(ubolExtId)
      ubolLoaded = false
    } catch (err) {
      console.error('[browser] uBOL unload failed:', err)
      return adblockEnabled
    }
  }
  adblockEnabled = on
  return adblockEnabled
}

export function getAdblockStats() {
  return { blocked: blockedCount, ready: ubolLoaded, enabled: adblockEnabled }
}
