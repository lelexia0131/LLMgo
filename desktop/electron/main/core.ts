import {spawn, ChildProcess, execFile} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import path from 'node:path'
import fs from 'node:fs'

export class PythonCore {
  private child?: ChildProcess
  private token = randomBytes(32).toString('hex')
  private port = 0
  private errors = ''

  async start(root: string, directory: string, apiKey: string) {
    this.port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('无法分配本地端口'))
        const port = address.port
        server.close(() => resolve(port))
      })
    })
    const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const bundled = path.join(root, 'core', process.platform === 'win32' ? 'llmgo-core.exe' : 'llmgo-core')
    const useBundled = fs.existsSync(bundled)
    const python = useBundled ? bundled : process.env.LLMGO_PYTHON || (fs.existsSync(local) ? local : 'python')
    const args = [...(useBundled ? [] : ['-m', 'backend.main']), '--port', String(this.port), '--parent-pid', String(process.pid)]
    this.child = spawn(python, args, {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, PYTHONUTF8: '1', LLMGO_TOKEN: this.token, LLMGO_DATA_DIR: directory, OPENAI_API_KEY: apiKey}
    })
    this.child.on('error', error => {this.errors = error.message})
    this.child.stderr?.on('data', data => {this.errors = (this.errors + data.toString()).slice(-2500)})
    for (let i = 0; i < 120; i++) {
      if (this.child.exitCode !== null || this.errors.includes('ENOENT')) throw new Error(`Python 启动失败：${this.errors}`)
      try {await this.request('GET', '/health', undefined, 1000); return} catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`Python 启动超时。${this.errors}`)
  }

  async request(method: string, endpoint: string, body?: unknown, timeout = 330000): Promise<unknown> {
    const response = await fetch(`http://127.0.0.1:${this.port}${endpoint}`, {
      method, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout)
    })
    const data = await response.json() as {detail?: unknown}
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '请求参数无效')
    return data
  }

  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || !child.pid) return
    try {await this.request('POST', '/shutdown', undefined, 10000)} catch {}
    // The endpoint drains Agent/KataGo before the Python process is terminated.
    if (process.platform === 'win32') {
      await new Promise<void>(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, () => resolve()))
    } else child.kill('SIGTERM')
    if (child.exitCode === null) await new Promise<void>(resolve => child.once('exit', () => resolve()))
    this.child = undefined
  }
}
