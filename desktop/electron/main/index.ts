import {app, BrowserWindow, dialog, ipcMain, Menu} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import {PythonCore} from './core'
import {loadCredential, promptCredential, saveCredential} from './credentials'

const core = new PythonCore()
let window: BrowserWindow | undefined
let closing = false
const endpoints: Record<string, [string, string]> = {
  state: ['GET', '/game/state'], health: ['GET', '/health'], navigate: ['POST', '/game/navigate'],
  play: ['POST', '/game/play'], edit: ['POST', '/game/edit'], comment: ['POST', '/game/comment'],
  startEngine: ['POST', '/engine/start'], restartEngine: ['POST', '/engine/restart'], stopAnalysis: ['POST', '/analysis/stop'],
  analyze: ['POST', '/analysis/current'], analyzeMarker: ['POST', '/analysis/marker'],
  preview: ['POST', '/analysis/preview'], ask: ['POST', '/agent/ask'],
  settings: ['GET', '/settings'], updateSettings: ['POST', '/settings'],
  testKatago: ['POST', '/settings/test-katago'], testOpenAI: ['POST', '/settings/test-openai']
}

app.setName('LLMgo')
app.setAppUserModelId('app.llmgo.desktop')
if (process.env.LLMGO_USER_DATA) app.setPath('userData', process.env.LLMGO_USER_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {window?.show(); window?.focus()})
  app.whenReady().then(async () => {
    const directory = app.getPath('userData')
    await fs.mkdir(directory, {recursive: true})
    const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../..')
    await core.start(root, directory, await loadCredential(directory))
    window = new BrowserWindow({width: 1480, height: 980, minWidth: 1120, minHeight: 760, show: false,
      title: 'LLMgo', backgroundColor: '#f5f4ee', icon: path.join(root, 'assets', 'app.ico'),
      webPreferences: {preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}})
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    window.webContents.on('will-navigate', event => event.preventDefault())
    ipcMain.handle('llmgo:invoke', async (event, action: string, body?: unknown) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效窗口')
      if (action in endpoints) {
        if (action === 'updateSettings') {
          const input = body as Record<string, unknown>
          body = Object.fromEntries(['katago_executable', 'katago_model', 'katago_config', 'visits', 'openai_model', 'provider', 'base_url', 'sound_enabled', 'engine_threads', 'engine_gpu'].map(k => [k, input[k]]))
        }
        const [method, endpoint] = endpoints[action]
        return core.request(method, endpoint, body)
      }
      if (action === 'open' || action === 'drop') {
        let target: string | undefined
        if (action === 'drop') target = typeof body === 'string' ? body : undefined
        else {
          const result = await dialog.showOpenDialog(window!, {title: '打开棋谱', filters: [{name: 'SGF 棋谱', extensions: ['sgf']}], properties: ['openFile']})
          target = result.filePaths[0]
        }
        if (!target) return null
        if (path.extname(target).toLowerCase() !== '.sgf') throw new Error('请选择 SGF 棋谱')
        return core.request('POST', '/game/open', {path: target})
      }
      if (action === 'save' || action === 'saveAs') {
        if (action === 'save') {
          try {return await core.request('POST', '/game/save', {})} catch (error) {
            if (!(error as Error).message.includes('选择保存位置')) throw error
          }
        }
        const result = await dialog.showSaveDialog(window!, {title: '保存棋谱', defaultPath: 'LLMgo.sgf', filters: [{name: 'SGF 棋谱', extensions: ['sgf']}]})
        if (result.canceled || !result.filePath) return null
        return core.request('POST', '/game/save', {path: result.filePath})
      }
      if (action === 'choosePath') {
        const filters = body === 'model' ? [{name: 'KataGo 模型', extensions: ['gz', 'bin', 'txt']}]
          : body === 'config' ? [{name: '分析配置', extensions: ['cfg']}] : [{name: 'KataGo 引擎', extensions: ['exe']}]
        const result = await dialog.showOpenDialog(window!, {properties: ['openFile'], filters})
        return result.filePaths[0] || null
      }
      if (action === 'credential') {
        const key = await promptCredential()
        if (key === null) return {cancelled: true}
        await saveCredential(directory, key)
        return core.request('POST', '/settings/credential', {api_key: key})
      }
      throw new Error('不支持的操作')
    })
    const emit = (action: string) => () => window?.webContents.send('llmgo:menu', action)
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label: '文件', submenu: [{label: '打开 SGF', accelerator: 'CmdOrCtrl+O', click: emit('open')}, {label: '保存', accelerator: 'CmdOrCtrl+S', click: emit('save')}, {label: '另存为', accelerator: 'CmdOrCtrl+Shift+S', click: emit('saveAs')}, {type: 'separator'}, {role: 'quit', label: '退出'}]},
      {label: '分析', submenu: [{label: '分析当前局面', accelerator: 'F5', click: emit('analyze')}, {label: '启动/停止分析', accelerator: 'F6', click: emit('toggleAnalysis')}]},
      {label: '编辑', submenu: [{label: '撤销', accelerator: 'CmdOrCtrl+Z', click: emit('undo')}, {label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: emit('redo')}, {type: 'separator'}, {label: '删除当前节点', click: emit('deleteNode')}, {label: '删除当前分支', click: emit('deleteBranch')}]},
      {label: '设置', submenu: [{label: '引擎设置', click: emit('engineSettings')}, {label: 'AI / API 设置', click: emit('apiSettings')}, {label: '界面设置', click: emit('interfaceSettings')}]}
    ]))
    if (process.env.LLMGO_DEV_URL) await window.loadURL(process.env.LLMGO_DEV_URL)
    else await window.loadFile(path.join(__dirname, '../../renderer/index.html'))
    window.show()
  }).catch(async error => {
    dialog.showErrorBox('LLMgo 启动失败', String(error))
    await core.stop()
    closing = true
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (closing) return
    event.preventDefault()
    closing = true
    void core.stop().finally(() => app.quit())
  })
}
