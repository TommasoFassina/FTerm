# Changelog

All notable changes to FTerm are documented here.

## [0.1.5] — 2026-08-06

### Deprecated
> **The bring-your-own-API-key AI setup is deprecated and may be removed in a future release.**
>
> Connecting an AI provider by pasting a personal API key (Settings → AI: Claude, OpenAI, Gemini, DeepSeek) is no longer the direction FTerm is going. Requiring a paid API key before the terminal is useful was the wrong trade, and the machinery around it — the GitHub Copilot OAuth device flow, the multi-provider picker, the Claude usage-stats panel — costs maintenance for features that see very little use.
>
> **Nothing breaks today.** Existing keys keep working, stay encrypted in the OS keychain, and are still never handed back to the renderer. No removal date is set.
>
> **The likely replacement** is zero-configuration detection of AI CLIs already authenticated on your machine (`claude`, `gh copilot`, `ollama`), with the AI sidebar and inline autocomplete simply not appearing when no backend is present. That work has not started; manual API keys, if kept, would move to an advanced setting.
>
> **If you rely on a manual API key**, expect this path to change and check the changelog before upgrading.
>
> The same notice appears in the README and at the top of Settings → AI.

### Security
- **Ping / port-scan allowlist bypass in the remote terminal:** `isPrivateTarget()` accepted any hostname starting with `fc` or `fd` — the check for IPv6 unique-local addresses was a bare `startsWith` applied to every input, so `fd-cdn.example.com` or `fcatalog.evil.com` passed as "private". A hijacked remote session could use the host to probe arbitrary public hosts. IPv6 prefix rules now only apply to actual IPv6 literals (input containing `:`), and the ranges are matched properly (`fe80::/10`, `fc00::/7`).

### Added
- **Command blocks (OSC 133 shell integration)** — the scrollback is no longer an undifferentiated wall of text. FTerm's prompt hooks now emit the standard `OSC 133;D;<exit>` / `OSC 133;A` markers (PowerShell, CMD, bash/zsh, fish), and the renderer slices the buffer into blocks: one per command, with its exit code, wall-clock duration and cwd.
  - `Ctrl+Shift+↑` / `Ctrl+Shift+↓` jump prompt to prompt.
  - `Ctrl+Shift+B` opens the block list for the pane — every command in the session with status and timing; click to scroll to it, or copy the command / its output without dragging a selection. Output preview is inline.
  - A coloured rail in the left gutter marks each command: blue while running, green on success, red on failure.
  - **Copy Last Command Output** added to the command palette.
  - `B` (prompt end) and `C` (output start) are deliberately not emitted — invisible sequences inside the prompt string break PSReadLine's prompt-width accounting on Windows. Both boundaries are derived in the renderer instead, which already knows when Enter was pressed.
  - Blocks are per-pane, capped at 200, and never persisted. Sessions opened before this release need a tab restart to pick up the new prompt hooks.
- **Drop-down (quake) terminal** — a global hotkey summons FTerm over whatever you are doing and tucks it away again, from any application. Configurable in Settings → General: hotkey (recorded by pressing the combination), drop edge (top/bottom), height and width as a percent of the display, target monitor (under the cursor or primary), hide-on-blur and slide animation. The window follows onto other virtual desktops, and "Restore normal window" (Settings or the command palette) puts it back exactly where it was before quake took it over. Accelerators are validated against an allowlist before registration, and a combination already owned by another application is reported inline instead of failing silently.
- **Theme import** — Settings → Themes now reads **iTerm2 `.itermcolors`** files and **Windows Terminal** color schemes (a single scheme, an array, or an entire `settings.json`, comments and trailing commas included — every scheme inside is imported). Hundreds of published schemes now work in FTerm without hand-transcribing twenty hex values.
- **Pet progression** — the companion is now wired to what you actually do.
  - **15 achievements** driven by real activity: commands run, commits made, streak length, night-owl hours, distinct commands used, level, errors survived, days active. Each pays coins; progress bars show the next goal.
  - **Coins** also drop from live events — commits (+15), pushes (+10), level-ups (+25).
  - **Wardrobe**: 12 cosmetics, most gated behind their achievement. Buying, equipping and taking off are all reversible. Cosmetics and achievement badges are **ASCII**, not emoji — the pet is monospace art and the cosmetic sits directly on it.
  - The equipped cosmetic is a child of the sprite element, centred on the sprite's own width (which differs per species) and anchored exactly one line above it. It inherits the pet's state colour, moves with every hop, shake and pulse, and appears in **session recordings** — space-padded into the captured sprite so `FrameRenderer` places it without special handling. The Pet view's avatar previews it with the same anchoring.
  - Achievements are swept on startup and whenever the Pet view opens, so anything already earned is paid out immediately instead of waiting for the next command.
  - **Real git events reach the pet**: committing celebrates, pushing cheers, and a newly detected merge conflict worries it (once, on the transition — not on every refresh).
