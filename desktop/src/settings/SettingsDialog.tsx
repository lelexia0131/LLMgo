import {useEffect, useState} from 'react'
import {invoke} from '../api/client'
import type {Settings} from '../api/types'

export type SettingsTab = 'engine' | 'api' | 'interface'
const tabs: Record<SettingsTab, string> = {engine: '引擎设置', api: 'AI / API 设置', interface: '界面设置'}
const presets = {openai: {base_url: 'https://api.openai.com/v1', openai_model: 'gpt-5.6'}, deepseek: {base_url: 'https://api.deepseek.com', openai_model: 'deepseek-chat'}, compatible: {base_url: 'http://localhost:8000/v1', openai_model: ''}}
export function SettingsDialog({initialTab, numbers, onNumbers, beforeSave, onClose, onSaved}: {initialTab: SettingsTab; numbers: Settings['move_number_mode']; onNumbers: (mode: Settings['move_number_mode']) => void; beforeSave: () => Promise<void>; onClose: () => void; onSaved: (value: Settings) => void}) {
  const [tab, setTab] = useState(initialTab)
  const [value, setValue] = useState<Settings | null>(null)
  const [health, setHealth] = useState<{katago: string; error: string; logs: string[]}>({katago: 'starting', error: '', logs: []})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {void invoke<Settings>('settings').then(setValue).catch(e => setMessage(String(e)))}, [])
  useEffect(() => {
    const poll = () => void invoke<typeof health>('health').then(setHealth).catch(e => setMessage(String(e)))
    poll(); const timer = window.setInterval(poll, 1500)
    return () => window.clearInterval(timer)
  }, [])
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try {await fn()} catch (error) {setMessage((error as Error).message)} finally {setBusy(false)}
  }
  const save = async () => {
    if (!value) return
    await beforeSave()
    const saved = await invoke<Settings>('updateSettings', {...value, move_number_mode: numbers})
    setValue(saved); onSaved(saved)
  }
  const choose = (key: 'katago_executable' | 'katago_model' | 'katago_config', kind: string) => action(async () => {
    const file = await invoke<string | null>('choosePath', kind)
    if (file) setValue(v => v ? {...v, [key]: file} : v)
  })
  return <div className="modal-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div className="dialog-heading"><h2 id="settings-title">{tabs[tab]}</h2><button onClick={onClose} disabled={busy} aria-label="关闭设置">×</button></div>
    <nav className="settings-tabs">{(Object.keys(tabs) as SettingsTab[]).map(key => <button key={key} aria-pressed={tab === key} disabled={busy} onClick={() => setTab(key)}>{tabs[key]}</button>)}</nav>
    {value && <>
      {tab === 'engine' && <>
        <label>Backend / 发现的引擎<select value={value.engines.some(e => e.executable === value.katago_executable) ? value.katago_executable : ''} disabled={busy} onChange={event => {
          const engine = value.engines.find(e => e.executable === event.target.value)
          if (engine) setValue({...value, katago_executable: engine.executable, katago_model: engine.models[0] || '', katago_config: engine.configs[0] || ''})
        }}><option value="">手动选择</option>{value.engines.map(e => <option key={e.executable} value={e.executable}>{e.name}</option>)}</select></label>
        {([['katago_executable', '执行程序', 'executable'], ['katago_model', '模型文件', 'model'], ['katago_config', '分析配置', 'config']] as const).map(([key, label, kind]) =>
          <label key={key}>{label}<div className="path-field"><input value={value[key]} disabled={busy} onChange={e => setValue({...value, [key]: e.target.value})}/><button disabled={busy} onClick={() => void choose(key, kind)}>选择</button></div></label>)}
        <div className="settings-row"><label>Threads（0 使用配置）<input type="number" min={0} max={256} value={value.engine_threads} disabled={busy} onChange={e => setValue({...value, engine_threads: Number(e.target.value)})}/></label><label>GPU（-1 自动）<input type="number" min={-1} max={32} value={value.engine_gpu} disabled={busy} onChange={e => setValue({...value, engine_gpu: Number(e.target.value)})}/></label></div>
        <label>默认 visits<input type="number" min={16} max={100000} value={value.visits} disabled={busy} onChange={e => setValue({...value, visits: Number(e.target.value)})}/></label>
        <p role="status">KataGo {({starting: '启动中', ready: '就绪', error: '错误', stopped: '未启动'} as Record<string, string>)[health.katago]} {health.error}</p>
        <div className="dialog-actions"><button disabled={busy} onClick={() => void action(async () => {await save(); await invoke('restartEngine'); setMessage('正在重新初始化 KataGo')})}>重启引擎</button><button disabled={busy} onClick={() => void action(async () => {await save(); const result = await invoke<{visits: number}>('testKatago'); setMessage(`真实分析成功 · ${result.visits} visits`)})}>测试 KataGo</button></div>
        <details><summary>引擎日志</summary><pre className="engine-log">{health.logs.join('\n') || '—'}</pre></details>
      </>}
      {tab === 'api' && <>
        <label>Provider<select value={value.provider} disabled={busy} onChange={e => {const provider = e.target.value as Settings['provider']; setValue({...value, provider, ...presets[provider]})}}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="compatible">OpenAI Compatible</option></select></label>
        <label>Base URL<input value={value.base_url} disabled={busy} onChange={e => setValue({...value, base_url: e.target.value})}/></label>
        <label>Model<input value={value.openai_model} disabled={busy} onChange={e => setValue({...value, openai_model: e.target.value})}/></label>
        <div className="settings-row"><label>API Key<span className="key-state">{value.has_api_key ? '已配置，密钥已隐藏' : '尚未配置'}</span></label><button disabled={busy} onClick={() => void action(async () => {const result = await invoke<{saved: boolean}>('credential'); if (!result.saved) return; const saved = await invoke<Settings>('settings'); setValue({...value, has_api_key: saved.has_api_key})})}>设置 API Key</button></div>
        <p className="muted">密钥由系统窗口输入并加密保存；切换 Provider 后请设置对应服务的密钥。</p>
        <button disabled={busy} onClick={() => void action(async () => {await save(); const result = await invoke<{model: string}>('testOpenAI'); setMessage(`连接成功 · ${result.model}`)})}>测试连接</button>
      </>}
      {tab === 'interface' && <>
        <label>手数显示<select value={numbers} disabled={busy} onChange={e => onNumbers(e.target.value as Settings['move_number_mode'])}><option value="off">关闭</option><option value="latest">最新</option><option value="all">全部</option></select></label>
        <label>落子音效<select value={String(value.sound_enabled)} disabled={busy} onChange={e => setValue({...value, sound_enabled: e.target.value === 'true'})}><option value="true">开</option><option value="false">关</option></select></label>
      </>}
      <div className="dialog-actions"><button className="primary" disabled={busy} onClick={() => void action(async () => {await save(); setMessage('设置已保存')})}>保存设置</button></div>
    </>}
    {(message || busy) && <div className="settings-message" role="status">{busy ? '正在处理…' : message}</div>}
  </section></div>
}
