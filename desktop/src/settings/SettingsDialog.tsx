import {useEffect, useState} from 'react'
import {invoke} from '../api/client'
import type {Settings} from '../api/types'

export function SettingsDialog({onClose, onSaved}: {onClose: () => void; onSaved: () => void}) {
  const [value, setValue] = useState<Settings | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {void invoke<Settings>('settings').then(setValue).catch(e => setMessage(String(e)))}, [])
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try {await fn()} catch (error) {setMessage((error as Error).message)} finally {setBusy(false)}
  }
  const save = async () => {
    if (!value) return
    setValue(await invoke<Settings>('updateSettings', value)); onSaved()
  }
  const choose = (key: 'katago_executable' | 'katago_model' | 'katago_config', kind: string) => action(async () => {
    const file = await invoke<string | null>('choosePath', kind)
    if (file) setValue(v => v ? {...v, [key]: file} : v)
  })
  return <div className="modal-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div className="dialog-heading"><div><span className="eyebrow">LLMgo · 偏好设置</span><h2 id="settings-title">连接你的围棋助教</h2></div><button onClick={onClose} disabled={busy} aria-label="关闭设置">×</button></div>
    {value && <>
      <h3>KataGo 引擎</h3><p className="muted">自动发现本机引擎，也可以手动选择其他安装位置。</p>
      <label>发现的引擎<select value={value.engines.some(e => e.executable === value.katago_executable) ? value.katago_executable : ''} disabled={busy} onChange={event => {
        const engine = value.engines.find(e => e.executable === event.target.value)
        if (engine) setValue({...value, katago_executable: engine.executable, katago_model: engine.models[0] || '', katago_config: engine.configs[0] || ''})
      }}><option value="">手动选择</option>{value.engines.map(e => <option key={e.executable} value={e.executable}>{e.name}</option>)}</select></label>
      {([['katago_executable', '执行程序', 'executable'], ['katago_model', '模型文件', 'model'], ['katago_config', '分析配置', 'config']] as const).map(([key, label, kind]) =>
        <label key={key}>{label}<div className="path-field"><input value={value[key]} disabled={busy} onChange={e => setValue({...value, [key]: e.target.value})}/><button disabled={busy} onClick={() => void choose(key, kind)}>选择</button></div></label>)}
      <div className="settings-row"><label>默认 visits<input type="number" min={16} max={100000} value={value.visits} disabled={busy} onChange={e => setValue({...value, visits: Number(e.target.value)})}/></label>
        <button className="secondary" disabled={busy} onClick={() => void action(async () => {await save(); const result = await invoke<{visits: number}>('testKatago'); setMessage(`KataGo 真实分析成功 · ${result.visits} visits`)})}>测试 KataGo</button></div>
      <hr/><h3>OpenAI</h3><div className="settings-row"><label>API Key<span className="key-state">{value.has_api_key ? '● 已配置，密钥已隐藏' : '尚未配置'}</span></label>
        <button className="secondary" disabled={busy} onClick={() => void action(async () => {await invoke('credential'); setValue(await invoke<Settings>('settings')); setMessage('密钥由系统窗口管理，留空保存可清除。')})}>设置 API Key</button></div>
      <label>模型<input value={value.openai_model} disabled={busy} onChange={e => setValue({...value, openai_model: e.target.value})}/></label>
      <p className="muted">密钥通过系统窗口输入并加密保存。Test GPT 会发送一次真实请求。</p>
      <div className="dialog-actions"><button className="secondary" disabled={busy} onClick={() => void action(async () => {await save(); const result = await invoke<{model: string}>('testOpenAI'); setMessage(`GPT 真实请求成功 · ${result.model}`)})}>Test GPT</button>
        <button className="primary" disabled={busy} onClick={() => void action(async () => {await save(); setMessage('设置已保存')})}>保存设置</button></div>
    </>}
    {(message || busy) && <div className="settings-message" role="status">{busy ? '正在连接，请稍候…' : message}</div>}
  </section></div>
}
