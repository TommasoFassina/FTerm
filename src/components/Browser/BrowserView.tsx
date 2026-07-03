import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ArrowLeft, ArrowRight, RotateCw, X, Home, Shield, Search, Loader2, Lock, ExternalLink,
  Download, Image as ImageIcon, Film, Link2, FolderOpen, Check, AlertCircle,
  MoreVertical, Trash2, History, Star, X as XIcon,
} from 'lucide-react'
import { useActiveTheme, useStore } from '@/store'
import type { BrowserDownload } from '@/types/global'

/** Minimal structural type for the Electron <webview> element methods we use. */
interface WebviewEl extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  openDevTools(): void
  isDevToolsOpened(): boolean
  closeDevTools(): void
}

interface MenuItem { icon: 'image' | 'film' | 'download' | 'link' | 'external'; label: string; run: () => void }

const HOME_URL = 'https://duckduckgo.com'

function formatBytes(n: number): string {
  if (!n || n < 0) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

/** Turn raw address-bar text into a navigable URL (search if it isn't one). */
function normalizeInput(raw: string): string {
  const s = raw.trim()
  if (!s) return HOME_URL
  if (/^https?:\/\//i.test(s)) return s
  if (/^about:/i.test(s)) return s
  // looks like a domain (has a dot, no spaces) → assume https
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s)
}

interface Props {
  initialUrl?: string
  /** When set, renders a close button (widget/overlay mode) */
  onClose?: () => void
  onTitleChange?: (title: string) => void
  onUrlChange?: (url: string) => void
}

export default function BrowserView({ initialUrl, onClose, onTitleChange, onUrlChange }: Props) {
  const theme = useActiveTheme()
  const bookmarks = useStore(s => s.bookmarks)
  const addBookmark = useStore(s => s.addBookmark)
  const removeBookmark = useStore(s => s.removeBookmark)
  const browserHistory = useStore(s => s.browserHistory)
  const addHistory = useStore(s => s.addHistory)
  const clearHistory = useStore(s => s.clearHistory)
  const wvRef = useRef<WebviewEl | null>(null)
  // Freeze the webview's src to the first URL — later browserUrl updates (from our
  // own navigation tracking) must NOT rewrite the attribute and reload the page.
  const [srcUrl, setSrcUrl] = useState(initialUrl || HOME_URL)
  const [address, setAddress] = useState(initialUrl || HOME_URL)
  const [currentUrl, setCurrentUrl] = useState(initialUrl || HOME_URL)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [blocked, setBlocked] = useState(0)
  const [adblockOn, setAdblockOn] = useState(true)
  const [editing, setEditing] = useState(false)
  const [downloads, setDownloads] = useState<BrowserDownload[]>([])
  const [showDl, setShowDl] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [pageTitle, setPageTitle] = useState('')
  const [askSave, setAskSave] = useState(false)
  // "Remember me": persist cookies/logins (default) vs session-only partition.
  const [rememberMe, setRememberMe] = useState(true)
  const [showClear, setShowClear] = useState(false)
  const [clearOpts, setClearOpts] = useState({ cache: true, cookies: false, history: true })
  const [showHistory, setShowHistory] = useState(false)
  const [histQuery, setHistQuery] = useState('')
  const isBookmarked = bookmarks.some(b => b.url === currentUrl)

  useEffect(() => { window.fterm.browserDownloadModeGet().then(setAskSave).catch(() => {}) }, [])

  // Live adblock counter pushed from main
  useEffect(() => {
    window.fterm.browserAdblockStats().then(s => { setBlocked(s.blocked); setAdblockOn(s.enabled) }).catch(() => {})
    return window.fterm.onAdblockStats(s => setBlocked(s.blocked))
  }, [])

  // Download progress pushed from main → upsert by id, auto-open the tray
  useEffect(() => {
    return window.fterm.onBrowserDownload(d => {
      setDownloads(prev => {
        const i = prev.findIndex(x => x.id === d.id)
        if (i === -1) return [d, ...prev].slice(0, 12)
        const next = [...prev]; next[i] = d; return next
      })
      if (d.state === 'started') setShowDl(true)
    })
  }, [])

  // Partition for the webview. Switching it forces a remount (via `key`).
  const partition = rememberMe ? 'persist:fterm-browser' : 'fterm-browser-session'

  const activeDl = downloads.some(d => d.state === 'progressing' || d.state === 'started')

  // Wire webview lifecycle events
  useEffect(() => {
    const wv = wvRef.current
    if (!wv) return
    const syncNav = () => {
      try {
        setCanBack(wv.canGoBack())
        setCanFwd(wv.canGoForward())
        const u = wv.getURL()
        if (u) {
          setCurrentUrl(u); if (!editing) setAddress(u); onUrlChange?.(u)
          try { addHistory(wv.getTitle() || '', u) } catch { /* ignore */ }
        }
      } catch { /* not attached yet */ }
    }
    const onStart = () => setLoading(true)
    const onStop = () => { setLoading(false); syncNav() }
    const onNav = () => syncNav()
    const onTitle = (e: any) => { setPageTitle(e?.title || ''); onTitleChange?.(e?.title || '') }
    const onCtx = (e: any) => {
      const p = e.params || {}
      const items: MenuItem[] = []
      // Route downloads through whichever partition the page is using so a
      // session-only ("remember me OFF") download doesn't touch persistent cookies.
      const eph = partition === 'fterm-browser-session'
      if (p.mediaType === 'image' && p.srcURL) {
        items.push({ icon: 'image', label: 'Download image', run: () => window.fterm.browserDownloadUrl(p.srcURL, eph) })
      }
      if (p.mediaType === 'video' && p.srcURL) {
        items.push({ icon: 'film', label: 'Download video', run: () => window.fterm.browserDownloadUrl(p.srcURL, eph) })
      }
      if (p.mediaType === 'audio' && p.srcURL) {
        items.push({ icon: 'film', label: 'Download audio', run: () => window.fterm.browserDownloadUrl(p.srcURL, eph) })
      }
      if (p.linkURL) {
        items.push({ icon: 'download', label: 'Download linked file', run: () => window.fterm.browserDownloadUrl(p.linkURL, eph) })
        items.push({ icon: 'link', label: 'Copy link', run: () => navigator.clipboard?.writeText(p.linkURL) })
        items.push({ icon: 'external', label: 'Open link in system browser', run: () => window.fterm.openExternal(p.linkURL) })
      }
      if (!items.length) return
      setMenu({ x: p.x ?? 0, y: (p.y ?? 0) + 44, items }) // +44 ≈ toolbar height offset
    }

    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav as any)
    wv.addEventListener('did-navigate-in-page', onNav as any)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('context-menu', onCtx as any)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav as any)
      wv.removeEventListener('did-navigate-in-page', onNav as any)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('context-menu', onCtx as any)
    }
  }, [editing, onTitleChange, onUrlChange, addHistory, partition])

  // F12 → toggle DevTools on the guest page (inspect console/network — e.g. to read
  // a Cloudflare Turnstile error code on a failing challenge).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F12') return
      const wv = wvRef.current
      if (!wv) return
      e.preventDefault()
      try { if (wv.isDevToolsOpened()) wv.closeDevTools(); else wv.openDevTools() } catch { /* not attached */ }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = useCallback((raw: string) => {
    const url = normalizeInput(raw)
    setAddress(url)
    setEditing(false)
    wvRef.current?.loadURL(url).catch(() => {})
  }, [])

  const clearData = useCallback(async () => {
    const { cache, cookies, history } = clearOpts
    if (cache || cookies) {
      await window.fterm.browserClearData({ cache, cookies }).catch(() => {})
    }
    if (history) clearHistory()
    setShowClear(false)
    setMoreOpen(false)
    setCleared(true)
    setTimeout(() => setCleared(false), 2000)
    if (cookies) wvRef.current?.reload()  // only a cookie/storage wipe changes the page
  }, [clearOpts, clearHistory])

  // Partition for the webview. Switching it forces a remount (via `key`), so we
  // re-navigate to wherever we currently are.
  // Flip persist ⇄ session. Pin src to the current page so the remount lands there.
  const toggleRemember = useCallback(() => {
    setSrcUrl(currentUrl || HOME_URL)
    setRememberMe(v => !v)
    setMoreOpen(false)
  }, [currentUrl])

  const isHttps = currentUrl.startsWith('https://')
  const accent = theme.blue || '#58a6ff'

  const btn = 'p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-default'

  return (
    <div className="flex flex-col w-full h-full" style={{ background: 'rgba(13,17,23,0.98)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(22,27,34,0.95)' }}
      >
        <button className={btn} style={{ color: '#8b949e' }} disabled={!canBack}
          onClick={() => wvRef.current?.goBack()} title="Back">
          <ArrowLeft size={16} />
        </button>
        <button className={btn} style={{ color: '#8b949e' }} disabled={!canFwd}
          onClick={() => wvRef.current?.goForward()} title="Forward">
          <ArrowRight size={16} />
        </button>
        <button className={btn} style={{ color: '#8b949e' }}
          onClick={() => loading ? wvRef.current?.stop() : wvRef.current?.reload()}
          title={loading ? 'Stop' : 'Reload'}>
          {loading ? <X size={16} /> : <RotateCw size={16} />}
        </button>
        <button className={btn} style={{ color: '#8b949e' }}
          onClick={() => navigate(HOME_URL)} title="Home">
          <Home size={16} />
        </button>

        {/* Address bar */}
        <div className="flex-1 flex items-center gap-2 mx-1 px-2.5 py-1 rounded-lg"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {loading
            ? <Loader2 size={13} className="animate-spin" style={{ color: accent }} />
            : isHttps
              ? <Lock size={13} style={{ color: '#3fb950' }} />
              : <Search size={13} style={{ color: '#8b949e' }} />}
          <input
            value={address}
            spellCheck={false}
            onChange={e => setAddress(e.target.value)}
            onFocus={e => { setEditing(true); e.target.select() }}
            onBlur={() => setEditing(false)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); navigate(address); (e.target as HTMLInputElement).blur() }
              if (e.key === 'Escape') { setAddress(currentUrl); (e.target as HTMLInputElement).blur() }
            }}
            className="flex-1 bg-transparent outline-none text-xs font-mono"
            style={{ color: '#e6edf3' }}
            placeholder="Search or enter address"
          />
        </div>

        {/* Bookmark current page */}
        <button className={btn} style={{ color: isBookmarked ? '#e3b341' : '#8b949e' }}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          onClick={() => isBookmarked ? removeBookmark(currentUrl) : addBookmark(pageTitle || currentUrl, currentUrl)}>
          <Star size={15} fill={isBookmarked ? '#e3b341' : 'none'} />
        </button>

        {/* Adblock toggle */}
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-md select-none transition-colors"
          title={adblockOn ? `Ad blocker ON — ${blocked} blocked (click to disable)` : 'Ad blocker OFF (click to enable)'}
          style={{ background: adblockOn ? 'rgba(63,185,80,0.12)' : 'rgba(139,148,158,0.12)' }}
          onClick={async () => {
            const next = await window.fterm.browserAdblockToggle(!adblockOn)
            setAdblockOn(next)
            wvRef.current?.reload()
          }}
        >
          <Shield size={13} style={{ color: adblockOn ? '#3fb950' : '#8b949e' }} />
          <span className="text-[11px] font-mono tabular-nums" style={{ color: adblockOn ? '#3fb950' : '#8b949e' }}>
            {adblockOn ? blocked : 'off'}
          </span>
        </button>

        {/* Downloads */}
        <button className={`${btn} relative`} style={{ color: showDl ? accent : '#8b949e' }}
          onClick={() => setShowDl(v => !v)} title="Downloads">
          <Download size={16} className={activeDl ? 'animate-bounce' : ''} />
          {downloads.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-mono flex items-center justify-center"
              style={{ background: accent, color: '#0d1117' }}>{downloads.length}</span>
          )}
        </button>

        <button className={btn} style={{ color: '#8b949e' }}
          onClick={() => window.fterm.openExternal(currentUrl)} title="Open in system browser">
          <ExternalLink size={15} />
        </button>

        {/* Overflow menu */}
        <div className="relative">
          <button className={btn} style={{ color: moreOpen ? accent : '#8b949e' }}
            onClick={() => setMoreOpen(v => !v)} title="More">
            <MoreVertical size={16} />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 mt-1 min-w-[200px] rounded-lg overflow-hidden shadow-2xl py-1 z-50"
                style={{ background: 'rgba(28,33,40,0.99)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10"
                  style={{ color: '#e6edf3' }} onClick={() => { setShowHistory(true); setMoreOpen(false) }}>
                  <History size={14} style={{ color: '#f0883e' }} /> History ({browserHistory.length})
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10"
                  style={{ color: '#e6edf3' }} onClick={() => { setShowClear(true); setMoreOpen(false) }}>
                  <Trash2 size={14} style={{ color: '#f0883e' }} /> Clear browsing data…
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10"
                  style={{ color: '#e6edf3' }} onClick={toggleRemember}>
                  <Lock size={14} style={{ color: rememberMe ? accent : '#8b949e' }} />
                  {rememberMe ? 'Remember me ✓ (stay logged in)' : 'Remember me ✗ (session-only)'}
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10"
                  style={{ color: '#e6edf3' }} onClick={() => { setShowDl(true); setMoreOpen(false) }}>
                  <Download size={14} style={{ color: accent }} /> Download manager
                </button>
                <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10"
                  style={{ color: '#e6edf3' }}
                  onClick={async () => { const v = await window.fterm.browserDownloadModeSet(!askSave); setAskSave(v); setMoreOpen(false) }}>
                  <FolderOpen size={14} style={{ color: askSave ? accent : '#8b949e' }} />
                  {askSave ? 'Downloads: ask each time ✓' : 'Downloads: auto → Downloads folder'}
                </button>
              </div>
            </>
          )}
        </div>

        {onClose && (
          <button className={btn} style={{ color: '#8b949e' }} onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Bookmarks bar */}
      {bookmarks.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 shrink-0 overflow-x-auto no-scrollbar"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(22,27,34,0.6)' }}>
          {bookmarks.map(b => (
            <div key={b.id} className="group flex items-center shrink-0 rounded hover:bg-white/10">
              <button onClick={() => navigate(b.url)}
                className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 text-[11px] max-w-[160px]"
                style={{ color: '#c9d1d9' }} title={b.url}>
                <Star size={10} fill="#e3b341" style={{ color: '#e3b341' }} />
                <span className="truncate">{b.title}</span>
              </button>
              <button onClick={() => removeBookmark(b.url)}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 pr-1.5 pl-0.5" style={{ color: '#8b949e' }} title="Remove">
                <XIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Webview */}
      <div className="flex-1 relative overflow-hidden" style={{ background: '#fff' }}>
        <webview
          key={partition}
          ref={wvRef as any}
          src={srcUrl}
          partition={partition}
          // no allowpopups — pop-ups are routed to the system browser in main
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#fff', display: 'flex' }}
        />

        {/* Cleared toast */}
        {cleared && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'rgba(22,27,34,0.98)', border: '1px solid rgba(63,185,80,0.4)', color: '#3fb950' }}>
            <Check size={14} /> Browsing data cleared
          </div>
        )}

        {/* Clear-data dialog (granular) */}
        {showClear && (
          <>
            <div className="absolute inset-0 z-30" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowClear(false)} />
            <div className="absolute left-1/2 top-12 -translate-x-1/2 z-40 w-80 rounded-lg overflow-hidden shadow-2xl"
              style={{ background: 'rgba(22,27,34,0.99)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div className="px-3 py-2 text-xs font-semibold" style={{ color: '#e6edf3', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                Clear browsing data
              </div>
              <div className="p-3 space-y-2">
                {([
                  ['cache', 'Cache', 'Cached files and images'],
                  ['cookies', 'Cookies & site data', 'Logs you out; clears DuckDuckGo settings'],
                  ['history', 'History', `${browserHistory.length} entries (this session)`],
                ] as const).map(([key, label, hint]) => (
                  <label key={key} className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 accent-current" style={{ accentColor: accent }}
                      checked={clearOpts[key]}
                      onChange={e => setClearOpts(o => ({ ...o, [key]: e.target.checked }))} />
                    <span>
                      <span className="text-xs block" style={{ color: '#e6edf3' }}>{label}</span>
                      <span className="text-[10px] block" style={{ color: '#8b949e' }}>{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 px-3 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button className="px-3 py-1 text-xs rounded hover:bg-white/10" style={{ color: '#8b949e' }}
                  onClick={() => setShowClear(false)}>Cancel</button>
                <button className="px-3 py-1 text-xs rounded font-semibold"
                  style={{ background: accent, color: '#0d1117' }} onClick={clearData}>Clear</button>
              </div>
            </div>
          </>
        )}

        {/* History panel */}
        {showHistory && (
          <>
            <div className="absolute inset-0 z-30" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowHistory(false)} />
            <div className="absolute left-1/2 top-8 -translate-x-1/2 z-40 w-[28rem] max-h-[80%] flex flex-col rounded-lg overflow-hidden shadow-2xl"
              style={{ background: 'rgba(22,27,34,0.99)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>History · session-only</span>
                <div className="flex items-center gap-1">
                  <button title="Clear history" onClick={() => clearHistory()}
                    className="p-0.5 rounded hover:bg-white/10" style={{ color: '#8b949e' }}><Trash2 size={13} /></button>
                  <button onClick={() => setShowHistory(false)} className="p-0.5 rounded hover:bg-white/10" style={{ color: '#8b949e' }}><X size={14} /></button>
                </div>
              </div>
              <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <input value={histQuery} onChange={e => setHistQuery(e.target.value)} placeholder="Search history…"
                  className="w-full px-2 py-1 text-xs rounded outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#e6edf3' }} />
              </div>
              <div className="overflow-y-auto">
                {browserHistory.filter(h => {
                  const q = histQuery.toLowerCase()
                  return !q || h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
                }).map(h => (
                  <button key={h.id} onClick={() => { navigate(h.url); setShowHistory(false) }}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/10" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-xs block truncate" style={{ color: '#e6edf3' }}>{h.title || h.url}</span>
                    <span className="text-[10px] block truncate" style={{ color: '#8b949e' }}>{h.url}</span>
                  </button>
                ))}
                {browserHistory.length === 0 && (
                  <div className="px-3 py-6 text-xs text-center" style={{ color: '#8b949e' }}>No history this session.</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Downloads tray */}
        {showDl && (
          <div className="absolute top-2 right-2 w-80 rounded-lg overflow-hidden shadow-2xl z-20"
            style={{ background: 'rgba(22,27,34,0.98)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>Downloads</span>
              <div className="flex items-center gap-1">
                <button title="Clear finished"
                  onClick={() => setDownloads(prev => prev.filter(d => d.state === 'progressing' || d.state === 'started'))}
                  className="p-0.5 rounded hover:bg-white/10" style={{ color: '#8b949e' }}>
                  <Trash2 size={13} />
                </button>
                <button onClick={() => setShowDl(false)} className="p-0.5 rounded hover:bg-white/10" style={{ color: '#8b949e' }}>
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {downloads.length === 0 && (
                <div className="px-3 py-4 text-xs text-center" style={{ color: '#8b949e' }}>
                  No downloads yet. Right-click an image or video to save it.
                </div>
              )}
              {downloads.map(d => {
                const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0
                const done = d.state === 'completed'
                const failed = d.state === 'interrupted' || d.state === 'cancelled'
                return (
                  <div key={d.id} className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center gap-2">
                      {done ? <Check size={13} style={{ color: '#3fb950' }} />
                        : failed ? <AlertCircle size={13} style={{ color: '#f85149' }} />
                          : <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
                      <span className="flex-1 text-xs font-mono truncate" style={{ color: '#e6edf3' }} title={d.filename}>{d.filename}</span>
                    </div>
                    {!done && !failed && (
                      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between text-[10px] font-mono" style={{ color: '#8b949e' }}>
                      <span>
                        {done ? formatBytes(d.received)
                          : failed ? (d.state === 'cancelled' ? 'Cancelled' : 'Failed')
                            : `${formatBytes(d.received)} / ${formatBytes(d.total)} · ${pct}%`}
                      </span>
                      <span className="flex items-center gap-2">
                        {done && (
                          <>
                            <button className="hover:text-white" onClick={() => window.fterm.browserDownloadOpen(d.savePath)}>Open</button>
                            <button className="hover:text-white flex items-center gap-0.5" onClick={() => window.fterm.browserDownloadShow(d.savePath)}>
                              <FolderOpen size={11} /> Folder
                            </button>
                          </>
                        )}
                        {!done && !failed && (
                          <button className="hover:text-white" onClick={() => window.fterm.browserDownloadCancel(d.id)}>Cancel</button>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Right-click media menu */}
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
            <div className="absolute z-40 min-w-[200px] rounded-lg overflow-hidden shadow-2xl py-1"
              style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y, background: 'rgba(28,33,40,0.99)', border: '1px solid rgba(255,255,255,0.12)' }}>
              {menu.items.map((it, i) => (
                <button key={i}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10"
                  style={{ color: '#e6edf3' }}
                  onClick={() => { it.run(); setMenu(null); setShowDl(true) }}>
                  {it.icon === 'image' && <ImageIcon size={14} style={{ color: accent }} />}
                  {it.icon === 'film' && <Film size={14} style={{ color: accent }} />}
                  {it.icon === 'download' && <Download size={14} style={{ color: accent }} />}
                  {it.icon === 'link' && <Link2 size={14} style={{ color: '#8b949e' }} />}
                  {it.icon === 'external' && <ExternalLink size={14} style={{ color: '#8b949e' }} />}
                  {it.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
