/**
 * Generic PKCE OAuth 2.0 redirect flow with a local HTTP callback server.
 * Works for any provider that supports the Authorization Code + PKCE grant.
 */
import { createServer } from 'http'
import { createHash, randomBytes } from 'crypto'
import { shell } from 'electron'
import { URL } from 'url'

export interface PKCEConfig {
  authUrl:   string
  tokenUrl:  string
  clientId:  string
  scopes:    string[]
}

function codeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export async function startPKCEFlow(config: PKCEConfig): Promise<string> {
  const verifier  = codeVerifier()
  const challenge = codeChallenge(verifier)
  const state     = randomBytes(16).toString('hex')

  return new Promise((resolve, reject) => {
    let port = 0

    const server = createServer((req, res) => {
      const url   = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      const code  = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const ret   = url.searchParams.get('state')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>❌ Authentication failed.</h2></body></html>')
        server.close()
        reject(new Error(`OAuth error: ${error}`))
        return
      }
      if (ret !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>❌ State mismatch.</h2></body></html>')
        server.close()
        reject(new Error('State mismatch — possible CSRF'))
        return
      }
      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>❌ No code received.</h2></body></html>')
        server.close()
        reject(new Error('No authorisation code received'))
        return
      }

      // Exchange authorisation code for access token — close server only after exchange completes
      fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type:    'authorization_code',
          client_id:     config.clientId,
          code,
          redirect_uri:  `http://127.0.0.1:${port}/callback`,
          code_verifier: verifier,
        }),
      })
        .then(r => r.json() as Promise<{ access_token?: string; error?: string; api_key?: string }>)
        .then(data => {
          const token = data.access_token ?? data.api_key
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          if (token) {
            res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>✅ Authenticated — you can close this tab.</h2></body></html>')
            server.close()
            resolve(token)
          } else {
            res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>❌ Token exchange failed.</h2></body></html>')
            server.close()
            reject(new Error(data.error ?? 'Token exchange failed'))
          }
        })
        .catch(err => {
          res.writeHead(500)
          res.end()
          server.close()
          reject(err)
        })
    })

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port

      const params = new URLSearchParams({
        response_type:         'code',
        client_id:             config.clientId,
        redirect_uri:          `http://127.0.0.1:${port}/callback`,
        scope:                 config.scopes.join(' '),
        state,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
      })

      shell.openExternal(`${config.authUrl}?${params}`)
    })

    server.on('error', reject)

    // 5-minute timeout
    setTimeout(() => { server.close(); reject(new Error('OAuth flow timed out after 5 minutes')) }, 5 * 60_000)
  })
}
