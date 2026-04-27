import type { CommandEvent } from '../../src/services/TerminalRecorder'

export interface Scene {
  startTime: number
  endTime: number
  type: 'command_input' | 'command_execution' | 'long_output' | 'error'
  zoomRect?: { x: number; y: number; width: number; height: number }
  description: string
}

export function detectScenes(events: CommandEvent[], _totalDuration: number): Scene[] {
  const scenes: Scene[] = []
  let lastCmdStart = 0

  for (const ev of events) {
    if (ev.type === 'command_start') {
      lastCmdStart = ev.timestamp
    } else if (ev.type === 'command_end' && ev.command) {
      scenes.push({
        startTime: lastCmdStart,
        endTime: ev.timestamp + 500,
        type: 'command_input',
        description: `Command: ${ev.command}`,
      })
    } else if (ev.type === 'output_line' && ev.isError) {
      scenes.push({
        startTime: ev.timestamp - 200,
        endTime: ev.timestamp + 2000,
        type: 'error',
        description: `Error: ${ev.outputLine}`,
      })
    }
  }

  return scenes
}
