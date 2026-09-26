import {useState} from 'react'
import type {Reply} from '../api/types'

export function Teacher({reply, question, busy, selected, onAsk, onPreview}: {
  reply: Reply | null; question: string; busy: boolean; selected: number | null
  onAsk: (text: string) => void; onPreview: () => void
}) {
  const [text, setText] = useState('')
  return <aside className="teacher-panel">
    <div className="teacher-title"><div className="teacher-icon">弈</div><div><h2>AI 助教</h2><span>让每一手，都有所理解</span></div><i className="status-dot"/></div>
    <div className="teacher-content" aria-live="polite">
      {question && <div className="question-bubble">{question}</div>}
      {reply ? <div className="teacher-answer">
        {([['conclusion', '结论'], ['reasons', '原因'], ['key_variation', '关键变化'], ['principle', '可复用棋理']] as const).map(([key, label]) =>
          <section key={key} className={key === 'principle' ? 'principle' : ''}><h3>{label}</h3><p>{reply.answer[key]}</p></section>)}
        {reply.preview && <button className="secondary" onClick={onPreview}>在棋盘查看关键变化 ↗</button>}
        <details><summary>分析依据 · {reply.tool_calls.length} 次工具调用</summary>{reply.tool_calls.map((call, i) => <code key={i}>{call}</code>)}</details>
      </div> : <div className="teacher-welcome"><div className="welcome-markers"><b>1</b><b>2</b><b>3</b></div><h3>指着数字，把棋讲清楚。</h3><p>在棋盘选择一个点，或先分析当前局面。围绕数字提问，助教会调用 KataGo 比较，再解释其中的棋理。</p>
        <button disabled={busy} onClick={() => onAsk('请分析当前局面，说明首选的价值。')}>现在应该关注哪里？ <span>↗</span></button>
        {selected && <button disabled={busy} onClick={() => onAsk(`如果走 ${selected} 呢？请与首选比较。`)}>如果走 {selected} 呢？ <span>↗</span></button>}
      </div>}
      {busy && <div className="working"><i/>正在处理，请稍候…</div>}
    </div>
    <form className="composer" onSubmit={event => {event.preventDefault(); if (text.trim()) {onAsk(text.trim()); setText('')}}}>
      <textarea aria-label="向助教提问" placeholder={selected ? `问问助教：为什么 ${selected} 不好？` : '问问助教：这个局面该怎么下？'} value={text} onChange={e => setText(e.target.value)} disabled={busy}
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); if (text.trim() && !busy) {onAsk(text.trim()); setText('')}}}}/>
      <div><span>围绕棋盘上的数字提问</span><button type="submit" className="send" disabled={busy || !text.trim()} aria-label="发送问题">↑</button></div>
    </form>
    <div className="teacher-footnote">KataGo 算棋 · GPT 讲解</div>
  </aside>
}
