import {useLayoutEffect, useRef, useState, type ComponentType} from 'react'
import {Goban as ShudanGoban} from '@sabaki/shudan'
import type {GobanProps, Marker as ShudanMarker} from '@sabaki/shudan/src/Goban'
import type {GameContext, Preview} from '../api/types'
import '@sabaki/shudan/css/goban.css'

const Goban = ShudanGoban as unknown as ComponentType<GobanProps>
const letters = 'ABCDEFGHJKLMNOPQRST'
export function vertex(coordinate: string, size: number): [number, number] | null {
  if (coordinate.toLowerCase() === 'pass') return null
  return [letters.indexOf(coordinate[0]), size - Number(coordinate.slice(1))]
}

interface Props {game: GameContext; preview: Preview | null; busy: boolean; numbers: boolean; onPoint: (coordinate: string) => void}
export function Board({game, preview, busy, numbers, onPoint}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState(600)
  const [hover, setHover] = useState<[number, number] | null>(null)
  useLayoutEffect(() => {
    const element = container.current!
    const observer = new ResizeObserver(([entry]) => setSpace(Math.min(entry.contentRect.width, entry.contentRect.height) - 20))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const size = game.board_state.size
  const map: (ShudanMarker | null)[][] = Array.from({length: size}, () => Array(size).fill(null))
  if (numbers && !preview) game.board_state.move_numbers.forEach((row, y) => row.forEach((n, x) => {if (n) map[y][x] = {type: 'label', label: String(n)}}))
  if (!preview && game.board_state.last_move) {
    const last = vertex(game.board_state.last_move, size)
    if (last && !numbers) map[last[1]][last[0]] = {type: 'circle'}
  }
  const labels = preview ? preview.steps : game.markers
  labels.forEach(marker => {
    const p = vertex(marker.coordinate, size)
    if (p) map[p[1]][p[0]] = {type: 'label', label: String(marker.id), tooltip: `${marker.id}（${marker.coordinate}）`}
  })
  const ghosts = Array.from({length: size}, () => Array(size).fill(null))
  if (hover && !preview && !game.board_state.sign_map[hover[1]][hover[0]]) ghosts[hover[1]][hover[0]] = {sign: game.to_play === 'B' ? 1 : -1, faint: true}
  const selected = game.selected_move && !preview ? vertex(game.selected_move, size) : null
  return <div className={`board-space ${numbers && !preview ? 'move-numbers' : ''}`} ref={container}>
    <Goban id="main-goban" vertexSize={Math.max(14, Math.floor(space / (size + 2.4)))} signMap={(preview?.sign_map || game.board_state.sign_map) as (0 | 1 | -1)[][]}
      showCoordinates coordX={x => letters[x]} coordY={y => size - y} markerMap={map} ghostStoneMap={ghosts}
      busy={busy} selectedVertices={selected ? [selected] : []}
      onVertexMouseEnter={(_event, p) => setHover(p)} onVertexMouseLeave={() => setHover(null)}
      onVertexClick={(_event, [x, y]) => {if (!preview && !busy) onPoint(`${letters[x]}${size - y}`)}}/>
  </div>
}
