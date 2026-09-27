import {BrowserWindow, safeStorage} from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function loadCredential(directory: string): Promise<string> {
  try {return safeStorage.decryptString(await fs.readFile(path.join(directory, 'openai-key.enc')))}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return process.env.OPENAI_API_KEY || ''
    throw new Error('已保存的 API Key 无法解密，请检查当前 Windows 用户')
  }
}

export async function saveCredential(directory: string, key: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统没有可用的凭据加密服务')
  const target = path.join(directory, 'openai-key.enc')
  if (!key) {await fs.rm(target, {force: true}); return}
  await fs.writeFile(target, safeStorage.encryptString(key))
}

let credentialWindow: BrowserWindow | undefined
let pendingCredential: Promise<string | null> | undefined

export function promptCredential(parent: BrowserWindow): Promise<string | null> {
  if (pendingCredential) {
    credentialWindow?.show()
    credentialWindow?.focus()
    return pendingCredential
  }
  pendingCredential = new Promise<string | null>((resolve, reject) => {
    let child: BrowserWindow | undefined
    let settled = false
    const finish = (key: string | null, error?: Error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(key)
      if (child && !child.isDestroyed()) child.destroy()
    }
    try {
      child = new BrowserWindow({parent, modal: true, width: 490, height: 230, resizable: false, show: false,
        title: 'API Key', titleBarStyle: 'hidden', titleBarOverlay: true,
        webPreferences: {preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}})
      credentialWindow = child
      child.setMenu(null)
      child.on('close', () => finish(null))
      child.on('closed', () => finish(null))
      child.on('unresponsive', () => finish(null, new Error('凭据窗口没有响应，请重试')))
      child.webContents.on('render-process-gone', () => finish(null, new Error('凭据窗口异常退出')))
      child.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
      child.webContents.on('will-navigate', event => event.preventDefault())
      child.webContents.on('ipc-message', (event, channel, key: unknown) => {
        if (channel !== 'llmgo:credential' || event.senderFrame !== child?.webContents.mainFrame) return
        if (key === null || typeof key === 'string') finish(key === null ? null : key.trim())
      })
      const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'">
<style>body{font:14px system-ui;margin:40px 24px 24px}input{box-sizing:border-box;width:100%;margin:12px 0;padding:8px}footer{text-align:right}button{margin-left:8px;padding:6px 20px}</style>
<form id="credential-form"><label for="api-key">API Key（仅为当前用户加密保存）</label>
<input id="api-key" type="password" autocomplete="off" autofocus>
<footer><button id="credential-cancel" type="button">取消</button><button type="submit">保存</button></footer></form></html>`
      void child.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
        if (!settled) {child!.show(); child!.focus()}
      }).catch(() => finish(null, new Error('无法打开凭据窗口')))
    } catch {finish(null, new Error('无法打开凭据窗口'))}
  }).finally(() => {credentialWindow = undefined; pendingCredential = undefined})
  return pendingCredential
}
