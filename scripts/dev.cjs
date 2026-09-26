const {spawn} = require('node:child_process')
const path = require('node:path')
const children = []
const run = (file, args, env = {}) => {
  const child = spawn(process.execPath, [file, ...args], {stdio: 'inherit', env: {...process.env, ...env}})
  children.push(child)
  return child
}
const tsc = run(require.resolve('typescript/bin/tsc'), ['-p', 'desktop/electron/tsconfig.json'])
tsc.on('exit', async code => {
  if (code) return process.exit(code)
  const vite = run(path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), [])
  for (let i = 0; i < 80; i++) {
    try {await fetch('http://127.0.0.1:5173'); break} catch {await new Promise(r => setTimeout(r, 250))}
  }
  const electronEnv = {...process.env, LLMGO_DEV_URL: 'http://127.0.0.1:5173'}
  delete electronEnv.ELECTRON_RUN_AS_NODE
  const electron = spawn(require('electron'), ['.'], {stdio: 'inherit', env: electronEnv})
  children.push(electron)
  electron.on('exit', () => {vite.kill(); process.exit()})
})
process.on('SIGINT', () => {for (const child of children) child.kill(); process.exit()})
