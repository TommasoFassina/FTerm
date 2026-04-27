import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function generateSpeech(text: string, outputWavPath: string): Promise<void> {
  // Windows SAPI via PowerShell
  const safeText = text.replace(/'/g, "''").replace(/"/g, '`"').replace(/\n/g, ' ')
  const psCommand = [
    `Add-Type -AssemblyName System.Speech;`,
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`,
    `$s.SetOutputToWaveFile('${outputWavPath.replace(/\\/g, '\\\\')}');`,
    `$s.Speak('${safeText}');`,
    `$s.Dispose()`,
  ].join(' ')

  await execAsync(`powershell -NoProfile -Command "${psCommand}"`)
}