- **Unit tests** (`vitest`): `npm test` / `npm run test:watch`. 88 cases covering the security validators (path containment, sensitive-file detection, network-target allowlist, Docker container ids, GitHub token shape, global-shortcut accelerators), the OSC 133 protocol parser, the theme importers and the pet progression rules.
- `electron/security/validators.ts` — the security validators that were duplicated between `main.ts` and `remoteTerminalServer.ts` now live in one Electron-free module so they can be tested directly. Behaviour is unchanged apart from the IPv6 fix above and stricter rejection of non-string input. Now also home to `isValidAccelerator()`, which gates the quake hotkey: modifiers from a fixed set, exactly one non-modifier key, and never a bare key — registering one globally would swallow it for every application on the machine.
- Shell init scripts gained `OSC 9998` on **fish**, which previously had exit-code reporting only on the other shells.

### Fixed
- **`ftermfetch.ps1` was never packaged.** `build.files` shipped only `dist/**` and `dist-electron/**`, and nothing copied the script into either — so in an installed build the read failed. Worse, that read sat in the same `try` block as the shell init files, so its failure also skipped `fterm_init.bat`, `fterm_init.sh` and `fterm_init.fish`: **cmd, bash and fish silently lost OSC 7 (cwd tracking), OSC 9998 (exit codes) and, as of this release, OSC 133 (command blocks)** in packaged builds. The script is now included in `build.files`, and its deployment is isolated so a missing script can never take shell integration down with it.
- **Stale build chunks were being shipped.** `dist-electron` was never emptied between builds, so hashed chunks from previous runs accumulated and were packaged into `app.asar` (9 entries where 4 were live). `npm run build` / `npm run electron:build` now run `clean:out` first.
- **Version numbers no longer drift.** Four were hardcoded and all disagreed: the `ftermfetch` banner said `v0.1.1`, the ftermfetch widget `v0.1.4`, and the Copilot `Editor-Version` header `FTerm/0.1.0`. They now come from one source — `app.getVersion()` in the main process (substituted into the `.ps1` at deploy time) and a build-time `__APP_VERSION__` constant in the renderer, both reading `package.json`.
- **Ad-block counter always showed 0:** the badge in the browser toolbar was fed by Ghostery `request-blocked` events, but Ghostery's network blocking was disabled (it segfaulted the browser process), so the counter never moved. Blocks are now counted from `net::ERR_BLOCKED_BY_CLIENT` on the passive `webRequest.onErrorOccurred` event — which is what uBOL's declarativeNetRequest blocking actually emits — with the stats IPC coalesced to one event per 500 ms.
- **Ad-block toggle was a no-op:** turning the shield off left uBOL loaded and everything still blocked. `setAdblockEnabled()` now loads/unloads the uBOL extension, which is the component that actually cancels requests.

### Changed
- **Removed the Ghostery adblocker engine** (`@ghostery/adblocker-electron`). It was dead weight: blocking stayed disabled after the browser-process crash, so all it did was download the EasyList prebuilt engine on every startup. uBOL (MV3 DNR) + the YouTube innertube scrub remain the active blockers.
- Command palette gained a **Widgets** group — every widget (explorer, sys-mon, docker, weather, ping, portscan, snippets, notes, clipboard, ftermfetch, browser, visualizer) is now reachable without typing its terminal command.
- **Emoji replaced with ASCII across the app's own chrome.** The welcome overlay's feature icons, the pet's cosmetics and achievement badges, the coin counter and the pet's git messages are all monospace text now. FTerm is a terminal and its art is ASCII; emoji read as pasted in from somewhere else. (User-authored content — AI persona labels, pet dialogue — is untouched.)
- The welcome overlay's feature grid now advertises **command blocks** in place of the AI-first framing.
- Lint now covers `electron/` as well as `src/`; dependencies updated (audit clean).
- **Release builds now fetch uBlock Origin Lite themselves.** `electron/vendor/ubol` is git-ignored (uBOL is GPL and is not redistributed in this repository) but `electron-builder` packages it as an extraResource, so a clean checkout — every CI run — had nothing to copy. `scripts/fetch-ubol.mjs` (`npm run fetch:ubol`) pulls the latest `*.chromium.zip` from `uBlockOrigin/uBOL-home`, the same source and asset the in-app updater uses, and the release workflow runs it on all three platforms before building. It is a no-op when the directory already exists, so local builds are unaffected.
- CI now runs `npm test` alongside typecheck and lint.
- **Release assets cut from 14 to 6, with no duplicates.** Two publishers were uploading the same binaries: electron-builder's own GitHub publisher (its `publish` config) *and* the `action-gh-release` step, each sanitizing filenames differently — hence `FTerm-Setup-0.1.4.exe` next to `FTerm.Setup.0.1.4.exe`. `publish` is now `null`, so the workflow is the single publisher. Explicit space-free `artifactName` templates keep GitHub from rewriting names, and the `.blockmap` / `latest*.yml` differential-update metadata is no longer generated — FTerm has no auto-updater, so nothing ever consumed it. The release now carries exactly: Windows installer, Windows portable, macOS x64 and arm64 `.dmg`, Linux `.AppImage` and `.deb`.

