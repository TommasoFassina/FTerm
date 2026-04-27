import * as http from 'http'
import * as net from 'net'
import * as os from 'os'
import * as crypto from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import QRCode from 'qrcode'

interface RemoteSession {
  ws: WebSocket
  ptyProcess: pty.IPty
}

let server: http.Server | null = null
let wss: WebSocketServer | null = null
let currentPin = ''
const tokens = new Map<string, boolean>() // token → valid
const sessions = new Set<RemoteSession>()
let mainWin: BrowserWindow | null = null

function generatePin(): string {
  // 6-digit PIN: 1,000,000 combinations vs old 10,000
  return String(crypto.randomInt(100000, 1000000))
}

function generateToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

// Per-IP brute-force lockout
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

function isLocked(ip: string): boolean {
  const rec = failedAttempts.get(ip)
  if (!rec) return false
  if (rec.lockedUntil > Date.now()) return true
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) failedAttempts.delete(ip)
  return false
}

function recordFailure(ip: string): void {
  const rec = failedAttempts.get(ip) ?? { count: 0, lockedUntil: 0 }
  rec.count += 1
  if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOCKOUT_MS
  failedAttempts.set(ip, rec)
}

function recordSuccess(ip: string): void {
  failedAttempts.delete(ip)
}

function getLocalIps(): string[] {
  const ips: string[] = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) ips.push(iface.address)
    }
  }
  return ips.length ? ips : ['127.0.0.1']
}

function getLocalIp(): string {
  return getLocalIps()[0]
}

async function allowFirewall(port: number): Promise<boolean> {
  if (process.platform !== 'win32') return true
  const { exec } = require('child_process') as typeof import('child_process')
  const ruleName = `FTerm Remote Terminal Port ${port}`
  const args = `advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`
  return new Promise<boolean>(resolve =>
    exec(`netsh ${args}`, (err) => resolve(!err))
  )
}

function getShell(): string {
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process')
      const out = execFileSync('where', ['pwsh.exe'], { timeout: 1000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
      if (out) return out.split('\n')[0].trim()
    } catch { /* not found */ }
    return 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

function broadcastClientCount() {
  mainWin?.webContents.send('remote:clients', sessions.size)
}

const CLIENT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover"/>
<title>FTerm Remote</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
#pin{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;padding:32px}
#pin h1{font-size:22px;font-weight:600}
#pin p{font-size:13px;color:#8b949e;text-align:center;max-width:260px}
#pin-input{width:160px;padding:12px 16px;border-radius:8px;border:1px solid #30363d;background:#161b22;color:#c9d1d9;font-size:24px;font-family:monospace;letter-spacing:.3em;text-align:center;outline:none}
#pin-input:focus{border-color:#58a6ff}
#pin-btn{padding:10px 28px;border-radius:8px;border:none;background:#238636;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
#pin-btn:disabled{opacity:.5}
#pin-err{color:#f85149;font-size:13px;min-height:18px;text-align:center}
#term{display:none;flex-direction:column;height:100%}
#bar{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#161b22;border-bottom:1px solid #30363d;font-size:12px;color:#8b949e;flex-shrink:0}
#disc{cursor:pointer;color:#f85149}
#out{flex:1;overflow-y:auto;padding:8px;font-family:'Fira Code','Cascadia Code','Courier New',monospace;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-all;background:#0d1117;-webkit-overflow-scrolling:touch}
#inp-row{display:flex;align-items:center;background:#161b22;border-top:1px solid #30363d;padding:6px 8px;flex-shrink:0}
#prompt{color:#3fb950;font-family:monospace;font-size:13px;margin-right:6px;flex-shrink:0}
#inp{flex:1;background:transparent;border:none;outline:none;color:#c9d1d9;font-family:'Fira Code','Cascadia Code','Courier New',monospace;font-size:13px;caret-color:#58a6ff}
#send-btn{padding:4px 10px;border-radius:6px;border:none;background:#238636;color:#fff;font-size:12px;cursor:pointer;flex-shrink:0;margin-left:6px}
</style>
</head>
<body>
<div id="pin">
  <h1>FTerm Remote</h1>
  <p>Enter the 6-digit PIN shown in the FTerm app</p>
  <input id="pin-input" type="tel" placeholder="000000" maxlength="6" autocomplete="off" inputmode="numeric"/>
  <div id="pin-err"></div>
  <button id="pin-btn">Connect</button>
</div>
<div id="term">
  <div id="bar"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;margin-right:6px"></span>Connected</span><span id="disc">Disconnect</span></div>
  <div id="out"></div>
  <div id="inp-row">
    <span id="prompt">$</span>
    <input id="inp" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="type command…"/>
    <button id="send-btn">Send</button>
  </div>
</div>
<script>
(function(){
var pinDiv=document.getElementById('pin'),termDiv=document.getElementById('term');
var pinInput=document.getElementById('pin-input'),pinBtn=document.getElementById('pin-btn'),pinErr=document.getElementById('pin-err');
var out=document.getElementById('out'),inp=document.getElementById('inp'),sendBtn=document.getElementById('send-btn'),disc=document.getElementById('disc');
var ws=null,ESC=/\\x1b(?:\\[[\\d;?]*[a-zA-Z]|\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|[()][A-Z0-9]|[=>78HMN])/g;

function strip(s){return s.replace(ESC,'').replace(/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]/g,'').replace(/\\r(?!\\n)/g,'').replace(/\\r\\n/g,'\\n')}
function append(text){
  var s=strip(text);if(!s)return;
  out.textContent+=s;
  out.scrollTop=out.scrollHeight;
}

async function connect(){
  var pin=pinInput.value.trim();
  if(pin.length<6){pinErr.textContent='Enter a 6-digit PIN';return}
  pinErr.textContent='';pinBtn.disabled=true;pinBtn.textContent='Connecting…';
  try{
    var r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})});
    var d=await r.json();
    if(!r.ok)throw new Error(d.error||'Auth failed');
    openTerm(d.token);
  }catch(e){pinErr.textContent=e.message;pinBtn.disabled=false;pinBtn.textContent='Connect'}
}

