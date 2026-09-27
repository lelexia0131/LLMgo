import {useState} from 'react'
import type {Reply} from '../api/types'

export interface Conversation {question: string; move: number; reply: Reply | null}
export function Teacher({history, busy, hidden, onAsk}: {
  history: Conversation[]; busy: boolean; hidden: boolean; onAsk: (text: string) => void
}) {
  const [text, setText] = useState('')
  const send = () => {if (text.trim() && !busy) {onAsk(text.trim()); setText('')}}
  return <aside className="teacher-panel" hidden={hidden}>
    <div className="teacher-title"><h2>AI 助教</h2></div>
    <div className="teacher-content" aria-live="polite">
      {history.map((entry, index) => <div key={index}>
        <div className="question-bubble"><small>第 {entry.move} 手</small><p>{entry.question}</p></div>
        {entry.reply && <div className="teacher-answer">
          {([['conclusion', '结论'], ['reasons', '原因'], ['key_variation', '关键变化'], ['principle', '可复用棋理']] as const).map(([key, label]) =>
            <section key={key} className={key === 'principle' ? 'principle' : ''}><h3>{label}</h3><p>{entry.reply!.answer[key]}</p></section>)}
          <small>推荐编号：{entry.reply.current_markers.map(m => `${m.id} = ${m.coordinate}`).join(' · ')}</small>
        </div>}
      </div>)}
      {busy && <div className="working"><i/>正在处理…</div>}
    </div>
    <form className="composer" onSubmit={event => {event.preventDefault(); send()}}>
      <textarea aria-label="向助教提问" placeholder="解释当前局面…" value={text} onChange={e => setText(e.target.value)} disabled={busy}
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); send()}}}/>
      <div><span>Enter 发送 · Shift+Enter 换行</span><button type="submit" className="send" disabled={busy || !text.trim()} aria-label="发送问题">↑</button></div>
    </form>
  </aside>
}
