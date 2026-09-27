import {useLayoutEffect, useRef, useState, type ComponentType} from 'react'
import {createPortal} from 'react-dom'
import {Goban as ShudanGoban} from '@sabaki/shudan'
import type {GobanProps, Marker as ShudanMarker} from '@sabaki/shudan/src/Goban'
import type {Analysis, GameContext, Preview} from '../api/types'
import {candidateLoss, lossColor, LOSS_LEVELS, percent, score} from '../analysis/evaluation'
import '@sabaki/shudan/css/goban.css'

const Goban = ShudanGoban as unknown as ComponentType<GobanProps>
const letters = 'ABCDEFGHJKLMNOPQRST'
export function vertex(coordinate: string, size: number): [number, number] | null {
  if (coordinate.toLowerCase() === 'pass') return null
  return [letters.indexOf(coordinate[0]), size - Number(coordinate.slice(1))]
}

export type NumberMode = 'off' | 'latest' | 'all'
export const nextNumberMode = (mode: NumberMode): NumberMode => mode === 'off' ? 'latest' : mode === 'latest' ? 'all' : 'off'
interface Props {game: GameContext; analysis: Analysis | null; preview: Preview | null; busy: boolean; numbers: NumberMode; onPoint: (coordinate: string) => void; onPreview: (id: number) => void; onExitPreview: () => void}
export function Board({game, analysis, preview, busy, numbers, onPoint, onPreview, onExitPreview}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState(600)
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const element = container.current!
    setOverlayRoot(element.querySelector<HTMLElement>('.shudan-content'))
    const observer = new ResizeObserver(([entry]) => setSpace(Math.min(entry.contentRect.width, entry.contentRect.height) - 4))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const size = game.board_state.size
  const map: (ShudanMarker | null)[][] = Array.from({length: size}, () => Array(size).fill(null))
  const latest = Math.max(0, ...game.board_state.move_numbers.flat())
  if (numbers !== 'off' && !preview) game.board_state.move_numbers.forEach((row, y) => row.forEach((n, x) => {if (n && (numbers === 'all' || n === latest)) map[y][x] = {type: 'label', label: String(n)}}))
  if (!preview && game.board_state.last_move) {
    const last = vertex(game.board_state.last_move, size)
    if (last && numbers === 'off') map[last[1]][last[0]] = {type: 'circle'}
  }
  preview?.steps.forEach(marker => {
    const p = vertex(marker.coordinate, size)
    if (p) map[p[1]][p[0]] = {type: 'label', label: String(marker.id), tooltip: marker.coordinate}
  })
  const recommendations = !preview && analysis ? game.markers.flatMap(marker => {
    const candidate = analysis.candidates.find(c => c.coordinate === marker.coordinate)
    const p = vertex(marker.coordinate, size)
    return candidate && p && !game.board_state.sign_map[p[1]][p[0]] ? [{...marker, candidate, p, loss: candidateLoss(candidate, analysis.candidates)}] : []
  }) : []
  const ghosts = Array.from({length: size}, () => Array(size).fill(null))
  if (hover && !preview && !game.board_state.sign_map[hover[1]][hover[0]]) ghosts[hover[1]][hover[0]] = {sign: game.to_play === 'B' ? 1 : -1, faint: true}
  return <div className="board-space" ref={container} onContextMenu={event => event.preventDefault()}>
    <Goban id="main-goban" vertexSize={Math.max(1, space / (size + 2.24))} signMap={(preview?.sign_map || game.board_state.sign_map) as (0 | 1 | -1)[][]}
      showCoordinates coordX={x => letters[x]} coordY={y => size - y} markerMap={map} ghostStoneMap={ghosts}
      onVertexMouseEnter={(_event, p) => setHover(p)} onVertexMouseLeave={() => setHover(null)}
      onVertexMouseDown={(event, [x, y]) => {
        if (event.button !== 2 || busy) return
        const marker = recommendations.find(m => m.p[0] === x && m.p[1] === y)
        if (marker) onPreview(marker.id)
      }}
      onVertexClick={(event, [x, y]) => {if (event.button === 0 && !preview && !busy && !game.board_state.sign_map[y][x]) onPoint(`${letters[x]}${size - y}`)}}/>
    {overlayRoot && createPortal(<div className="recommendations" style={{gridTemplateColumns: `repeat(${size}, 1fr)`, gridTemplateRows: `repeat(${size}, 1fr)`}}>
      {recommendations.map(marker => <div key={marker.id} className="recommendation" data-coordinate={marker.coordinate} data-loss={marker.loss}
        data-level={LOSS_LEVELS.findIndex(level => marker.loss < level.limit)}
        style={{gridColumn: marker.p[0] + 1, gridRow: marker.p[1] + 1, backgroundColor: lossColor(marker.loss)}}>
        <span>{percent(marker.candidate.winrate)}</span><span>{score(marker.candidate.score_lead)}</span>
      </div>)}
    </div>, overlayRoot)}
    {hover && recommendations.some(m => m.p[0] === hover[0] && m.p[1] === hover[1]) && <div className="recommendation-detail">{recommendations.filter(m => m.p[0] === hover[0] && m.p[1] === hover[1]).map(m => <span key={m.id}>推荐 {m.id} · {m.coordinate} · {m.candidate.visits} visits · 右键预览</span>)}</div>}
    {preview && <button className="preview-exit" onClick={onExitPreview}>返回当前局面 · PV 预览</button>}
  </div>
}
