import {contextBridge, ipcRenderer, webUtils} from 'electron'

const allowed = new Set(['state', 'health', 'navigate', 'play', 'edit', 'comment', 'startEngine', 'restartEngine', 'stopAnalysis', 'analyze', 'analyzeMarker', 'preview', 'ask', 'settings', 'updateSettings', 'testKatago', 'testOpenAI', 'open', 'save', 'saveAs', 'choosePath', 'credential'])
contextBridge.exposeInMainWorld('llmgo', {
  invoke: (action: string, body?: unknown) => {
    if (!allowed.has(action)) return Promise.reject(new Error('不支持的操作'))
    return ipcRenderer.invoke('llmgo:invoke', action, body)
  },
  openDropped: (file: File) => ipcRenderer.invoke('llmgo:invoke', 'drop', webUtils.getPathForFile(file)),
  onMenu: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('llmgo:menu', handler)
    return () => ipcRenderer.removeListener('llmgo:menu', handler)
  }
})