## [0.1.4] — 2026-06-06

### Added
- **In-app browser** — a built-in web browser available both as a dedicated tab and as a `browser` widget overlay. Runs in a hardened Electron `<webview>` on an isolated session partition with ad/tracker blocking (uBlock Origin Lite declarativeNetRequest rulesets + Ghostery engine, plus YouTube-specific scriptlet/cosmetic scrubbing). Privacy controls: session-only browsing history (never persisted to disk), a "remember me" toggle gating persistent cookies/storage, and granular clear-data (cookies, cache, storage, history) from the browser UI. Bookmarks persist across restart.
- **SSH host manager** — save SSH connections (label, host, user, port, identity file, extra args) in Settings → Remote and one-click connect from the command palette (`SSH: <label>` group). A host is materialized as a derived profile (`shell: ssh.exe`, args `-p <port>` + optional `-i <identityFile>` + extra args + `user@host`) and launched through the existing profile→PTY spawn path, so no new IPC or shell wiring was needed. Hosts persist across restart. Key/agent auth only — passwords are never requested or stored.
- **Notes scratchpad** (`note` / `notes` widget) — quick per-session markdown notes without leaving the terminal. Left list + right editor; title and body autosave to the store on every keystroke (last-edited timestamp tracked). Optional **Export** writes the note to `~/.fterm/notes/<title>.md` via the existing `fsWriteFile` path API. Notes persist across restart.
- **AI command builder** (`Ctrl+K`) — describe a task in plain English and the active AI provider generates a single shell command for the current OS/shell. The call is one-off: it injects terminal context (OS, shell, CWD, git branch) but does **not** touch the chat sidebar history. The generated command lands in an editable preview with **Run** / **Copy**; Run inserts it into the active pane **without** a trailing newline, so the user reviews and presses Enter to execute — the key guardrail for AI-generated commands. Rebindable via Settings → Shortcuts; shows a hint when no AI provider is configured.

## [0.1.3] — 2026-05-23

### Security
- **Docker container ID length not bounded:** `docker:logs` and `docker:action` IPC handlers now enforce a 64-character maximum on container IDs in addition to the existing character allowlist.
- **`fs:readdir` symlink traversal:** directory entries that are symlinks now have their real path resolved via `realpathSync` and checked against the `isPathAllowed` allowlist before being returned. Entries whose targets fall outside the allowlist are silently filtered out, preventing symlink-based escape from allowed roots.
- **Remote terminal hardening:** the LAN-served WebSocket / HTTP service was audited and locked down. Changes: (1) Filesystem read/list restricted to an explicit allowlist of roots (homedir, tmp, app data, drive roots / mount points) — system internals (`C:\Windows\System32`, `/proc`, `/sys`, `/dev`, `/root`, Windows credential vaults, etc.) are denied even within allowed roots. (2) Sensitive-file deny list — entries matching `.ssh`, `.aws`, `.gnupg`, `.kube`, `.azure`, `.docker`, `.config/gcloud`, `.git-credentials`, `.npmrc`, `.netrc`, `id_rsa`/`id_ed25519`/`id_dsa`/`id_ecdsa`, any `.env`, `.pem`/`.key`/`.p12`/`.pfx`/`.keystore`/`.jks`, or names containing `secret`/`password`/`token`/`api_key`/`private_key` are hidden from listings and refused for reads, blocking credential exfiltration via a hijacked session. (3) Symlink-aware reads: `fs:read` now resolves the real path and re-validates against allowlist + sensitive deny list before reading. (4) Network probe restriction: the `ping` and `portscan` widgets now only accept loopback / RFC1918 / link-local / unique-local / CGNAT / `.local` mDNS / single-label hostnames — prevents the remote from being used to scan or probe arbitrary internet hosts from inside the LAN. (5) Per-session rate limits: 30 AI requests/min and 60 widget command executions/min, defending the host's API budget and shell against abuse. (6) Strict WebSocket origin: upgrade now *requires* an `Origin` header (was previously optional) that exactly matches `Host`. (7) `/api/auth` rejects cross-origin requests via `Origin` check and enforces `Content-Type: application/json`, defending against drive-by CSRF from a malicious LAN page. (8) Security headers on all responses: strict CSP (no remote scripts), `X-Frame-Options: DENY` (anti-clickjack), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/microphone/geolocation/payment/USB, `Cross-Origin-Opener-Policy: same-origin`. (9) Clipboard widget no longer auto-reads the host clipboard on open — only on explicit Read button press, so secrets sitting in clipboard aren't immediately broadcast. (10) PIN screen now shows a prominent warning that traffic is unencrypted plaintext HTTP and that the remote service should only run on networks the user fully trusts.

