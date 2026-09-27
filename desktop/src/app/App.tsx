import {useCallback, useEffect, useRef, useState} from 'react'
import {invoke} from '../api/client'
import type {Analysis, AnalysisResult, GameContext, Preview, Reply, Settings} from '../api/types'
import {Board, nextNumberMode, type NumberMode} from '../board/Board'
import {GameTree} from '../gametree/GameTree'
import {percent, score} from '../analysis/evaluation'
import {Teacher, type Conversation} from '../teacher/Teacher'
import {SettingsDialog, type SettingsTab} from '../settings/SettingsDialog'
import {playStoneSound, prepareStoneSound} from '../board/sound'
import {Splitter} from './Splitter'

export function App() {
  const [game, setGame] = useState<GameContext | null>(null)
  const current = useRef<GameContext | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [history, setHistory] = useState<Conversation[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [preferences, setPreferences] = useState<Settings | null>(null)
  const numberMode = useRef<NumberMode>('off')
  const settingsWrites = useRef(Promise.resolve())
  const numbers = preferences?.move_number_mode || 'off'
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [left, setLeft] = useState(true)
  const [right, setRight] = useState(true)
  const [leftWidth, setLeftWidth] = useState(224)
  const [rightWidth, setRightWidth] = useState(330)
  const [recordHeight, setRecordHeight] = useState(125)
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [auto, setAuto] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [engine, setEngine] = useState('启动中')
  const running = useRef(false)
  const analysisTicket = useRef(0)
  const accept = useCallback((context: GameContext) => {
    // Keep the tree's transport projection stable during ordinary navigation.
    const previous = current.current
    if (previous?.game_id === context.game_id && JSON.stringify(previous.nodes) === JSON.stringify(context.nodes)) context.nodes = previous.nodes
    current.current = context; setGame(context)
  }, [])
  const clear = () => {setAnalysis(null); setPreview(null)}
  const stopAnalysis = useCallback(async (clearResult = true) => {
    analysisTicket.current += 1; setAnalyzing(false)
    if (clearResult) {setAnalysis(null); setPreview(null)}
    await invoke('stopAnalysis')
    accept(await invoke<GameContext>('state'))
  }, [accept])
  const perform = useCallback(async (fn: () => Promise<void>) => {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try {await fn()} catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {running.current = false; setBusy(false)}
  }, [])
  useEffect(() => {
    void perform(async () => {
      accept(await invoke<GameContext>('state'))
      const value = await invoke<Settings>('settings'); setPreferences(value); numberMode.current = value.move_number_mode
      void invoke('startEngine').catch(e => setError(String(e)))
    })
    const poll = async () => {
      try {
        const health = await invoke<{katago: string}>('health')
        setEngine(({starting: '启动中', ready: '就绪', error: '错误', stopped: '未启动'} as Record<string, string>)[health.katago] || '错误')
      } catch {setEngine('错误')}
    }
    const timer = window.setInterval(() => void poll(), 1500)
    return () => window.clearInterval(timer)
  }, [perform, accept])
  const open = () => perform(async () => {
    await stopAnalysis()
    const result = await invoke<GameContext | null>('open')
    if (result) {accept(result); clear(); setHistory([])}
  })
  const save = (as = false) => perform(async () => {
    const result = await invoke<{filename: string} | null>(as ? 'saveAs' : 'save')
    if (result) {setNotice(`已保存 ${result.filename}`); accept(await invoke<GameContext>('state'))}
  })
  const navigate = useCallback((direction: string, node_id?: string) => {void perform(async () => {
    await stopAnalysis(); setAnalysis(null); setPreview(null)
    accept(await invoke<GameContext>('navigate', {direction, node_id}))
  })}, [accept, perform, stopAnalysis])
  const analyze = useCallback(async () => {
    if (!current.current || running.current) return
    await stopAnalysis()
    const snapshot = current.current
    const ticket = ++analysisTicket.current
    setAnalyzing(true); setError('')
    try {
      const result = await invoke<AnalysisResult | {cancelled: true}>('analyze', {revision: snapshot.revision})
      if (ticket !== analysisTicket.current || current.current?.revision !== snapshot.revision || 'cancelled' in result) return
      accept(result.context); setAnalysis(result.analysis)
    } catch (e) {if (ticket === analysisTicket.current) {setError((e as Error).message); setAuto(false)}}
    finally {if (ticket === analysisTicket.current) setAnalyzing(false)}
  }, [accept, stopAnalysis])
  useEffect(() => {
    if (!auto || !game || busy || preview) return
    const timer = window.setTimeout(() => void analyze(), 250)
    return () => window.clearTimeout(timer)
  }, [auto, game?.game_id, game?.node_id, busy, !!preview, analyze])
  const toggleAnalysis = () => {setAuto(value => !value); if (auto) void stopAnalysis()}
  const play = (coordinate: string) => {
    if (coordinate !== 'pass' && preferences?.sound_enabled) prepareStoneSound()
    return perform(async () => {
      await stopAnalysis()
      const snapshot = current.current
      if (!snapshot) return
      const result = await invoke<{context: GameContext; created: boolean}>('play', {coordinate, revision: snapshot.revision})
      accept(result.context); clear()
      if (result.created && coordinate !== 'pass' && preferences?.sound_enabled) playStoneSound()
    })
  }
  const changeNumbers = (mode: NumberMode) => {
    numberMode.current = mode
    setPreferences(value => value ? {...value, move_number_mode: mode} : value)
    settingsWrites.current = settingsWrites.current.then(async () => {
      const value = await invoke<Settings>('settings')
      await invoke<Settings>('updateSettings', {...value, move_number_mode: mode})
    }).catch(e => setError(String(e)))
  }
  const edit = (action: string) => perform(async () => {
    await stopAnalysis()
    if (!current.current) return
    accept(await invoke<GameContext>('edit', {action, revision: current.current.revision})); clear()
  })
  const comment = (text: string) => perform(async () => {
    await stopAnalysis()
    if (current.current) accept(await invoke<GameContext>('comment', {text, revision: current.current.revision}))
  })
  const showPreview = (id: number, full = false) => perform(async () => {
    setAuto(false)
    await stopAnalysis(false)
    if (current.current) setPreview(await invoke<Preview>('preview', {revision: current.current.revision, marker_id: id, full}))
  })
  const ask = (text: string) => perform(async () => {
    await stopAnalysis()
    const snapshot = current.current
    if (!snapshot) return
    setPreview(null)
    const entry = {question: text, move: snapshot.move_number, reply: null}
    setHistory(old => [...old, entry])
    const result = await invoke<{reply: Reply; context: GameContext}>('ask', {question: text, revision: snapshot.revision})
    accept(result.context)
    setHistory(old => [...old.slice(0, -1), {...entry, reply: result.reply}])
  })
  useEffect(() => {
    const handle = (action: string) => {
      if (action === 'toggleNumbers') {if (preferences) changeNumbers(nextNumberMode(numberMode.current)); return}
      if (action === 'toggleAnalysis') {toggleAnalysis(); return}
      if (running.current || settings) return
      if (action === 'open') void open()
      if (action === 'save' || action === 'saveAs') void save(action === 'saveAs')
      if (action === 'analyze') void analyze()
      if (['undo', 'redo', 'deleteNode', 'deleteBranch'].includes(action)) void edit(action)
      if (['engineSettings', 'apiSettings', 'interfaceSettings'].includes(action)) {
        void stopAnalysis()
        setSettings(action === 'engineSettings' ? 'engine' : action === 'apiSettings' ? 'api' : 'interface')
      }
    }
    const unsubscribe = window.llmgo?.onMenu(handle)
    const key = (event: KeyboardEvent) => {
      if (settings || running.current || (event.target as HTMLElement).matches('input,textarea,select')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault(); navigate(event.key === 'ArrowLeft' ? 'previous' : 'next')}
    }
    window.addEventListener('keydown', key)
    return () => {unsubscribe?.(); window.removeEventListener('keydown', key)}
  })
  return <div className="app" onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault(); if (settings) return
    const file = event.dataTransfer.files[0]
    if (file) void perform(async () => {await stopAnalysis(); const context = await window.llmgo.openDropped(file); if (context) {accept(context); clear(); setHistory([])}})
  }}>
    {(error || notice) && <div className={`banner ${error ? 'error' : ''}`} role="alert"><span>{error || notice}</span><button aria-label="关闭提示" onClick={() => {setError(''); setNotice('')}}>×</button></div>}
    {game ? <main className={`workspace ${left ? '' : 'left-collapsed'} ${right ? '' : 'right-collapsed'}`} style={{gridTemplateColumns: `${left ? `${leftWidth}px 6px` : ''} minmax(0,1fr) ${right ? `6px ${rightWidth}px` : ''}`}}>
      <aside className="game-panel" hidden={!left}>
        <div className="record-info" style={{height: recordHeight}}>
        <div className="record-title"><span className="eyebrow">棋谱工作台</span><h2>{game.filename || '新的棋局'}</h2><span>{game.metadata.DT || ''}</span></div>
        <div className="game-meta"><span>贴 {game.metadata.KM || '7.5'} 目</span><span>{game.metadata.RU || '中国规则'}</span><span>{game.metadata.game_form}</span>{game.metadata.RE && <span>{game.metadata.RE}</span>}</div>
        </div>
        <Splitter label="调整棋局信息高度" vertical value={recordHeight} min={0} max={260} onChange={setRecordHeight}/>
        <GameTree game={game} disabled={busy} onNavigate={navigate} onComment={text => void comment(text)}/>
      </aside>
      {left && <Splitter label="调整棋谱栏宽度" value={leftWidth} min={180} max={360} onChange={setLeftWidth}/>}
      <section className="board-panel">
        <button className="sidebar-toggle sidebar-toggle-left" aria-label={left ? '折叠棋谱栏' : '展开棋谱栏'} onClick={() => setLeft(!left)}>{left ? '‹' : '›'}</button>
        <button className="sidebar-toggle sidebar-toggle-right" aria-label={right ? '折叠 AI 栏' : '展开 AI 栏'} onClick={() => setRight(!right)}>{right ? '›' : '‹'}</button>
        <Board game={game} analysis={analysis} preview={preview} busy={busy} numbers={numbers} onPoint={c => void play(c)} onPreview={id => void showPreview(id)} onExitPreview={() => setPreview(null)}/>
        <div className="navigation"><button aria-label="第一手" disabled={busy} onClick={() => navigate('first')}>|‹</button><button aria-label="前一手" disabled={busy} onClick={() => navigate('previous')}>‹</button><span>第 <b>{game.move_number}</b> 手</span><button aria-label="后一手" disabled={busy} onClick={() => navigate('next')}>›</button><button aria-label="最后一手" disabled={busy} onClick={() => navigate('last')}>›|</button><button className="pass" disabled={busy || !!preview} onClick={() => void play('pass')}>停一手</button></div>
      </section>
      {right && <Splitter label="调整 AI 栏宽度" reverse value={rightWidth} min={240} max={420} onChange={setRightWidth}/>}
      <Teacher history={history} busy={busy} hidden={!right} onAsk={text => void ask(text)}/>
    </main> : <div className="loading">正在连接 Python Core…</div>}
    <footer className="statusbar"><span><i className={`status-dot ${engine === '就绪' ? '' : 'idle'}`}/>KataGo {analyzing ? '分析中…' : auto ? `${engine} · 自动` : engine}</span><span>第 {game?.move_number || 0} 手</span><span>目差 {analysis ? score(analysis.score_lead) : '—'}</span><span>胜率 {analysis ? percent(analysis.winrate) : '—'}</span><span>Visits {analysis?.visits ?? '—'}</span><span className="status-right">{analysis ? `${analysis.perspective === 'B' ? '黑' : '白'}方视角` : ''}</span></footer>
    {settings && <SettingsDialog initialTab={settings} numbers={numbers} onNumbers={changeNumbers} beforeSave={() => settingsWrites.current} onClose={() => setSettings(null)} onSaved={value => {setPreferences(value); numberMode.current = value.move_number_mode; clear(); void invoke<GameContext>('state').then(accept).catch(e => setError(String(e)))}}/>}
  </div>
}