function openTerm(token){
  pinDiv.style.display='none';termDiv.style.display='flex';
  var proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(proto+'://'+location.host+'/api/terminal?token='+encodeURIComponent(token));
  ws.onopen=function(){inp.focus()};
  ws.onmessage=function(e){try{var m=JSON.parse(e.data);if(m.type==='data')append(m.data)}catch(ex){}};
  ws.onclose=function(){disconnect()};
  ws.onerror=function(){disconnect()};
}

function sendData(data){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'data',data:data}))}

function disconnect(){
  if(ws){try{ws.close()}catch(e){}}ws=null;
  termDiv.style.display='none';pinDiv.style.display='flex';
  pinInput.value='';pinBtn.disabled=false;pinBtn.textContent='Connect';
  pinErr.textContent='Disconnected.';out.textContent='';
}

inp.addEventListener('keydown',function(e){
  if(e.key==='Enter'){e.preventDefault();var v=inp.value;inp.value='';sendData(v+'\\r');return}
  if(e.key==='Backspace'&&inp.value===''){e.preventDefault();sendData('\\x7f');return}
  if(e.ctrlKey){
    if(e.key==='c'){e.preventDefault();sendData('\\x03');return}
    if(e.key==='d'){e.preventDefault();sendData('\\x04');return}
    if(e.key==='l'){e.preventDefault();out.textContent='';return}
    if(e.key==='u'){e.preventDefault();inp.value='';return}
  }
  if(e.key==='ArrowUp'){e.preventDefault();sendData('\\x1b[A');return}
  if(e.key==='ArrowDown'){e.preventDefault();sendData('\\x1b[B');return}
  if(e.key==='Tab'){e.preventDefault();sendData('\\t');return}
});
sendBtn.addEventListener('click',function(){var v=inp.value;inp.value='';sendData(v+'\\r')});
disc.addEventListener('click',disconnect);
pinBtn.addEventListener('click',connect);
pinInput.addEventListener('keydown',function(e){if(e.key==='Enter')connect()});
})();
</script>
</body>
</html>`

function serveClient(res: http.ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(CLIENT_HTML)
}

export async function start(port: number, win: BrowserWindow): Promise<{ pin: string; localIp: string; allIps: string[]; qr: string; firewallOk: boolean }> {
  if (server) await stop()

  mainWin = win
  currentPin = generatePin()
  tokens.clear()

  const firewallOk = await allowFirewall(port)

  const allIps = getLocalIps()
  const localIp = allIps[0]
  const url = `http://${localIp}:${port}`
  const qr = await QRCode.toDataURL(url, { width: 256, margin: 2 })

  server = http.createServer((req, res) => {
    // No CORS needed; client is same-origin. Prevent cross-origin attacks.
    // Authentication is PIN-based + per-token session.


    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      serveClient(res)
      return
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('pong')
      return
    }

    if (req.method === 'POST' && req.url === '/api/auth') {
      const ip = (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '')
      if (isLocked(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Too many failed attempts. Try again in 5 minutes.' }))
        return
      }
      // Reject body > 1KB
      let body = ''
      let aborted = false
      req.setTimeout(5000, () => {
        if (aborted) return
        aborted = true
        try { res.writeHead(408); res.end() } catch { /* ignore */ }
        try { req.destroy() } catch { /* ignore */ }
      })
      req.on('data', d => {
        if (aborted) return
        body += d
        if (body.length > 1024) {
          aborted = true
          try { res.writeHead(413); res.end() } catch { /* ignore */ }
          try { req.destroy() } catch { /* ignore */ }
        }
      })
      req.on('end', () => {
        if (aborted) return
        try {
          const { pin } = JSON.parse(body)
          if (typeof pin === 'string' && pin === currentPin) {
            recordSuccess(ip)
            const token = generateToken()
            tokens.set(token, true)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ token }))
          } else {
            recordFailure(ip)
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid PIN' }))
          }
        } catch {
          recordFailure(ip)
          res.writeHead(400)
          res.end()
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const urlObj = new URL(req.url ?? '/', `http://localhost`)
    const token = urlObj.searchParams.get('token')

    if (!token || !tokens.get(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    if (sessions.size >= 3) {
      socket.write('HTTP/1.1 503 Too many clients\r\n\r\n')
      socket.destroy()
      return
    }

    wss!.handleUpgrade(req, socket as net.Socket, head, (ws) => {
      wss!.emit('connection', ws, req)

      const cols = 80
      const rows = 24
      const shell = getShell()
      const isPwsh = shell.toLowerCase().includes('pwsh') || shell.toLowerCase().includes('powershell')
      const args = isPwsh ? ['-NoLogo', '-NoExit', '-Command',
        'function prompt { return "$(Get-Location)> " }; try { Set-PSReadLineOption -PredictionSource None -ErrorAction SilentlyContinue } catch {}'
      ] : []

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.USERPROFILE || process.env.HOME || '/',
        env: process.env as Record<string, string>,
      })

      const session: RemoteSession = { ws, ptyProcess }
      sessions.add(session)
      broadcastClientCount()

      ptyProcess.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }))
        }
      })

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw))
          if (msg.type === 'data') {
            ptyProcess.write(msg.data)
          } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
            ptyProcess.resize(Math.max(msg.cols, 10), Math.max(msg.rows, 5))
          }
        } catch { /* malformed message */ }
      })

      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        sessions.delete(session)
        broadcastClientCount()
        try { ptyProcess.kill() } catch { /* already dead */ }
      }

      ws.on('close', cleanup)
      ws.on('error', cleanup)
      ptyProcess.onExit(() => {
        if (!cleaned) {
          sessions.delete(session)
          broadcastClientCount()
        }
        if (ws.readyState === WebSocket.OPEN) ws.close()
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server!.listen(port, '0.0.0.0', () => resolve())
    server!.on('error', reject)
  })

  return { pin: currentPin, localIp, allIps, qr, firewallOk }
}

export async function stop(): Promise<void> {
  for (const s of sessions) {
    try { s.ws.close() } catch { /* ignore */ }
    try { s.ptyProcess.kill() } catch { /* ignore */ }
  }
  sessions.clear()
  broadcastClientCount()

  await new Promise<void>((resolve) => {
    wss?.close()
    wss = null
    server?.close(() => resolve())
    server = null
  })
  tokens.clear()
  failedAttempts.clear()
  currentPin = ''
  mainWin = null
}

export function getStatus(): { clients: number; localIp: string; allIps: string[] } {
  return { clients: sessions.size, localIp: getLocalIp(), allIps: getLocalIps() }
}
