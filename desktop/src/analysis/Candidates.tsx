import type {Analysis, GameContext} from '../api/types'

export const percent = (n: number) => `${(n * 100).toFixed(1)}%`
export const score = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
export function Candidates({game, analysis, disabled, onSelect, onPreview}: {
  game: GameContext; analysis: Analysis | null; disabled: boolean
  onSelect: (coordinate: string) => void; onPreview: (id: number) => void
}) {
  return <section className="candidates">
    <div className="section-heading"><h3>关键落点</h3><span>棋盘数字 · 即点即看</span></div>
    {!game.markers.length && <div className="candidate-empty">分析局面生成 1、2、3，或点击棋盘添加一个标记。</div>}
    <div className="candidate-list">{game.markers.map(marker => {
      const data = analysis?.candidates.find(c => c.coordinate === marker.coordinate)
      return <div key={marker.id} className={`candidate ${game.selected_move === marker.coordinate ? 'active' : ''}`}>
        <button className="candidate-main" disabled={disabled} onClick={() => onSelect(marker.coordinate)} title={marker.coordinate}>
          <b className={`number-badge ${marker.role === 'best_move' ? 'best' : ''}`}>{marker.id}</b>
          <span><strong>{marker.role === 'best_move' ? 'AI 首选' : marker.role === 'stone' ? '目标棋子' : marker.role === 'selected_move' ? '我的选点' : '候选着'}</strong>
          <small>{data ? `${percent(data.winrate)} 胜率 · ${score(data.score_lead)} 目` : '点击获取分析'}</small></span>
        </button>
        {marker.role !== 'stone' && <button className="text-button pv-button" disabled={disabled} onClick={() => onPreview(marker.id)}>变化 ↗</button>}
      </div>
    })}</div>
  </section>
}
