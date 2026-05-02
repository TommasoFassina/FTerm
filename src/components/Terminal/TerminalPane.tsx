import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useStore, useActiveTheme, getOrderedPaneIds } from '@/store'
import { useAI } from '@/hooks/useAI'
import { isErrorOutput, analyzeOutput } from '@/utils/petReactions'
import ContextMenu from '@/components/ContextMenu/ContextMenu'
import { pluginManager } from '@/plugins'
import { AnimatePresence } from 'motion/react'
import FileExplorerWidget from '@/components/Widgets/FileExplorerWidget'
import RecordingControls from './RecordingControls'
import SystemMonitorWidget from '@/components/Widgets/SystemMonitorWidget'
import DockerWidget from '@/components/Widgets/DockerWidget'
import WeatherWidget from '@/components/Widgets/WeatherWidget'
import PingWidget from '@/components/Widgets/PingWidget'
import DataTableWidget from '@/components/Widgets/DataTableWidget'
import PortScanWidget from '@/components/Widgets/PortScanWidget'
import SnippetsWidget from '@/components/Widgets/SnippetsWidget'
import FtermfetchWidget from '@/components/Widgets/FtermfetchWidget'
import HistorySearch from './HistorySearch'
import { searchAddons, terminalInstances } from './terminalRegistry'

interface Props {
  tabId: string
  paneId: string
  active: boolean
  profileId?: string
}

