import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** PowerShell single-quoted string literal: only `'` is special (doubled). No other
 *  metacharacter is interpreted inside single quotes, so this fully neutralizes input. */
function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export async function generateSpeech(text: string, outputWavPath: string): Promise<void> {
  // Windows SAPI via PowerShell. Run via execFile (NO shell / cmd.exe layer), passing the
  // command as a single argument — eliminates the command-injection surface entirely.
  const cleanText = text.replace(/[\r\n]+/g, ' ')
  const psCommand = [
    `Add-Type -AssemblyName System.Speech;`,
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`,
    `$s.SetOutputToWaveFile(${psSingleQuote(outputWavPath)});`,
    `$s.Speak(${psSingleQuote(cleanText)});`,
    `$s.Dispose()`,
  ].join(' ')

  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
    windowsHide: true,
  })
}
