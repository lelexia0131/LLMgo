import {safeStorage} from 'electron'
import {spawn} from 'node:child_process'
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

export async function promptCredential(): Promise<string | null> {
  if (process.platform !== 'win32') throw new Error('此版本的原生密钥窗口支持 Windows；其他平台请设置 OPENAI_API_KEY 环境变量')
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'LLMgo - LLM API Key'
$form.Size = New-Object System.Drawing.Size(490,175)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'LLM API Key (stored encrypted for this Windows user)'
$label.SetBounds(18,16,450,25)
$box = New-Object System.Windows.Forms.TextBox
$box.UseSystemPasswordChar = $true
$box.SetBounds(18,47,440,25)
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Save'
$ok.SetBounds(275,88,85,28)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.SetBounds(373,88,85,28)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.AddRange(@($label,$box,$ok,$cancel))
$form.AcceptButton = $ok
$form.CancelButton = $cancel
if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Write($box.Text)
  exit 0
}
exit 2
`
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true})
    let secret = ''
    child.stdout.on('data', data => {secret += data.toString()})
    child.on('error', () => reject(new Error('无法打开系统凭据窗口')))
    child.on('close', code => code === 0 ? resolve(secret.trim()) : code === 2 ? resolve(null) : reject(new Error('系统凭据窗口异常退出')))
  })
}
