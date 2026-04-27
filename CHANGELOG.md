# Changelog

All notable changes to FTerm are documented here.

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
