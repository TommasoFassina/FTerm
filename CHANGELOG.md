# Changelog

All notable changes to FTerm are documented here.

## [Unreleased] — 2026-04-28

### Security
- **`fterm://` protocol path traversal:** handler now resolves the requested path, enforces the existing `isPathAllowed` allowlist, and restricts served content to image MIME types only. Previously, the `..` check ran on the pre-resolved path and any file extension was served.
- **`fs:writeTmp` filename sanitization:** replaces ad-hoc `..` / slash stripping with `path.basename` + character allowlist + post-resolve containment check, so the final path cannot escape `tmpdir()`.
- **Renderer navigation lockdown:** added `will-navigate` and `setWindowOpenHandler` to the main `BrowserWindow`. Blocks navigation away from the app origin and routes `window.open` / `target=_blank` through `shell.openExternal` (http/https only) instead of allowing a new `BrowserWindow` to spawn.
- **Remote terminal token replay:** auth tokens are now single-use — invalidated on WebSocket upgrade so a captured token cannot be reused for a second session.
- **Remote terminal Origin check:** WebSocket upgrade rejects requests whose `Origin` host differs from the `Host` header.
- **Remote terminal PIN compare timing:** PIN check uses `crypto.timingSafeEqual` with length and empty-PIN guards instead of `===`.

### Added
- **Ctrl+Shift+L — force redraw:** scrolls to bottom and refreshes xterm rendering. Escape hatch for stuck TUI ghosting (e.g., claude code leaving residual rows after Esc on ConPTY).

### Fixed
- **Alt-screen exit ghosting:** when a TUI app (claude code, vim, less) exits via `\x1b[?1049l`, FTerm now triggers a `term.refresh()` + `scrollToBottom()` shortly after. Mitigates ConPTY's tendency to leave residual TUI rows in the restored main buffer (visible as "two claude UIs" after Esc).
- **Terminal not loading — `term.onFocus is not a function`:** xterm.js 5.x removed the `onFocus`/`onBlur` event methods. `TerminalPane` now attaches DOM `focus`/`blur` listeners to `term.textarea` and removes them on dispose.
- **Plugin system — CSP eval block:** removed stale `<meta http-equiv="Content-Security-Policy">` from `index.html` that blocked `new Function` and dynamic `import()`. Plugin eval now uses blob URL + `import()` instead of `new Function`, which works under Electron's sandboxed renderer.
- **Plugin `onTerminalReady` not firing for open tabs:** plugins registered after a terminal is already open now immediately fire `onTerminalReady` on all live terminals via `PluginManager.registerTerminal` / `unregisterTerminal` tracking. Uses xterm's `onRender` event to defer the call until the Viewport's render service has valid dimensions (prevents `Cannot read properties of undefined (reading 'dimensions')` crash).
- **Plugin banner cleared on startup (cmd.exe):** removed `cls` call from `fterm_init.bat` that wiped terminal content written by `onTerminalReady` before the shell prompt appeared.
- **`onTerminalReady` timing:** moved `notifyTerminalReady` call to fire after the first PTY data chunk instead of at xterm init, so plugin banners appear below the shell's initial prompt output.
- **AI usage mis-attributed to OpenAI:** `streamOpenAI` now reports the correct provider (`gemini`/`deepseek`) in `ai:usage` IPC events instead of always reporting `'openai'`.
- **Missing test models for Gemini/DeepSeek:** `ai:test` handler now uses `gemini-2.0-flash` and `deepseek-chat` as explicit test models instead of falling through to undefined.
- **Caveman AI persona prompt:** updated from a roleplay "grunt-speak" prompt to the real caveman communication style — drop articles/filler/pleasantries/hedging, fragments OK, full technical accuracy preserved.

### Added
- `window.__ftermActiveTerminal` — set to the focused xterm instance on focus, cleared on blur. Plugins can use this in `onPtyData` to write to the currently active terminal without tracking `instanceId`.
- README plugin example for "Git branch banner on cd" — uses OSC 7 + `window.fterm.git.status(cwd)` for real branch detection; documents OSC 7 availability per shell.

## [0.1.0] — 2026-04-27

Initial public release.