export default function TerminalPane({ tabId, paneId, active, profileId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRootRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const canvasRef = useRef<CanvasAddon | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [activeWidget, setActiveWidget] = useState<{ type: string; data?: any } | null>(null)
  const [showHistorySearch, setShowHistorySearch] = useState(false)
  const [scrollInfo, setScrollInfo] = useState({ viewportY: 0, baseY: 0, rows: 0 })
  const errorMarkersRef = useRef<Array<{ id: number; line: number; getContext: () => string }>>([])
  const [errorVer, setErrorVer] = useState(0)
  const scrollbarDragRef = useRef<{ startY: number; startViewportY: number } | null>(null)
  const closeWidget = useCallback(() => {
    setActiveWidget(null)
    setTimeout(() => termRef.current?.focus(), 50)
  }, [])

  const currentInputRef = useRef<string>('')
  const autocompleteRef = useRef<any>(null)
  const acUiRef = useRef<HTMLDivElement>(null)
  const selectionAnchorRef = useRef<{ col: number; row: number } | null>(null)
  const selectionCursorRef = useRef<{ col: number; row: number } | null>(null)

  const theme = useActiveTheme()
  const { sendMessage } = useAI()
  const settings = useStore(s => s.settings)
  const profiles = useStore(s => s.profiles)
  const commandHistory = useStore(s => s.commandHistory)
  const setTabPid = useStore(s => s.setTabPid)
  const setActivePane = useStore(s => s.setActivePane)
  const setAIConfig = useStore(s => s.setAIConfig)
  const setTabBell = useStore(s => s.setTabBell)
  const updateTabCwd = useStore(s => s.updateTabCwd)
  const recordTerminalError = useStore(s => s.recordTerminalError)
  const currentProfile = profiles.find(p => p.id === profileId)
  const instanceId = `${tabId}-${paneId}`

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  useLayoutEffect(() => {
    if (!containerRef.current || termRef.current) return

    let inAltScreen = false;
    const isTUI = () => inAltScreen || termRef.current?.buffer.active.type === 'alternate';

    const term = new Terminal({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      lineHeight: settings.lineHeight,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      allowTransparency: true,
      allowProposedApi: true,
      // ConPTY hint: fixes line-rewrap and cursor-position glitches in TUI apps
      // (claude code, vim, etc.) on Windows. backend=conpty for Win10+, frontend=v5.
      windowsPty: { backend: 'conpty', buildNumber: 19041 },
      theme: buildXtermTheme(theme),
    })
    ;(term.options as any).copyOnSelect = settings.copyOnSelect !== false

    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'

    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const search = new SearchAddon()
    term.loadAddon(search)

    searchAddons.set(instanceId, search)
    terminalInstances.set(instanceId, term)

    term.open(containerRef.current)

    // 1. Hide the browser's native scrollbar on the viewport
    const viewport = containerRef.current.querySelector('.xterm-viewport') as HTMLElement | null
    if (viewport) viewport.style.overflowY = 'hidden'

    // 2. Hide xterm's own DOM-based scrollbar widget (.xterm-scrollable-element > .scrollbar).
    //    xterm shows/hides it dynamically via class/style, so use MutationObserver to keep it gone.
    const hideXtermScrollbar = () => {
      const el = containerRef.current?.querySelector<HTMLElement>('.xterm-scrollable-element > .scrollbar')
      if (el && el.style.display !== 'none') el.style.display = 'none'
    }
    hideXtermScrollbar()
    const scrollbarObserver = new MutationObserver(hideXtermScrollbar)
    scrollbarObserver.observe(containerRef.current, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] })

    const container = containerRef.current
    const handleWheel = (e: WheelEvent) => {
      if (!termRef.current) return
      // In alt-screen TUI (claude code, less, htop): let xterm forward wheel as mouse
      // events so the app can scroll its own lists/panes.
      if (isTUI()) return
      e.preventDefault()
      e.stopPropagation()            // prevent xterm's own wheel handler
      const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? Math.round(e.deltaY)
        : Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 40))
      termRef.current.scrollLines(lines)
    }
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    // Apply font ligatures via CSS if enabled
    if (settings.ligatures !== false) {
      containerRef.current.style.fontFeatureSettings = '"liga" 1, "calt" 1'
    }

    // WebGL addon does not support transparent backgrounds.
    // When opacity < 1 (acrylic/blur visible), use Canvas renderer instead.
    const needsTransparency = (useStore.getState().settings.opacity ?? 0.85) < 1

    if (needsTransparency) {
      try {
        const ca = new CanvasAddon()
        canvasRef.current = ca
        term.loadAddon(ca)
      } catch (e) {
        console.warn('Canvas addon failed, using DOM renderer', e)
      }
    } else {
      let supportsWebGL = true;
      try {
        const canvas = document.createElement('canvas');
        if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
          supportsWebGL = false;
        }
      } catch {
        supportsWebGL = false;
      }

      if (supportsWebGL) {
        try {
          const gl = new WebglAddon()
          webglRef.current = gl
          term.loadAddon(gl)
        } catch (e) {
          console.warn('WebGL addon failed, falling back to Canvas', e)
          const ca = new CanvasAddon()
          canvasRef.current = ca
          term.loadAddon(ca)
        }
      } else {
        const ca = new CanvasAddon()
        canvasRef.current = ca
        term.loadAddon(ca)
      }
    }

    fit.fit()
    setScrollInfo({ viewportY: 0, baseY: 0, rows: term.rows })
    termRef.current = term

    pluginManager.registerTerminal(instanceId, term)
    // Notify plugins after first PTY data so banner renders below the shell's initial prompt
    const removeReadyNotify = window.fterm.onPtyData(instanceId, () => {
      removeReadyNotify()
      pluginManager.notifyTerminalReady(term, instanceId)
    })

    const onFocusHandler = () => { (window as any).__ftermActiveTerminal = term }
    const onBlurHandler = () => { if ((window as any).__ftermActiveTerminal === term) (window as any).__ftermActiveTerminal = null }
    term.textarea?.addEventListener('focus', onFocusHandler)
    term.textarea?.addEventListener('blur', onBlurHandler)

    if (active) {
      setTimeout(() => { term.focus(); (window as any).__ftermActiveTerminal = term }, 50)
    }

    // Resolve initial CWD: prefer persisted currentCwd (survives app restart)
    const currentTab = useStore.getState().tabs.find(t => t.id === tabId)
    const layoutNode = currentTab?.layout
    const initialCwd = currentTab?.currentCwd
      || layoutNode?.initialCwd
      || useStore.getState().profileCwds[profileId || 'default']
      || currentProfile?.cwd

    const initialCommand = layoutNode?.initialCommand

    // Set path synchronously before the async ptyCreate round-trip so it shows instantly
    updateTabCwd(tabId, paneId, initialCwd || window.fterm.homedir)

    const { cols, rows } = term
    let removePtyExit = () => { }
    window.fterm.ptyCreate(instanceId, cols, rows, currentProfile?.shell, currentProfile?.args, initialCwd, currentProfile?.env).then(({ pid, sessionId, history, cwd }) => {
      setTabPid(tabId, paneId, pid)
      // Always set cwd from the process — covers the default-profile case where initialCwd is unknown
      if (cwd) updateTabCwd(tabId, paneId, cwd)

      if (history) {
        term.write(history)
      }

      removePtyExit = window.fterm.onPtyExit(instanceId, sessionId, code => {
        term.write(`\r\n\x1b[31mProcess exited (${code}).\x1b[0m Press any key to restart.\r\n`)
      })
      if (initialCommand && !history) {
        const removeOnce = window.fterm.onPtyData(instanceId, () => {
          removeOnce()
          window.fterm.ptyWrite(instanceId, initialCommand + '\r')
        })
      }
    })

    let lastErrorMarkerLine = -1;
    // Rolling buffer for cross-chunk error detection (ConPTY may split text across events)
    let recentDataBuf = '';
    const RECENT_BUF_MAX = 512;

    const disposeAllDecorations = () => {
      errorMarkersRef.current = [];
      lastErrorMarkerLine = -1;
      recentDataBuf = '';
      setErrorVer(v => v + 1);
    };

    // Bell handler — set badge on tab
    term.onBell(() => setTabBell(tabId))

    // OSC 7: CWD notification from the shell prompt function
    const osc7Disposable = term.parser.registerOscHandler(7, (data) => {
      try {
        let cwd = data.replace(/^file:\/\/[^/]*/, '')
        cwd = decodeURIComponent(cwd)
        if (/^\/[A-Za-z]:[\\/]/.test(cwd)) cwd = cwd.slice(1)
        if (cwd) updateTabCwd(tabId, paneId, cwd)
      } catch { /* ignore malformed */ }
      return true
    })

    const removePtyData = window.fterm.onPtyData(instanceId, rawData => {
      // Detect cls / clear screen sequences (ED2: ESC[2J or ESC[3J) and dispose decorations
      if (/\x1b\[(?:2|3)J/.test(rawData)) {
        disposeAllDecorations();
      }

      // Track alt-screen (TUI apps: vim, claude code, less, htop). Ignore error/pet
      // detection while active — TUI text often contains the word "error" in normal UI,
      // and ConPTY redraws would otherwise spam markers and pet sad-state.
      if (/\x1b\[\?1049h|\x1b\[\?47h|\x1b\[\?1047h/.test(rawData)) {
        inAltScreen = true;
        disposeAllDecorations();
        autocompleteRef.current = null;
        updateAcUI(null);
        currentInputRef.current = '';
      }
      if (/\x1b\[\?1049l|\x1b\[\?47l|\x1b\[\?1047l/.test(rawData)) {
        inAltScreen = false;
        recentDataBuf = '';
        // ConPTY occasionally leaves residual TUI rows in the main buffer when an
        // alt-screen app (claude code, etc.) exits via Esc. Force a redraw + scroll
        // to bottom so the restored main buffer renders cleanly.
        setTimeout(() => {
          try {
            termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1)
            termRef.current?.scrollToBottom()
          } catch { /* terminal disposed */ }
        }, 32)
      }

      // Parse OSC 9998 first — clean prompt (exit=0) means stale error content should be discarded
      const osc9998 = rawData.match(/\x1b\]9998;(\d+)(?:\x07|\x1b\\)/)
      const exitCodeError = osc9998 ? parseInt(osc9998[1], 10) !== 0 : false
      // Always clear on any prompt signal — prevents stale error text re-triggering on Enter.
      // Current chunk is accumulated right after, so error+prompt in same chunk still detected.
      if (osc9998) recentDataBuf = '';

      // Accumulate AFTER clear so current chunk's content (including any error text) is testable
      recentDataBuf = (recentDataBuf + rawData).slice(-RECENT_BUF_MAX);
      // Strip VT/ANSI sequences before testing — ConPTY may inject escape codes mid-word
      const strippedBuf = recentDataBuf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '')

      // CMD (all locales): quoted command + "intern" (internal/interno/interne/intern)
      // PS (all locales): exception class names are always English; also match PS "not recognized" pattern
      const cmdNotFound = /["'][^"']{1,60}["'][^.\n]*intern/i.test(strippedBuf)
        || /CommandNotFoundException|NotFoundException|is not recognized.*cmdlet|riconosciuto.*cmdlet|non reconnu.*applet|nicht erkannt.*cmdlet/i.test(strippedBuf)
      const bufHasError = isErrorOutput(strippedBuf)


      term.write(rawData, () => {
        if (isTUI()) return;
        // exitCodeError: reliable for PS (LASTEXITCODE reset each prompt, so no stale re-trigger)
        // cmdNotFound: CMD locale-agnostic text match
        // bufHasError: text match only when no prompt in this chunk (avoids false-positives from success output containing "error")
        if (exitCodeError || cmdNotFound || (!osc9998 && bufHasError)) {
          recordTerminalError();
          const buffer = term.buffer.active;
          const currentLine = buffer.baseY + buffer.cursorY;
          if (lastErrorMarkerLine !== -1 && Math.abs(currentLine - lastErrorMarkerLine) < 4) {
            return;
          }

          const marker = term.registerMarker(-1);
          if (marker) {
            lastErrorMarkerLine = marker.line;
            const markerId = Date.now();
            const getContext = () => {
              const startY = Math.max(0, marker.line - 30);
              let ctx = '';
              for (let i = startY; i <= marker.line; i++) {
                const lineObj = buffer.getLine(i);
                if (lineObj) ctx += lineObj.translateToString(true) + '\n';
              }
              return ctx.trim();
            };
            errorMarkersRef.current.push({ id: markerId, line: marker.line, getContext });
            // Auto-expire after 5 min
            setTimeout(() => {
              errorMarkersRef.current = errorMarkersRef.current.filter(m => m.id !== markerId);
              setErrorVer(v => v + 1);
            }, 5 * 60 * 1000);
            setErrorVer(v => v + 1);
          }
        }
      });
      // Pet activity detection from terminal output — skip in TUI apps (claude code, vim, etc.)
      const stripped = rawData.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').replace(/\r/g, '').trim()
      if (!isTUI() && stripped.length > 3) {
        const reaction = analyzeOutput(stripped)
        if (reaction) {
          const curState = useStore.getState().petState
          if (reaction.state === 'idle') {
            // Only reset to idle from working/worried — don't interrupt happy/celebrating
            if (curState === 'working' || curState === 'worried') {
              useStore.getState().setPetState('idle')
            }
          } else {
            useStore.getState().setLastActivity(reaction.label)
            useStore.getState().setPetState(reaction.state)
            if (reaction.state === 'celebrating') useStore.getState().addPetXp(100)
            else if (reaction.state === 'happy') useStore.getState().addPetXp(50)
            if (reaction.duration > 0) {
              setTimeout(() => {
                if (useStore.getState().petState === reaction.state) {
                  useStore.getState().setPetState('idle')
                }
              }, reaction.duration)
            }
          }
        }
      }

      pluginManager.notifyPtyData(rawData)
    })

    const updateAcUI = (ac: any) => {
      const el = acUiRef.current;
      if (!el) return;
      if (!ac || !ac.active || !ac.suggestion) {
        el.style.display = 'none';
        return;
      }
      const suffix = ac.suggestion.startsWith(ac.query)
        ? ac.suggestion.slice(ac.query.length)
        : ac.suggestion;
      if (!suffix) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.left = `${ac.x}px`;
      el.style.top = `${ac.y}px`;
      el.style.fontFamily = settings.fontFamily || 'monospace';
      el.style.fontSize = `${settings.fontSize || 14}px`;
      el.style.lineHeight = `${settings.lineHeight || 1.2}`;
      el.style.color = '#8b949e';
      el.style.opacity = '0.55';
      el.style.pointerEvents = 'none';
      el.style.whiteSpace = 'pre';
      el.textContent = suffix;
    };

    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+L: force redraw + scroll-to-bottom — escape hatch for stuck
      // TUI ghosting (claude code etc. that left residual rows on Esc).
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault()
        try {
          term.refresh(0, term.rows - 1)
          term.scrollToBottom()
        } catch { /* ignore */ }
        return false
      }

      // TUI mode (Claude Code, vim, less): pass keys through to app.
      // Only intercept Ctrl+Shift+C/V (clipboard) — everything else is the app's.
      if (isTUI()) {
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
          e.preventDefault()
          const sel = term.getSelection()
          if (sel) navigator.clipboard.writeText(sel).catch(() => { })
          return false
        }
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
          e.preventDefault()
          navigator.clipboard.readText().then(text => {
            if (!text) return
            // Use bracketed paste if app enabled it (xterm tracks DECSET 2004)
            const bp = (term as any).modes?.bracketedPasteMode
            const payload = bp ? `\x1b[200~${text}\x1b[201~` : text
            window.fterm.ptyWrite(instanceId, payload)
          }).catch(() => { })
          return false
        }
        return true
      }

      // ── Shift+Arrow keyboard selection ───────────────────────────────────
      const isShiftArrow = e.shiftKey && (
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp'   || e.key === 'ArrowDown'
      )
      if (isShiftArrow) {
        if (e.type === 'keydown') {
          const buffer = term.buffer.active
          const cols = term.cols
          if (!selectionAnchorRef.current) {
            const absRow = buffer.viewportY + buffer.cursorY
            selectionAnchorRef.current = { col: buffer.cursorX, row: absRow }
            selectionCursorRef.current = { col: buffer.cursorX, row: absRow }
          }
          const cur = { ...selectionCursorRef.current! }
          const maxRow = buffer.viewportY + term.rows - 1

          if (e.key === 'ArrowLeft') {
            if (cur.col > 0) cur.col--
            else if (cur.row > 0) { cur.row--; cur.col = cols - 1 }
          } else if (e.key === 'ArrowRight') {
            cur.col++
            if (cur.col >= cols) { cur.col = 0; cur.row = Math.min(maxRow, cur.row + 1) }
          } else if (e.key === 'ArrowUp') {
            cur.row = Math.max(0, cur.row - 1)
          } else if (e.key === 'ArrowDown') {
            cur.row = Math.min(maxRow, cur.row + 1)
          }

          selectionCursorRef.current = cur
          const anchor = selectionAnchorRef.current!
          const anchorLinear = anchor.row * cols + anchor.col
          const curLinear   = cur.row   * cols + cur.col

          if (anchorLinear !== curLinear) {
            const start = Math.min(anchorLinear, curLinear)
            const end   = Math.max(anchorLinear, curLinear)
            term.select(start % cols, Math.floor(start / cols), end - start)
          } else {
            term.clearSelection()
          }
        }
        return false
      }

      // ── Clipboard shortcuts ──────────────────────────────────────────────
      // Ctrl+Shift+V (cross-platform terminal paste) and Ctrl+V (when no selection
      // active — preserves ^V literal when user has explicitly Shift-selected text)
      if (e.type === 'keydown' && e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        navigator.clipboard.readText().then(text => {
          if (text) window.fterm.ptyWrite(`${tabId}-${paneId}`, text)
        }).catch(() => { /* clipboard unavailable */ })
        return false
      }
      // Ctrl+Shift+C → copy selection (Ctrl+C alone must remain SIGINT)
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault()
        const sel = term.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => { })
        return false
      }
      // Ctrl+C with active selection → copy (Windows convention).
      // No selection → fall through so xterm sends SIGINT (^C) to PTY.
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection()
        if (sel) {
          e.preventDefault()
          navigator.clipboard.writeText(sel).catch(() => { })
          term.clearSelection()
          return false
        }
      }

      // Ctrl+Alt+Arrow — navigate between panes; must be handled here because xterm stops propagation
      if (e.type === 'keydown' && e.ctrlKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const { tabs: storeTabs, activeTabId: storeTabId, setActivePane: storeSetActivePane } = useStore.getState()
        const storeTab = storeTabs.find(t => t.id === storeTabId)
        if (storeTab?.layout && storeTab.activePaneId) {
          const ordered = getOrderedPaneIds(storeTab.layout)
          if (ordered.length >= 2) {
            const idx = ordered.indexOf(storeTab.activePaneId)
            if (idx >= 0) {
              const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1
              const nextPaneId = ordered[(idx + dir + ordered.length) % ordered.length]
              storeSetActivePane(storeTabId!, nextPaneId)
              terminalInstances.get(`${storeTabId}-${nextPaneId}`)?.focus()
            }
          }
        }
        return true
      }

      // Clear selection anchor on any non-shift key
      if (e.type === 'keydown' && !e.shiftKey && selectionAnchorRef.current) {
        selectionAnchorRef.current = null
        selectionCursorRef.current = null
      }

      const ac = autocompleteRef.current;


      if (e.type === 'keydown' && e.key === 'Enter') {
        const input = currentInputRef.current.trim();

        // ── Widget commands ──────────────────────────────────────
        const plugins = useStore.getState().plugins

        // explore [path]
        if (input === 'explore' || input.startsWith('explore ')) {
          const pluginEnabled = plugins.find(p => p.id === 'file-explorer')?.enabled ?? true
          if (!pluginEnabled) {
            term.writeln('\r\n\x1b[31mError: File Explorer plugin is disabled. Enable it in the Plugins menu.\x1b[0m')
            currentInputRef.current = ''
            return true
          }
          e.preventDefault()
          const argPath = input.replace(/^explore\s*/, '').trim()
          const path = argPath || useStore.getState().tabs.find(t => t.id === tabId)?.currentCwd || '.'
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({
            type: 'file-explorer',
            data: { path }
          })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // sys-mon
        if (input === 'sys-mon') {
          const pluginEnabled = plugins.find(p => p.id === 'sys-mon')?.enabled ?? true
          if (!pluginEnabled) {
            term.writeln('\r\n\x1b[31mError: System Monitor plugin is disabled. Enable it in the Plugins menu.\x1b[0m')
            currentInputRef.current = ''
            return true
          }
          e.preventDefault()
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({ type: 'sys-mon' })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // docker-dash
        if (input === 'docker-dash') {
          const pluginEnabled = plugins.find(p => p.id === 'docker')?.enabled ?? true
          if (!pluginEnabled) {
            term.writeln('\r\n\x1b[31mError: Docker plugin is disabled. Enable it in the Plugins menu.\x1b[0m')
            currentInputRef.current = ''
            return true
          }
          e.preventDefault()
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({ type: 'docker' })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // weather [city]
        if (input === 'weather' || input.startsWith('weather ')) {
          const pluginEnabled = plugins.find(p => p.id === 'weather')?.enabled ?? true
          if (!pluginEnabled) {
            term.writeln('\r\n\x1b[31mError: Weather plugin is disabled. Enable it in the Plugins menu.\x1b[0m')
            currentInputRef.current = ''
            return true
          }
          e.preventDefault()
          const city = input.replace(/^weather\s*/, '').trim()
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({
            type: 'weather',
            data: { city: city.charAt(0).toUpperCase() + city.slice(1) }
          })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // ping [host]
        if (input === 'ping' || input.startsWith('ping ')) {
          e.preventDefault()
          const host = input.replace(/^ping\s*/, '').trim() || '8.8.8.8'
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({ type: 'ping', data: { host } })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // portscan [host]
        if (input === 'portscan' || input.startsWith('portscan ')) {
          e.preventDefault()
          const host = input.replace(/^portscan\s*/, '').trim() || 'localhost'
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({ type: 'portscan', data: { host } })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // snippets
        if (input === 'snippets') {
          e.preventDefault()
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({ type: 'snippets' })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }

        // ps / query (data table)
        if (input === 'ps' || input === 'query' || input.startsWith('query ')) {
          const pluginEnabled = plugins.find(p => p.id === 'data-table')?.enabled ?? true
          if (!pluginEnabled) {
            term.writeln('\r\n\x1b[31mError: Data Table plugin is disabled. Enable it in the Plugins menu.\x1b[0m')
            currentInputRef.current = ''
            return true
          }
          if (input === 'ps') {
            e.preventDefault()
            const backspaces = '\x7f'.repeat(currentInputRef.current.length)
            window.fterm.ptyWrite(instanceId, backspaces)
            window.fterm.ptyWrite(instanceId, '\r\n')
            currentInputRef.current = ''
            if (ac) updateAcUI(null)
            autocompleteRef.current = null
            window.fterm.systemProcesses().then(rows => {
              setActiveWidget({
                type: 'data-table',
                data: {
                  title: 'Process List',
                  headers: ['PID', 'Name', 'CPU', 'Mem', 'Status', 'User'],
                  rows,
                }
              })
            }).catch(() => {
              setActiveWidget({
                type: 'data-table',
                data: { title: 'Process List', headers: ['PID', 'Name', 'CPU', 'Mem', 'Status', 'User'], rows: [] }
              })
            })
            return false
          }
        }

        if (input === 'ftermfetch') {
          e.preventDefault()
          const backspaces = '\x7f'.repeat(currentInputRef.current.length)
          window.fterm.ptyWrite(instanceId, backspaces)
          setActiveWidget({ type: 'ftermfetch' })
          window.fterm.ptyWrite(instanceId, '\r\n')
          currentInputRef.current = ''
          if (ac) updateAcUI(null)
          autocompleteRef.current = null
          return false
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — tab switching, must pass through to window
      if (e.key === 'Tab' && e.ctrlKey) {
        return true
      }

      if (ac && ac.active) {
        if (e.key === 'Tab') {
          if (e.type === 'keydown') {
            const completion = ac.suggestion;
            if (completion) {
              const remaining = completion.slice(ac.query.length);
              window.fterm.ptyWrite(instanceId, remaining);
              currentInputRef.current += remaining;
              autocompleteRef.current = null;
              updateAcUI(null);
            }
          }
          return false;
        }
        if (e.key === 'Escape') {
          if (e.type === 'keydown') {
            autocompleteRef.current = null;
            updateAcUI(null);
          }
          return false;
        }
      }

      if (ac && ac.active && e.type === 'keydown' && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt') {
        autocompleteRef.current = null;
        updateAcUI(null);
      }

      // Ctrl+L → clear terminal (standard shortcut)
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'l') {
        term.clear()
        return false
      }

      // Ctrl+R → history search overlay
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'r') {
        setShowHistorySearch(true)
        return false
      }
      return true;
    });

    let acDebounceTimeout: NodeJS.Timeout;

    const disposables = [
      term.onScroll((viewportY) => {
        setScrollInfo({
          viewportY,
          baseY: term.buffer.active.baseY,
          rows: term.rows,
        })
      }),
      term.onData(data => {
        // TUI app active (claude code, vim, etc.): forward raw, skip input tracking + autocomplete + pet
        if (isTUI()) {
          window.fterm.ptyWrite(instanceId, data);
          if (autocompleteRef.current) { autocompleteRef.current = null; updateAcUI(null); }
          return;
        }
        // Sporadic pet activity on typing
        const now = Date.now();
        if (now - (window.__ftermLastPetUpdate || 0) > 10000) {
          const petState = useStore.getState().petState;
          if (petState !== 'working' && petState !== 'celebrating') {
            useStore.getState().setPetState('working');
            if (Math.random() > 0.7) {
              useStore.getState().setPetMessage('Typing fast...');
            }
          }
          window.__ftermLastPetUpdate = now;
        }

        if (data === '\r' || data === '\n') {
          if (currentInputRef.current.trim()) {
            useStore.getState().addCommandHistory(currentInputRef.current.trim());
          }
          currentInputRef.current = '';
          autocompleteRef.current = null;
          updateAcUI(null);
        } else if (data === '\x7f') {
          currentInputRef.current = currentInputRef.current.slice(0, -1);
        } else if (data === '\x03') {
          currentInputRef.current = '';
          autocompleteRef.current = null;
          updateAcUI(null);
        } else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
          currentInputRef.current += data;
        }

        clearTimeout(acDebounceTimeout);

        // ── Instant history-based ghost text (no AI needed) ──────────────────
        const inputNow = currentInputRef.current;
        if (inputNow.length > 1) {
          const history = useStore.getState().commandHistory;
          const histMatch = [...history].reverse().find(
            cmd => cmd !== inputNow && cmd.toLowerCase().startsWith(inputNow.toLowerCase())
          );
          if (histMatch) {
            const cursorEl = term.element?.querySelector('.xterm-cursor-layer .xterm-cursor');
            if (cursorEl) {
              const rect = cursorEl.getBoundingClientRect();
              const state = { active: true, query: inputNow, suggestion: histMatch, x: rect.left, y: rect.top };
              autocompleteRef.current = state;
              updateAcUI(state);
            }
          } else {
            autocompleteRef.current = null;
            updateAcUI(null);
          }
        } else {
          autocompleteRef.current = null;
          updateAcUI(null);
        }

        if (currentInputRef.current.length > 2) {
          acDebounceTimeout = setTimeout(async () => {
            const aiState = useStore.getState().ai;
            const aiProvider = aiState.provider;
            if (aiProvider === 'none') return;

            const autocompleteModel =
              aiProvider === 'claude'   ? 'claude-haiku-4-5-20251001' :
              aiProvider === 'openai'   ? 'gpt-4o-mini' :
              aiProvider === 'copilot'  ? 'gpt-4o-mini' :
              aiProvider === 'gemini'   ? 'gemini-2.0-flash' :
              aiProvider === 'deepseek' ? 'deepseek-chat' :
              aiProvider === 'ollama'   ? (aiState.ollamaModel || aiState.model || '') :
              aiState.model || '';

            const buffer = term.buffer.active;
            const lines = [];
            for (let i = Math.max(0, buffer.cursorY - 10); i < buffer.cursorY; i++) {
              lines.push(buffer.getLine(i)?.translateToString(true) || '');
            }
            const context = lines.join('\n');
            const prefix = currentInputRef.current;

            try {
              const suggestion = await window.fterm.aiAutocomplete({
                requestId: 'autocomplete',
                provider: aiProvider,
                ollamaUrl: aiState.ollamaUrl,
                openaiUrl: aiState.openaiUrl || undefined,
                model: autocompleteModel,
                messages: [
                  {
                    role: 'system',
                    content: 'You are an inline terminal autocomplete AI. Return ONLY the direct continuation string of the given input. Do not rewrite the input. No formatting. No backticks. If nothing matches reliably, return an empty string.'
                  },
                  { role: 'user', content: `Context:\n${context}\n\nCurrent Input: ${prefix}` }
                ]
              });

              if (suggestion && suggestion.trim().length > 0 && currentInputRef.current === prefix) {
                let rawSuffix = suggestion.trim();
                // strip out prefix if AI idiotically returned full string
                if (rawSuffix.toLowerCase().startsWith(prefix.toLowerCase())) {
                  rawSuffix = rawSuffix.slice(prefix.length);
                }

                const cursorEl = term.element?.querySelector('.xterm-cursor-layer .xterm-cursor');
                if (cursorEl && rawSuffix) {
                  const rect = cursorEl.getBoundingClientRect();
                  const newState = {
                    active: true,
                    query: prefix,
                    suggestion: prefix + rawSuffix,
                    x: rect.left,
                    y: rect.top,
                  };
                  autocompleteRef.current = newState;
                  updateAcUI(newState);
                }
              }
            } catch (err) {
              console.error('Autocomplete failed:', err);
              autocompleteRef.current = null;
              updateAcUI(null);
            }
          }, 300);
        } else {
          autocompleteRef.current = null;
          updateAcUI(null);
        }

        window.fterm.ptyWrite(instanceId, data);
      }),
      term.onResize(({ cols, rows }) => {
        window.fterm.ptyResize(instanceId, cols, rows)
        setScrollInfo(prev => ({ ...prev, rows }))
      }),

      term.onSelectionChange(() => {
        // Skip copy-on-select in TUI — mouse drag in claude code/vim is for app selection,
        // not clipboard, and writing to clipboard mid-drag fights the app.
        if (isTUI()) return
        if (useStore.getState().settings.copyOnSelect !== false) {
          const sel = term.getSelection()
          if (sel) navigator.clipboard.writeText(sel)
        }
      }),
    ]

    return () => {
      scrollbarObserver.disconnect()
      container.removeEventListener('wheel', handleWheel, { capture: true })
      clearTimeout(acDebounceTimeout)
      removePtyData()
      removePtyExit()
      osc7Disposable.dispose()
      disposeAllDecorations()
      disposables.forEach(d => d.dispose())
      // We DO NOT call window.fterm.ptyKill(instanceId) anymore to persist the PTY backgrounds
      term.textarea?.removeEventListener('focus', onFocusHandler)
      term.textarea?.removeEventListener('blur', onBlurHandler)
      searchAddons.delete(instanceId)
      terminalInstances.delete(instanceId)
      pluginManager.unregisterTerminal(instanceId)
      // Dispose renderer addons first — their dispose() tries to restore the
      // default renderer which crashes if the terminal is already torn down.
      try { webglRef.current?.dispose() } catch { /* already gone */ }
      try { canvasRef.current?.dispose() } catch { /* already gone */ }
      webglRef.current = null
      canvasRef.current = null
      term.dispose()
      termRef.current = null
    }
  }, [tabId, paneId]) // useLayoutEffect: runs before paint so terminal is never blank

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      fitRef.current?.fit()
      try { webglRef.current?.clearTextureAtlas() } catch { }
      termRef.current?.focus()
    }, 50)
    return () => clearTimeout(t)
  }, [active])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = settings.fontSize
    term.options.fontFamily = settings.fontFamily
    term.options.lineHeight = settings.lineHeight
    term.options.cursorStyle = settings.cursorStyle
    term.options.cursorBlink = settings.cursorBlink
    term.options.theme = buildXtermTheme(theme)
    fitRef.current?.fit()
    if (containerRef.current) {
      containerRef.current.style.fontFeatureSettings = settings.ligatures !== false ? '"liga" 1, "calt" 1' : 'normal'
    }
  }, [settings, theme])

  // Custom scrollbar drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!scrollbarDragRef.current || !termRef.current) return
      const term = termRef.current
      const { startY, startViewportY } = scrollbarDragRef.current
      const trackHeight = containerRef.current?.clientHeight ?? 1
      const totalLines = term.buffer.active.baseY + term.rows
      const deltaLines = Math.round(((e.clientY - startY) / trackHeight) * totalLines)
      const target = Math.max(0, Math.min(term.buffer.active.baseY, startViewportY + deltaLines))
      term.scrollToLine(target)
    }
    const onMouseUp = () => { scrollbarDragRef.current = null }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    let timeout: NodeJS.Timeout
    let isDragging = false
    const onDragStart = () => { isDragging = true }
    const onDragEnd = () => {
      isDragging = false
      fitRef.current?.fit()
    }
    window.addEventListener('window:drag-start', onDragStart)
    window.addEventListener('window:drag-end', onDragEnd)
    const observer = new ResizeObserver(() => {
      if (isDragging) return
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        fitRef.current?.fit()
      }, 100)
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      clearTimeout(timeout)
      window.removeEventListener('window:drag-start', onDragStart)
      window.removeEventListener('window:drag-end', onDragEnd)
    }
  }, [])

  const contextMenuItems = [
    {
      label: 'Split Right',
      action: () => useStore.getState().splitPane(tabId, paneId, 'horizontal'),
    },
    {
      label: 'Split Down',
      action: () => useStore.getState().splitPane(tabId, paneId, 'vertical'),
    },
    {
      label: 'Close Split / Pane',
      action: () => useStore.getState().closePane(tabId, paneId),
    },
    { separator: true as const },
    {
      label: 'Copy',
      shortcut: 'Select',
      action: () => {
        const sel = termRef.current?.getSelection()
        if (sel) navigator.clipboard.writeText(sel)
      },
    },
    {
      label: 'Paste',
      shortcut: 'Right-click',
      action: async () => {
        const text = await navigator.clipboard.readText()
        if (text) window.fterm.ptyWrite(`${tabId}-${paneId}`, text)
      },
    },
    { separator: true as const },
    {
      label: 'Explain with AI',
      action: () => {
        const sel = termRef.current?.getSelection()
        if (sel) {
          sendMessage(`Explain this error:\n\`\`\`\n${sel}\n\`\`\``)
          setAIConfig({ sidebarOpen: true })
        }
      },
    },
    {
      label: 'Suggest Fix (AI)',
      action: () => {
        const sel = termRef.current?.getSelection()
        if (sel) {
          sendMessage(`How do I fix this error?\n\`\`\`\n${sel}\n\`\`\``)
          setAIConfig({ sidebarOpen: true })
        }
      },
    },
    { separator: true as const },
    {
      label: 'Clear',
      action: () => termRef.current?.clear(),
    },
  ]

  // Close widget on Escape (outside of xterm's key handler, for safety)
  useEffect(() => {
    if (!activeWidget) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeWidget() }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [activeWidget, closeWidget])

  // Ctrl+R via IPC — main process intercepts before-input-event and sends this
  useEffect(() => {
    if (!active) return
    return window.fterm.onHistorySearch?.(() => setShowHistorySearch(prev => prev ? false : true))
  }, [active])

  return (
    <div
      ref={paneRootRef}
      className="w-full h-full relative"
      onClick={() => { if (!activeWidget) { setActivePane(tabId, paneId); termRef.current?.focus() } setCtxMenu(null) }}
      onMouseEnter={() => { if (!activeWidget) termRef.current?.focus() }}
      onContextMenuCapture={(e) => {
        // TUI app may want right-click (mouse tracking). Skip our menu.
        if (termRef.current?.buffer.active.type === 'alternate') return
        e.preventDefault()
        setActivePane(tabId, paneId)
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div ref={containerRef} className="w-full h-full" />
      {/* Recording controls — top-right corner overlay */}
      {settings.showRecordingButton !== false && (
        <div className="absolute top-2 right-4 z-10 pointer-events-auto">
          <RecordingControls
            terminal={termRef.current}
            tabId={tabId}
            paneId={paneId}
            widgetEl={activeWidget ? paneRootRef.current : null}
            containerEl={paneRootRef.current}
          />
        </div>
      )}

      {/* AI quick-fix buttons — React overlay, avoids xterm decoration issues */}
      {settings.showAIAutoFixButton !== false && errorVer >= 0 && scrollInfo.rows > 0 && containerRef.current && (() => {
        const cellH = containerRef.current!.clientHeight / scrollInfo.rows
        const buf = termRef.current?.buffer.active
        const liveViewportY = buf?.viewportY ?? scrollInfo.viewportY
        const liveRows = termRef.current?.rows ?? scrollInfo.rows
        return errorMarkersRef.current
          .map(({ id, line, getContext }) => {
            const row = line - liveViewportY
            if (row < 1 || row >= liveRows) return null
            return (
              <button
                key={id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  sendMessage(`Diagnose and fix this terminal output:\n\`\`\`\n${getContext()}\n\`\`\``)
                  setAIConfig({ sidebarOpen: true })
                }}
                style={{ top: row * cellH + cellH * 0.1, right: 14 }}
                className="absolute z-20 pointer-events-auto flex items-center justify-center w-5 h-5 rounded text-[11px] leading-none bg-[rgba(88,166,255,0.12)] border border-[rgba(88,166,255,0.35)] hover:bg-[rgba(88,166,255,0.25)] transition-colors cursor-pointer select-none"
                title="Auto-Fix with AI"
              >
                ✨
              </button>
            )
          })
      })()}

      {/* Custom scrollbar overlay */}
      {(() => {
        const totalLines = scrollInfo.baseY + scrollInfo.rows
        if (totalLines <= scrollInfo.rows) return null
        const thumbHeightPct = Math.max(6, (scrollInfo.rows / totalLines) * 100)
        const scrollable = totalLines - scrollInfo.rows
        const thumbTopPct = scrollable > 0
          ? (scrollInfo.viewportY / scrollable) * (100 - thumbHeightPct)
          : 0
        return (
          <div
            className="absolute right-0 top-0 bottom-0 w-3 z-30 group pointer-events-auto select-none"
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const frac = (e.clientY - rect.top) / rect.height
              termRef.current?.scrollToLine(Math.round(frac * scrollable))
              e.preventDefault()
            }}
          >
            {/* track */}
            <div className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-0.5 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors" />
            {/* thumb */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-1.5 group-hover:w-2 rounded-full bg-white/25 group-hover:bg-white/45 hover:!bg-white/60 transition-all cursor-pointer"
              style={{ top: `${thumbTopPct}%`, height: `${thumbHeightPct}%` }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                scrollbarDragRef.current = {
                  startY: e.clientY,
                  startViewportY: scrollInfo.viewportY,
                }
              }}
            />
          </div>
        )
      })()}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={contextMenuItems} onClose={closeCtxMenu} />
      )}
      {createPortal(
        <div
          id="fterm-ghost-text"
          ref={acUiRef}
          className="fixed z-[9999] pointer-events-none"
          style={{ display: 'none' }}
        />,
        document.body
      )}

      {showHistorySearch && (
        <HistorySearch
          history={commandHistory}
          onSelect={(cmd) => {
            setShowHistorySearch(false)
            window.fterm.ptyWrite(instanceId, cmd)
            termRef.current?.focus()
          }}
          onClose={() => {
            setShowHistorySearch(false)
            termRef.current?.focus()
          }}
        />
      )}

      {/* Widget overlays */}
      <AnimatePresence>
        {activeWidget?.type === 'file-explorer' && (
          <FileExplorerWidget
            key="file-explorer"
            path={activeWidget.data?.path ?? '.'}
            onClose={closeWidget}
          />
        )}
        {activeWidget?.type === 'sys-mon' && (
          <SystemMonitorWidget key="sys-mon" onClose={closeWidget} />
        )}
        {activeWidget?.type === 'docker' && (
          <DockerWidget key="docker" onClose={closeWidget} />
        )}
        {activeWidget?.type === 'weather' && (
          <WeatherWidget key="weather" city={activeWidget.data?.city ?? ''} onClose={closeWidget} />
        )}
        {activeWidget?.type === 'ping' && (
          <PingWidget key="ping" host={activeWidget.data?.host ?? '8.8.8.8'} onClose={closeWidget} />
        )}
        {activeWidget?.type === 'data-table' && (
          <DataTableWidget
            key="data-table"
            title={activeWidget.data?.title ?? 'Table'}
            headers={activeWidget.data?.headers ?? []}
            rows={activeWidget.data?.rows ?? []}
            onClose={closeWidget}
          />
        )}
        {activeWidget?.type === 'portscan' && (
          <PortScanWidget key="portscan" host={activeWidget.data?.host ?? 'localhost'} onClose={closeWidget} />
        )}
        {activeWidget?.type === 'snippets' && (
          <SnippetsWidget
            key="snippets"
            onClose={closeWidget}
            onRun={(cmd) => window.fterm.ptyWrite(instanceId, cmd + '\r')}
          />
        )}
        {activeWidget?.type === 'ftermfetch' && (
          <FtermfetchWidget key="ftermfetch" onClose={closeWidget} />
        )}
      </AnimatePresence>
    </div>
  )
}

function buildXtermTheme(t: ReturnType<typeof useActiveTheme>) {
  return {
    background: '#00000000', foreground: t.foreground,
    cursor: t.cursor, selectionBackground: t.selectionBackground,
    black: t.black, red: t.red, green: t.green, yellow: t.yellow,
    blue: t.blue, magenta: t.magenta, cyan: t.cyan, white: t.white,
    brightBlack: t.brightBlack, brightRed: t.brightRed, brightGreen: t.brightGreen,
    brightYellow: t.brightYellow, brightBlue: t.brightBlue, brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan, brightWhite: t.brightWhite,
  }
}
