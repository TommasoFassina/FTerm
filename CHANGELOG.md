# Changelog

All notable changes to FTerm are documented here.

## [Unreleased] — 2026-05-02

### Fixed
- **Recording — SGR sequences stripped after keep pass:** `stripNonSGR` step 5 (`.replace(/\x1b/g, '')`) ran after step 4 kept SGR sequences, stripping the `\x1b` from every `\x1b[39m` / `\x1b[0m` / `\x1b[38;2;…m` — leaving bare `[39m][0m]` as literal rendered text in every frame. Step 6's C0 range `\x0a-\x1f` also covered `\x1b` (0x1B). Fixed by removing the redundant step 5 and excluding `\x1b` from the C0 strip range (`\x0a-\x1a\x1c-\x1f`). Colors now render correctly in all recordings.
- **Recording — box-drawing / block-element characters render as squares:** node-canvas was using only `Consolas` as the render font, which lacks Unicode block elements (`█▓▒░▊▌`), box-drawing chars (`╭╰│─`), and powerline symbols used by Claude CLI. Fixed by: (1) passing the user's terminal `fontFamily` setting through `recordingStop` IPC to the video composer; (2) `buildFontStack()` in `VideoComposer` merges user fonts with fallback chain `Cascadia Mono → Cascadia Code → Consolas → Segoe UI Symbol → Segoe UI Emoji → Courier New → DejaVu Sans Mono → monospace`; (3) `FrameRenderer.preload()` calls `registerFont()` for `seguisym.ttf`, `seguiemj.ttf`, `CascadiaMono.ttf`, and `CascadiaCode.ttf` from `C:\Windows\Fonts\` (skips any that are absent).
- **Recording — pet sprite lines have visible gaps between rows:** pet was rendered using the terminal's `lineHeight` (~1.4 × fontSize) instead of the live component's `leading-tight` CSS (1.25 × fontSize), creating ~8 px transparent bands between each sprite row. Fixed by computing a separate `petLineHeight = Math.round(fontSize * 1.25)` for pet and name/bubble Y positions.

## [Unreleased] — 2026-05-01

### Added
- **Activity heatmap** — 53-week × 7-day GitHub-style contribution grid in Settings → Stats. Green intensity = command volume; red tint = error-heavy days. Hover cells for date + counts.
- **Session streaks** — current and longest consecutive active-day streaks tracked in the store and shown as big-number badges in the Stats panel.
- **Terminal activity stats** — error rate (%), most-used commands bar chart (top 8), and busiest hours histogram (24 hourly buckets). All persisted to `localStorage`.
- **`ftermfetch` React widget** — `ftermfetch` command now opens a modal overlay instead of running the PowerShell script. Renders the FTerm ASCII logo + configurable field list using live system data from IPC.
- **ftermfetch layout editor** — Settings → Stats → "ftermfetch Layout" section. Toggle fields on/off and reorder with ▲/▼ buttons. Available fields: hostname, OS, shell, CPU, memory, uptime, CWD, pet level, AI provider, streak, commands run.
- **ftermfetch color modes** — "Theme" derives accent colors from the active FTerm theme; "Custom" shows per-field hex color pickers.
- **ftermfetch PNG export** — "export PNG" button in the widget captures the card via `captureRect` IPC and downloads `ftermfetch-YYYY-MM-DD.png`.
- **Cross-platform shell functions** — `ptyManager` now writes `fterm_init.sh` (bash/zsh, includes OSC 7 + OSC 9998 prompt hooks + `ftermfetch` stub) and `fterm_init.fish` (fish equivalent). Bash/zsh use `--rcfile`; fish uses `--init-command source …`.

### Fixed
- **Recording — literal ANSI codes in video (`39m`, `0m`, etc.):** `stripNonSGR` in `FrameRenderer.ts` applied `\x1b./g` (ESC + any char) AFTER the SGR-keep pass. Since `.` matches `[`, every kept SGR sequence had its `\x1b[` prefix stripped, leaving `39m`, `0m`, `38;2;R;G;Bm` etc. as literal rendered text. Fixed by running the ESC-non-CSI strip (`\x1b[^\[]`) BEFORE the CSI pass, so `[` is never consumed accidentally.
- **`stripNonSGR` — private-prefix SGR sequences kept incorrectly:** sequences like `\x1b[>1m` (DEC private) were passed through as SGR because the keep condition only checked `cmd === 'm'`. Now also requires no `?`/`!`/`>` prefix.
- **`parseAnsiLine` — code 39 (default fg) not handled:** ANSI code 39 (reset foreground to default) fell through without action. Now resets `currentColor` to `theme.foreground` the same as code 0.
- **ftermfetch ASCII art whitespace collapse:** logo lines in the widget lost internal spaces because `white-space` was not set. Fixed with `whiteSpace: 'pre'` on each logo line.
- **ftermfetch memory bar glitch:** replaced Unicode block-character bar (`█░`) with a CSS `div` progress bar (green → yellow → red at 60 / 80 % thresholds) for pixel-correct rendering.

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
