// CSI, OSC, and single-character escape sequences. Tool output is plain text, not a terminal.
const ANSI = /[\u001B\u009B](?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g

export function stripAnsi(value: string) {
  return value.replace(ANSI, '').replace(/\r\n?/g, '\n')
}
