import type { PetState } from '@/types'

export interface Reaction {
  state: PetState
  /** How long to hold this state before returning to idle (ms). 0 = hold until next reaction. */
  duration: number
  /** Context label used by pet dialogue system */
  label: string
}

const PATTERNS: Array<{ re: RegExp; reaction: Reaction }> = [
  // Errors
  { re: /error|Error|ERROR|exception|Exception|FAILED|fail:/i, reaction: { state: 'sad', duration: 4000, label: 'error' } },
  { re: /Permission denied|EACCES|Access is denied/i, reaction: { state: 'sad', duration: 3000, label: 'permission' } },
  { re: /cannot find|not found|No such file|ENOENT/i, reaction: { state: 'worried', duration: 3000, label: 'not_found' } },
  { re: /command not found|is not recognized|CommandNotFoundException|non .{0,15}riconosciuto|nicht erkannt|no se reconoce|n.{0,5}est pas reconnu/i, reaction: { state: 'worried', duration: 3000, label: 'cmd_not_found' } },
  { re: /timed? out|ETIMEDOUT|connection refused|ECONNREFUSED/i, reaction: { state: 'sad', duration: 4000, label: 'timeout' } },
  { re: /Killed|Segmentation fault|core dumped|signal \d+/i, reaction: { state: 'sad', duration: 5000, label: 'crashed' } },
  { re: /No space left|disk full|ENOSPC/i, reaction: { state: 'sad', duration: 5000, label: 'disk_full' } },
  { re: /out of memory|OOM|Cannot allocate/i, reaction: { state: 'sad', duration: 5000, label: 'oom' } },

  // Warnings
  { re: /warn(?:ing)?:|deprecated|WARN/i, reaction: { state: 'worried', duration: 3000, label: 'warning' } },

  // Installing / waiting
  { re: /npm (install|i |ci)|yarn (install|add)|pnpm (install|add)/, reaction: { state: 'worried', duration: 0, label: 'npm_install' } },
  { re: /pip install|poetry install|uv (add|sync)/, reaction: { state: 'worried', duration: 0, label: 'pip_install' } },
  { re: /cargo (build|install|add)/, reaction: { state: 'worried', duration: 0, label: 'cargo' } },
  { re: /docker (build|pull|run)/i, reaction: { state: 'working', duration: 0, label: 'docker' } },
  { re: /make( all| install| clean)?|cmake|gradle|mvn /i, reaction: { state: 'working', duration: 0, label: 'make' } },
  { re: /git (clone|fetch)/, reaction: { state: 'working', duration: 0, label: 'git_clone' } },
  { re: /git pull/, reaction: { state: 'working', duration: 3000, label: 'git_pull' } },
  { re: /git rebase/, reaction: { state: 'worried', duration: 0, label: 'git_rebase' } },
  { re: /git reset/, reaction: { state: 'worried', duration: 3000, label: 'git_reset' } },
  { re: /git stash/, reaction: { state: 'happy', duration: 2500, label: 'git_stash' } },
  { re: /pytest|jest|vitest|mocha|go test|cargo test|npm (run )?test/, reaction: { state: 'working', duration: 0, label: 'test_running' } },
  { re: /ssh |scp |sftp /, reaction: { state: 'working', duration: 0, label: 'ssh' } },
  { re: /curl |wget /, reaction: { state: 'working', duration: 0, label: 'network_req' } },

  // Success
  { re: /tests? passed|all tests|✓|✔|done\.|success/i, reaction: { state: 'celebrating', duration: 4000, label: 'tests_passed' } },
  { re: /\d+ passed/, reaction: { state: 'celebrating', duration: 4000, label: 'tests_passed' } },
  { re: /build succeeded|compiled successfully|Build complete/i, reaction: { state: 'celebrating', duration: 5000, label: 'build_success' } },
  { re: /Deployed|deployment succeeded/i, reaction: { state: 'celebrating', duration: 5000, label: 'deployed' } },

  // Git
  { re: /git push/, reaction: { state: 'happy', duration: 3000, label: 'git_push' } },
  { re: /git commit/, reaction: { state: 'happy', duration: 3000, label: 'git_commit' } },
  { re: /git merge|Merge made/i, reaction: { state: 'happy', duration: 3000, label: 'git_merge' } },
  { re: /CONFLICT|merge conflict/i, reaction: { state: 'sad', duration: 5000, label: 'merge_conflict' } },
  { re: /Already up to date|nothing to commit/i, reaction: { state: 'happy', duration: 2500, label: 'git_clean' } },
  { re: /HEAD detached/i, reaction: { state: 'worried', duration: 4000, label: 'git_detached' } },
  { re: /force.push|push.*--force/i, reaction: { state: 'worried', duration: 4000, label: 'git_force_push' } },
  { re: /git (diff|log|show)/, reaction: { state: 'working', duration: 2000, label: 'git_inspect' } },

  // Editing / opening
  { re: /^(vim|nvim|nano|emacs|code|notepad) /i, reaction: { state: 'working', duration: 0, label: 'editor' } },

  // Running scripts
  { re: /^(python|python3|node|ruby|php|perl|bun) /i, reaction: { state: 'working', duration: 0, label: 'script_run' } },

  // Dangerous operations
  { re: /rm -rf|Remove-Item.*-Recurse.*-Force/i, reaction: { state: 'worried', duration: 5000, label: 'rm_rf' } },
  { re: /drop (table|database)|truncate table/i, reaction: { state: 'worried', duration: 5000, label: 'db_destroy' } },

  // Searching
  { re: /grep -r|find \.|rg |ripgrep/, reaction: { state: 'working', duration: 2000, label: 'searching' } },

  // Long operations finishing
  { re: /\d+ (packages? (audited|installed)|modules? (added|updated))/i, reaction: { state: 'happy', duration: 3000, label: 'install_done' } },
  { re: /found \d+ vulnerabilit/i, reaction: { state: 'worried', duration: 5000, label: 'npm_vuln' } },
  { re: /no vulnerabilities found|0 vulnerabilities/i, reaction: { state: 'happy', duration: 3000, label: 'npm_safe' } },

  // Shell prompt reappeared → command finished
  { re: /[$#>]\s*$/, reaction: { state: 'idle', duration: 0, label: 'idle' } },
]

export function analyzeOutput(data: string): Reaction | null {
  for (const { re, reaction } of PATTERNS) {
    if (re.test(data)) return reaction
  }
  return null
}

export function isErrorOutput(data: string): boolean {
  for (const { re, reaction } of PATTERNS) {
    if (reaction.state === 'sad' || reaction.label.includes('not_found')) {
      if (re.test(data)) return true
    }
  }
  return false
}

/* ── reactions from real exit codes ─────────────────────────────────────── */

/**
 * Labels `reactToExit` decides once a pane's shell reports exit codes
 * (OSC 133;D). The output-text guesses for these are ignored in that pane:
 * "0 errors" in a passing build no longer makes the pet sad, and a passing
 * test run is not rewarded twice (once for the text, once for the code).
 */
export const EXIT_OWNED_LABELS = new Set([
  'error', 'permission', 'not_found', 'cmd_not_found', 'timeout', 'crashed', 'disk_full', 'oom',
  'tests_passed', 'build_success', 'git_push', 'git_commit', 'git_merge',
])

/** A long command finishing is worth a cheer on its own. */
export const LONG_COMMAND_MS = 60_000

const TEST_CMD = /\b(pytest|jest|vitest|mocha|go test|cargo test|dotnet test|(npm|pnpm|yarn|bun)( run)? test)\b/
const BUILD_CMD = /\b((npm|pnpm|yarn|bun)( run)? build|cargo build|go build|dotnet build|make|cmake --build|gradle|mvn|tsc)\b/

/** Signed 32-bit NTSTATUS codes arrive as either sign depending on the shell. */
const u32 = (n: number) => n >>> 0

/**
 * The pet's reaction to a finished command, judged by its exit code rather
 * than its output. `null` means "nothing worth reacting to" — the caller
 * settles the pet back to idle.
 */
export function reactToExit(cmd: { command: string; exitCode: number | null; durationMs: number | null }): Reaction | null {
  const { exitCode, durationMs } = cmd
  if (exitCode === null) return null
  const command = cmd.command.trim()

  if (exitCode === 0) {
    if (TEST_CMD.test(command)) return { state: 'celebrating', duration: 4000, label: 'tests_passed' }
    if (BUILD_CMD.test(command)) return { state: 'celebrating', duration: 4000, label: 'build_success' }
    if (/^git push\b/.test(command)) return { state: 'happy', duration: 3000, label: 'git_push' }
    if (/^git commit\b/.test(command)) return { state: 'happy', duration: 3000, label: 'git_commit' }
    if (/^git merge\b/.test(command)) return { state: 'happy', duration: 3000, label: 'git_merge' }
    if ((durationMs ?? 0) >= LONG_COMMAND_MS) return { state: 'happy', duration: 4000, label: 'long_done' }
    return null
  }

  const code = u32(exitCode)
  // Ctrl+C: the user stopped it, nothing failed. 130 = 128 + SIGINT;
  // 0xC000013A = STATUS_CONTROL_C_EXIT on Windows.
  if (exitCode === 130 || code === 0xC000013A) return null
  // 127 (POSIX) / 9009 (cmd) — the command does not exist.
  if (exitCode === 127 || exitCode === 9009) return { state: 'worried', duration: 3000, label: 'cmd_not_found' }
  // 126 — found but not executable.
  if (exitCode === 126) return { state: 'sad', duration: 3000, label: 'permission' }
  // Killed by a signal (137 SIGKILL, 139 SIGSEGV…) or a Windows crash status
  // (0xC0000005 access violation, 0xC00000FD stack overflow, …).
  if ((exitCode > 128 && exitCode < 160) || (code >= 0xC0000000 && code <= 0xCFFFFFFF)) {
    return { state: 'sad', duration: 5000, label: 'crashed' }
  }
  return { state: 'sad', duration: 4000, label: 'error' }
}
