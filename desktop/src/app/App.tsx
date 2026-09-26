import {useCallback, useEffect, useRef, useState} from 'react'
import {invoke} from '../api/client'
import type {Analysis, AnalysisResult, GameContext, Preview, Reply} from '../api/types'
import {Board} from '../board/Board'
import {GameTree} from '../gametree/GameTree'
import {Candidates, percent, score} from '../analysis/Candidates'
import {Teacher} from '../teacher/Teacher'
import {SettingsDialog} from '../settings/SettingsDialog'

export function App() {
  const [game, setGame] = useState<GameContext | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [reply, setReply] = useState<Reply | null>(null)
  const [question, setQuestion] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [numbers, setNumbers] = useState(false)
  const [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [engine, setEngine] = useState('待启动')
  const running = useRef(false)
  const clear = () => {setAnalysis(null); setReply(null); setQuestion(''); setPreview(null); setPreviewId(null)}
  const perform = useCallback(async (fn: () => Promise<void>) => {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try {await fn()} catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      try {setGame(await invoke<GameContext>('state'))} catch {}
    } finally {
      running.current = false; setBusy(false)
      try {const health = await invoke<{katago: string}>('health'); setEngine(health.katago === 'running' ? '已连接' : '待启动')} catch {setEngine('离线')}
    }
  }, [])
  useEffect(() => {void perform(async () => setGame(await invoke<GameContext>('state')))}, [perform])
  const open = () => perform(async () => {const result = await invoke<GameContext | null>('open'); if (result) {setGame(result); clear()}})
  const save = (as = false) => perform(async () => {const result = await invoke<{filename: string} | null>(as ? 'saveAs' : 'save'); if (result) {setNotice(`已保存 ${result.filename}`); setGame(await invoke<GameContext>('state'))}})
  const navigate = (direction: string, node_id?: string) => perform(async () => {setGame(await invoke<GameContext>('navigate', {direction, node_id})); clear()})
  const analyze = () => perform(async () => {
    if (!game) return
    const result = await invoke<AnalysisResult>('analyze', {revision: game.revision})
    clear(); setGame(result.context); setAnalysis(result.analysis)
  })
  const showPreview = (id: number, full = false) => perform(async () => {
    if (!game) return
    setPreview(await invoke<Preview>('preview', {revision: game.revision, marker_id: id, full})); setPreviewId(id)
  })
  const select = (coordinate: string) => perform(async () => {
    if (!game) return
    const context = await invoke<GameContext>('select', {coordinate, revision: game.revision})
    setGame(context); setReply(null); setQuestion(''); setPreview(null); setPreviewId(null)
    const marker = context.markers.find(m => m.coordinate === coordinate)
    // Free points become markers immediately; candidate clicks additionally open their analysis/PV.
    if (marker && game.markers.some(m => m.coordinate === coordinate) && marker.role !== 'stone') {
      const result = await invoke<AnalysisResult>('analyzeMarker', {revision: context.revision, marker_id: marker.id})
      setAnalysis(old => old ? {...old, candidates: [...old.candidates.filter(c => c.coordinate !== coordinate), ...result.analysis.candidates]} : result.analysis)
      setPreview(await invoke<Preview>('preview', {revision: context.revision, marker_id: marker.id})); setPreviewId(marker.id)
    }
  })
  const ask = (text: string) => perform(async () => {
    if (!game) return
    setQuestion(text); setReply(null); setPreview(null); setPreviewId(null)
    const result = await invoke<{reply: Reply; context: GameContext}>('ask', {question: text, revision: game.revision})
    setReply(result.reply); setGame(result.context)
  })
  const clearMarkers = () => perform(async () => {if (game) {setGame(await invoke<GameContext>('clearMarkers', {revision: game.revision})); clear()}})
  useEffect(() => {
    const handle = (action: string) => {
      if (running.current || settings) return
      if (action === 'open') void open()
      if (action === 'save' || action === 'saveAs') void save(action === 'saveAs')
      if (action === 'analyze') void analyze()
      if (action === 'clearMarkers') void clearMarkers()
      if (action === 'settings') setSettings(true)
    }
    const unsubscribe = window.llmgo?.onMenu(handle)
    const key = (event: KeyboardEvent) => {
      if (settings || running.current || (event.target as HTMLElement).matches('input,textarea,select')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault(); void navigate(event.key === 'ArrowLeft' ? 'previous' : 'next')}
    }
    window.addEventListener('keydown', key)
    return () => {unsubscribe?.(); window.removeEventListener('keydown', key)}
  })
  const selected = game?.markers.find(m => m.coordinate === game.selected_move)?.id || null
  return <div className="app" onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault(); if (settings) return
    const file = event.dataTransfer.files[0]
    if (file) void perform(async () => {const context = await window.llmgo.openDropped(file); if (context) {setGame(context); clear()}})
  }}>
    <header className="topbar"><div className="brand"><span className="brand-symbol">●<i>○</i></span>LLMgo<span className="brand-caption">围棋 AI 助教</span></div>
      <div className="toolbar"><button onClick={() => void open()} disabled={busy}>↥ 打开 SGF</button><button onClick={() => void save()} disabled={busy}>保存</button><span className="divider"/><button className="settings-button" onClick={() => setSettings(true)} disabled={busy}>⚙ 设置</button></div>
    </header>
    {(error || notice) && <div className={`banner ${error ? 'error' : ''}`} role="alert"><span>{error || notice}</span><button aria-label="关闭提示" onClick={() => {setError(''); setNotice('')}}>×</button></div>}
    {game ? <main className="workspace">
      <aside className="game-panel"><div className="record-title"><span className="eyebrow">棋谱工作台</span><h2>{game.filename || '新的棋局'}</h2><span>{game.metadata.DT || '导入棋谱，开始一起复盘'}</span></div>
        <div className="players"><div><i className="stone-dot"/><span><b>{game.metadata.PB || '黑方'}</b><small>{game.metadata.BR || '黑棋'}</small></span></div><div><i className="stone-dot white"/><span><b>{game.metadata.PW || '白方'}</b><small>{game.metadata.WR || '白棋'}</small></span></div></div>
        <div className="game-meta"><span>{game.board_state.size} 路</span><span>贴 {game.metadata.KM || '7.5'} 目</span><span>{game.metadata.RU || '中国规则'}</span>{game.metadata.RE && <span>{game.metadata.RE}</span>}{game.metadata.HA && <span>让 {game.metadata.HA} 子</span>}</div>
        <GameTree game={game} disabled={busy} onNavigate={(d, n) => void navigate(d, n)}/>
        <div className="drop-hint">↧ 拖入 .sgf 文件打开棋谱</div>
      </aside>
      <section className="board-panel"><div className="board-heading"><div><span className="eyebrow">{preview ? '变化预览' : '当前局面'}</span><h1>{preview ? `候选 ${previewId || selected || ''} 的变化` : `第 ${game.move_number} 手`}<span>{preview ? '数字代表变化手顺' : game.to_play === 'B' ? '黑棋行棋' : '白棋行棋'}</span></h1></div><button className="primary" disabled={busy} onClick={() => void analyze()}>{busy ? '处理中…' : '✧ 分析局面'}</button></div>
        <div className="board-options"><label><input type="checkbox" checked={numbers} onChange={e => setNumbers(e.target.checked)} disabled={!!preview}/>手数</label><span>{preview ? '预览不改变棋谱' : '点击空点或棋子添加数字标记'}</span><button className="text-button" disabled={busy} onClick={() => void clearMarkers()}>清除标记</button></div>
        <Board game={game} preview={preview} busy={busy} numbers={numbers} onPoint={c => void select(c)}/>
        {preview ? <div className="preview-bar"><span>变化：{preview.steps.map(s => `${s.id}${s.coordinate === 'pass' ? ' 停一手' : ''}`).join(' → ')}</span>{previewId && <button disabled={busy} onClick={() => void showPreview(previewId, true)}>完整变化</button>}<button onClick={() => setPreview(null)}>返回当前局面</button></div>
          : <div className="navigation"><button aria-label="第一手" disabled={busy} onClick={() => void navigate('first')}>|‹</button><button aria-label="前一手" disabled={busy} onClick={() => void navigate('previous')}>‹</button><span>第 <b>{game.move_number}</b> 手</span><button aria-label="后一手" disabled={busy} onClick={() => void navigate('next')}>›</button><button aria-label="最后一手" disabled={busy} onClick={() => void navigate('last')}>›|</button></div>}
        <Candidates game={game} analysis={analysis} disabled={busy} onSelect={c => void select(c)} onPreview={id => void showPreview(id)}/>
      </section>
      <Teacher reply={reply} question={question} busy={busy} selected={selected} onAsk={text => void ask(text)} onPreview={() => {setPreview(reply?.preview || null); setPreviewId(null)}}/>
    </main> : <div className="loading">正在连接 Python Core…</div>}
    <footer className="statusbar"><span><i className={`status-dot ${engine === '已连接' ? '' : 'idle'}`}/>KataGo {engine}</span><span>第 {game?.move_number || 0} 手</span><span>目差 {analysis ? score(analysis.score_lead) : '—'}</span><span>胜率 {analysis ? percent(analysis.winrate) : '—'}</span><span>Visits {analysis?.visits ?? '—'}</span><span className="status-right">{analysis ? `${analysis.perspective === 'B' ? '黑' : '白'}方视角${analysis.cached ? ' · 缓存' : ''}` : '本地棋谱 · 数字讲解'}</span></footer>
    {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={() => {clear(); void invoke<GameContext>('state').then(setGame).catch(e => setError(String(e)))}}/>}
  </div>
}
