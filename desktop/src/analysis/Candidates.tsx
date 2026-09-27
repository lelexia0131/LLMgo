import type {Analysis, GameContext} from '../api/types'

export const percent = (n: number) => `${(n * 100).toFixed(1)}%`
export const score = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
export function Candidates({game, analysis, disabled, onPreview}: {
  game: GameContext; analysis: Analysis | null; disabled: boolean; onPreview: (id: number) => void
}) {
  return <section className="candidates">
    <div className="section-heading"><h3>KataGo 推荐</h3><span>预览不写入棋谱</span></div>
    <div className="candidate-list">{game.markers.map(marker => {
      const data = analysis?.candidates.find(c => c.coordinate === marker.coordinate)
      return <button key={marker.id} className="candidate" disabled={disabled} onClick={() => onPreview(marker.id)}>
        <b className={`number-badge ${marker.role === 'best_move' ? 'best' : ''}`}>{marker.id}</b>
        <span><strong>{marker.coordinate} · 变化 ↗</strong><small>{data ? `${percent(data.winrate)} · ${score(data.score_lead)} 目` : '查看推荐变化'}</small></span>
      </button>
    })}</div>
  </section>
}