### Performance
- **Static system metrics cached at startup:** `hostname`, `platform`, `arch`, `release`, `username`, and `tmpdir` are computed once when the main process starts. Previously `system:metrics` IPC called these OS APIs on every poll cycle.
- **Network delta rate-limited to 4 s:** `getNetworkDelta` now caches its result for 4 seconds. On Windows, this prevents spawning a PowerShell/WMI process every 2 s (the status bar poll interval).
- **StatusBar store subscriptions consolidated:** 14 separate `useStore` subscriptions replaced with a single `useShallow` selector. The component now re-renders only when selected fields change, not on any unrelated store write.
- **`activeCwd` derived via store selector:** previously computed with `tabs.find()` in the render body on every render; now a proper inline selector evaluated by Zustand.
- **File explorer sort memoized:** folder/file filtering and `localeCompare` sort (O(n log n)) wrapped in `useMemo` — runs only when the directory listing changes, not on every render.
- **Terminal context menu memoized:** the context menu items array is now wrapped in `useMemo([tabId, paneId])` instead of being recreated on every render.
- **Terminal history prefix search optimized:** history autocomplete now iterates from the end with early exit instead of `[...history].reverse().find()`, eliminating the full array copy and redundant `toLowerCase` calls per keystroke.
- **Markdown preview memoized:** extracted to a `React.memo` component — the remark/GFM parser only re-runs when file content changes, not on any parent re-render.
- **Ollama model list re-fetched on URL change:** `useEffect` in the Ollama settings section now includes `ai.ollamaUrl` in its dependency array; previously the model list would stale if the user changed the server URL while already connected.

