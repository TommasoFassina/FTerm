/**
 * GitHub OAuth flows.
 *
 * Setup: Create a GitHub OAuth App at https://github.com/settings/developers
 * - For redirect flow: set Authorization callback URL to http://localhost
 *   (GitHub accepts any localhost port at runtime)
 * - For device flow: enable Device flow in OAuth App settings
 *
 * Scopes requested: (none needed for Copilot via token exchange)
 */
import * as http from 'http'
import * as net from 'net'
import * as crypto from 'crypto'
import { shell } from 'electron'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface OAuthTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

export async function startDeviceFlow(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: '' }),
  })
  if (!res.ok) throw new Error(`GitHub device flow failed: ${res.statusText}`)
  const data = await res.json() as DeviceCodeResponse
  // Open browser so user can enter the code
  shell.openExternal(data.verification_uri)
  return data
}

export async function pollForToken(
  clientId: string,
  deviceCode: string,
  intervalSec: number,
  expiresIn: number
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  while (Date.now() < deadline) {
    await delay(intervalSec * 1000)

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const data = await res.json() as OAuthTokenResponse
    if (data.access_token) return data.access_token
    if (data.error === 'access_denied') throw new Error('Access denied by user')
    if (data.error === 'expired_token') throw new Error('Device code expired')
    // 'authorization_pending' or 'slow_down' → keep polling
    if (data.error === 'slow_down') intervalSec += 5
  }

  throw new Error('Device flow timed out')
}

// ─── OAuth redirect flow ──────────────────────────────────────────────────────

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function waitForCode(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1:${port}`)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body>State mismatch — possible CSRF. Close this tab and try again.</body></html>')
        server.close()
        return reject(new Error('OAuth state mismatch'))
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body>No code received. Close this tab and try again.</body></html>')
        server.close()
        return reject(new Error('No code in callback'))
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:sans-serif;padding:2rem;background:#0d1117;color:#c9d1d9"><h2 style="color:#58a6ff">Authorized!</h2><p>You can close this tab and return to FTerm.</p></body></html>')
      server.close()
      resolve(code)
    })

    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('OAuth redirect timed out after 5 minutes'))
    }, 5 * 60 * 1000)

    server.on('close', () => clearTimeout(timeout))
    server.listen(port, '127.0.0.1')
  })
}

async function exchangeCodeForToken(clientId: string, code: string, redirectUri: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, code, redirect_uri: redirectUri }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.statusText}`)
  const data = await res.json() as OAuthTokenResponse
  if (!data.access_token) throw new Error(data.error_description ?? data.error ?? 'No token returned')
  return data.access_token
}

/**
 * Open browser to GitHub OAuth, wait for redirect callback, return access token.
 * GitHub allows http://localhost (any port) as a redirect URI when registered as http://localhost.
 */
export async function startRedirectFlow(
  clientId: string,
  onBrowserOpened?: () => void
): Promise<string> {
  const port = await getFreePort()
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://localhost:${port}/callback`

  const authUrl = `${AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=&state=${state}`

  // Start listening BEFORE opening the browser to avoid missing the redirect
  const codePromise = waitForCode(port, state)

  await shell.openExternal(authUrl)
  onBrowserOpened?.()

  const code = await codePromise
  return exchangeCodeForToken(clientId, code, redirectUri)
}

// ─── Copilot token exchange ───────────────────────────────────────────────────

let cachedCopilotToken = ''
let tokenExpirationTime = 0

export function clearCopilotToken(): void {
  cachedCopilotToken = ''
  tokenExpirationTime = 0
}

/**
 * Exchange a GitHub token for a short-lived Copilot API token.
 * This uses the same endpoint VS Code / JetBrains plugins use.
 */
export async function getCopilotToken(githubToken: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedCopilotToken && tokenExpirationTime > now + 300) {
    return cachedCopilotToken // return cached if valid for at least another 5 mins
  }

  const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      'Editor-Version': 'FTerm/0.1.0',
      'User-Agent': 'FTerm',
    },
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('GitHub token invalid or expired. Please re-authenticate.')
    }
    throw new Error(`Copilot token exchange failed: ${res.statusText}`)
  }
  const data = await res.json() as { token: string, expires_at: number }
  cachedCopilotToken = data.token
  tokenExpirationTime = data.expires_at // UNIX timestamp
  return cachedCopilotToken
}