### Security & Privacy
- No pre-registered OAuth client IDs ship with FTerm — every OAuth flow requires the user to supply their own registered client ID. No FTerm-controlled OAuth app exists that could be abused, revoked, or rate-limited.
- No telemetry, no analytics, no proxy servers — all AI requests go directly from the user's machine to their chosen provider.
- API keys / OAuth tokens stored locally via Electron `safeStorage` (Windows DPAPI / macOS Keychain / Linux libsecret). FTerm refuses to write credentials when the OS keychain is unavailable instead of falling back to plaintext.
- Renderer cannot read keys back over IPC; only `keysHas()` / `keysListConnected()` are exposed.
- Zustand `partialize` excludes credentials from `localStorage` persistence.
- DevTools disabled in packaged builds (F12 / Ctrl+Shift+I/J/C blocked) to prevent inspecting in-flight Authorization headers.
- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Strict Content-Security-Policy headers in dev and prod (`frame-ancestors 'none'`, `object-src 'none'`, no remote scripts).
- Markdown preview uses `react-markdown` with `skipHtml` (no `dangerouslySetInnerHTML`).
- `fs:readdir` IPC handler whitelists home, tmp, cwd, and drive roots.
- `openExternal` filter — only http(s) URLs, blocks `file://` / `smb://` / arbitrary protocols.
- Self-hosted Monaco editor + workers (no CDN fetches at runtime).
- Remote terminal: 6-digit PIN, per-IP brute-force lockout (5 attempts → 5 min cooldown), 1KB body cap, 5-second body timeout.
- Copilot token hygiene: in-memory cache cleared on app blur, on `keys:delete copilot`, on quit.
- GitHub OAuth tokens validated against `gho_/ghu_/ghs_/ghp_/ghr_` / 40-char hex regex before persisting.
- AI streaming buffers capped at 50MB; PTY output force-flush at 4MB.
- Portscan: max 256 ports, integer validation, 32-port concurrency batching.

### Terminal Core
- Real PTY terminal via `node-pty` + `xterm.js` with WebGL/Canvas renderer
- Multi-tab support with shell-based tab titles
- Split panes — horizontal and vertical, per tab
- Custom scrollbar overlay (native browser scrollbar hidden)
- Copy-on-select, font ligatures, configurable font/size/cursor
- `Ctrl+V` / `Ctrl+Shift+V` paste from clipboard
- `Ctrl+Shift+C` copy selection (Ctrl+C alone preserves SIGINT, copies if text is selected)
- `Shift+Arrow` keyboard selection in terminal
- `Ctrl+L` clear, `Ctrl+R` fuzzy history search overlay
- `Ctrl+Tab` / `Ctrl+Shift+Tab` tab navigation
- Bell notification badge on tabs
- OSC 7 CWD tracking from shell prompt
- Inline AI autocomplete (ghost-text) powered by history + AI provider
- AI error fix glyph (✨) next to detected errors — click to diagnose with AI
- Session recording and replay (FFmpeg-powered video composition)
- Command palette (`Ctrl+Shift+P`) with fuzzy search
- React `ErrorBoundary` wraps `<App/>` to prevent component crashes from killing the app
- First-run welcome overlay — highlights key features and links to AI provider setup

### Remote Terminal
- WebSocket server for remote shell sessions
- QR code connection helper

### Widgets
- `explore [path]` — File Explorer: interactive card grid with drive listing
- `sys-mon` — System Monitor: live CPU, RAM, and network area charts
- `docker-dash` — Docker Dashboard: start/stop containers, view logs
- `weather [city]` — Weather Card: animated glassmorphism weather card
- `ps` — Process Table: sortable process list
- `query [sql]` — Data Table: SQL-like queries on system data
- `ftermfetch` — System Info: neofetch-style system summary
- `port-scan [host]` — Port Scanner: open port detection
- `ping [host]` — Ping Monitor: live latency graph with history
- `snippets` — Snippets Manager: save and insert reusable shell commands

### AI Integration
- Streaming AI chat sidebar (`Ctrl+Shift+A`)
- Providers: Claude (Anthropic SDK with API key or `authToken` bearer), OpenAI, GitHub Copilot (user OAuth app + device flow, or PAT), Ollama, Gemini, DeepSeek
- Per-provider token usage tracking (session / day / week)
- AI-powered context menu actions: "Explain with AI", "Suggest Fix (AI)"
- Streaming IPC chunks coalesced into 16ms batches to minimize renderer pressure during fast streams
- Claude API key OR import from Claude Code CLI (`~/.claude/.credentials.json`); no external `claude` binary required
- OpenAI / Gemini browser OAuth requires user-supplied OAuth client ID
- Git panel in sidebar: stage, commit, push, pull, stash, branch checkout

### Tamagotchi Pet
- ASCII companion with 6 types: cat, dog, dragon, robot, ghost, panda
- 7 reactive states: idle, happy, sad, working, sleeping, celebrating, worried
- Pet stats: commits tracked, commands run, days active, lines written
- XP and leveling system

### Customization
- 5 built-in themes: GitHub Dark, Dracula, Tokyo Night, Cyberpunk, Nord
- Custom theme editor (per-color overrides)
- Terminal profiles: shell, cwd, env vars, theme — save and switch
- Fully customizable keybindings (16 default bindings)
- Monaco editor integration with syntax highlighting (lazy-loaded — only fetched when an editor tab opens)
- Plugin system: built-in plugins + custom JavaScript with hot reload

### Performance
- Lazy-loaded views (Settings, Themes, Profiles, Plugins, Git, Pet, Editor) — startup bundle ~1.5MB; Monaco + workers (~9MB) only fetched on demand
- Vendor chunk splitting (Monaco, xterm, markdown, motion, react) for caching across updates
- esbuild minification for renderer + main process; production sourcemaps disabled