### Added
- **Claude Code CLI stats in status bar** — while `claude` CLI runs in TUI mode, FTerm scans the terminal buffer every 2 s and extracts model name, token counts (↑↓), context window %, and cost. Displayed as a live segment in the status bar (works with any AI provider setting, including "none").
- **Shell auto-restart on exit** — new setting (General → Terminal → "Auto-restart shell on exit"). When enabled, the shell process respawns immediately in the same CWD whenever it exits. When disabled, pressing any key after "Process exited" now actually restarts the shell (previously the message appeared but keypresses had no effect).
- **CWD click opens file explorer** — clicking the `cwd` segment in the status bar opens the file explorer widget at the current working directory of the active tab.
- **Image files open in viewer from file explorer** — clicking an image file (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `svg`) inside the file explorer widget now opens it in the built-in image viewer overlay instead of launching the OS default viewer.
- **Floating/draggable image viewer** — image viewer has a new toggle button (Minimize2 icon) to switch between fullscreen overlay mode and a floating draggable window. In floating mode the window can be repositioned by dragging its header and resized via the bottom-right corner handle.
- **`imgcat` image viewer widget** — `imgcat <path>` now opens the image in a full-pane overlay widget instead of writing it inline to the terminal via OSC 1337. Supports zoom in/out, reset, click-outside or Esc to close. Eliminates the black-screen repaint glitch that occurred with the previous inline approach.
- **AI code block actions** — shell code blocks in chat responses now show **Run in terminal**, **Insert at cursor**, and **Save to file** buttons. Non-shell blocks show **Insert** and **Save**. A brief status flash confirms each action.
- **Remote terminal — image preview on phone** — tapping an image file (`png`, `jpg/jpeg`, `gif`, `webp`, `bmp`, `svg`, `ico`, `avif`) in the File Explorer widget now fetches it from the host as a base64 data URL (capped at 12 MB) and shows it in a full-screen viewer overlay instead of dumping `cat` of the binary into the terminal. Subject to the same path-allowlist and sensitive-file deny rules as the rest of the file API.
- **Remote terminal — visualViewport keyboard handling** — the remote browser client now resizes its layout to the visible viewport (`window.visualViewport`) instead of the layout viewport. When the mobile keyboard pops up, the app shrinks above it so the bottom key bar (arrows, Esc, Tab, Ctrl, punctuation) and launcher chips remain visible instead of being hidden behind the OSK. xterm refits on viewport resize so the terminal also reflows correctly.
- **Remote terminal — full mobile control surface with widget parity** — the browser client served on the LAN port now ships with tabbed views (Term / AI / Tools) covering most desktop features. **Term tab:** sticky-modifier mobile key bar (Ctrl, Alt, Esc, Tab, arrows, PgUp/Dn, Home/End, common shell punctuation), quick-launcher chips (`claude`, `claude --continue`, `ls`, `git status`, `cd ..`, `^C`, `^D`, `clear`), paste-text modal for long input. **AI tab:** in-browser chat panel with provider picker + effort selector, streams over the same WebSocket using the desktop's configured providers (Claude / OpenAI / Copilot / Gemini / DeepSeek / Ollama). **Tools tab — multi-widget panel** with sub-selectors: System (live CPU/mem/uptime, 3 s poll), Ftermfetch (full host fingerprint with ASCII art), File Explorer (browse + tap-to-cat into terminal), Weather (wttr.in 3-day forecast), Ping (host reachability), Port Scanner (TCP probe with range syntax), Docker (list containers + start/stop/restart/remove), and Clipboard (read/write host clipboard, paste to terminal). Makes running Claude Code CLI plus most FTerm features from a phone practical.
- **Audio visualizer widget** — `viz [path]` / `visualizer [path]` opens a full-pane audio player with a real-time canvas visualizer. Supports MP3, FLAC, M4A/AAC, WAV, OGG. Features: 11 visualizer styles (bars, radial, warp, waterfall 3D, nebula, kaleid, crystal, Lorenz attractor, scope, wave, ASCII); shuffle and repeat (one / all) modes; queue management with drag-to-reorder; album art extracted from ID3v2/FLAC/MP4 tags or `cover`/`folder` image in the same directory; beat-detection that pulses the pet sprite in sync when "Pet vibe" is enabled (Settings → Pet). Music library root persists across sessions. Volume is persisted to `localStorage`.

### Fixed
- **xterm `Cannot read properties of undefined (reading 'dimensions')` crash** — `ptyCreate` resolves as a Promise microtask, causing `term.write(history)` to fire before the Canvas renderer's `requestAnimationFrame` initialization completes. Fixed by deferring the history write with `setTimeout(0)` so it runs as a macrotask, after the Canvas addon is fully wired.
- **Same xterm crash from `@xterm/addon-image`** — `ImageAddon` hooks into xterm's render pipeline and fires `Viewport.syncScrollArea` on scroll/resize events where `_renderService` can be undefined on backgrounded panes. Removed `ImageAddon` entirely since `imgcat` no longer uses inline OSC 1337 rendering.

## [0.1.2] — 2026-05-08

### Fixed
- **Window state not restored on restart:** FTerm now saves window position and size to `userData/window-state.json` on close/resize/move and restores them on next launch. Minimum 640×480 guard prevents corrupt state from blocking startup.
- **AI fix button visible in TUI/alt-screen mode:** the ✨ error-fix overlay is now suppressed while an alt-screen app (vim, claude, less, etc.) is active. Fixes phantom overlays on top of full-screen TUI apps.
- **Docker widget JSON parse crash:** `docker:ps` IPC handler now wraps each line's `JSON.parse` in try/catch and silently skips malformed lines instead of throwing.
- **ftermfetch uptime shows `0m` for fresh sessions:** uptime now shows seconds (`Xs`) when total uptime is under one minute; the `m` segment is omitted when hours or days dominate.
- **ftermfetch shell field missing:** `system:metrics` IPC now includes `shell` (`process.env.SHELL` / `process.env.ComSpec`) so the Shell field in the ftermfetch widget shows the real shell name.
- **ftermfetch custom color mode fallback:** color mode check now correctly reads the per-field color before falling back to the theme palette.
- **`window.__ftermActiveTerminal` untyped:** declared in `global.d.ts` as `Terminal | null | undefined` instead of implicit `any`.

## [0.1.1] — 2026-05-02

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
