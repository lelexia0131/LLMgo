import {memo, useEffect, useMemo, useRef, useState} from 'react'
import type {GameContext, GameNode} from '../api/types'
import {lossColor} from '../analysis/evaluation'
import {Splitter} from '../app/Splitter'

const TreeNode = memo(function TreeNode({node, x, y, active, loss, onNavigate}: {
  node: GameNode; x: number; y: number; active: boolean; loss?: number; onNavigate: (direction: string, node?: string) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {if (active) ref.current?.scrollIntoView({block: 'nearest', inline: 'nearest'})}, [active])
  return <button ref={ref} role="treeitem" aria-selected={active} aria-label={node.move ? `第 ${node.move_number} 手 ${node.move.color} ${node.move.coordinate}` : '初始局面'}
    className={`graph-node ${active ? 'active' : ''}`} style={{left: x, top: y, backgroundColor: lossColor(loss)}}
    title={`${node.move?.coordinate || '根节点'} · ${loss === undefined ? '无分析数据' : `损失 ${loss.toFixed(2)} 目`}`}
    onClick={() => onNavigate('node', node.id)}><span className={node.move?.color === 'W' ? 'white' : 'black'}>{node.move ? node.move_number : '○'}</span></button>
})

export function GameTree({game, disabled, onNavigate, onComment}: {
  game: GameContext; disabled: boolean; onNavigate: (direction: string, node?: string) => void; onComment: (text: string) => void
}) {
  const [comment, setComment] = useState(game.comment)
  const [commentHeight, setCommentHeight] = useState(140)
  const section = useRef<HTMLElement>(null)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {if (entry.contentRect.height) setHeight(entry.contentRect.height)})
    observer.observe(section.current!)
    return () => observer.disconnect()
  }, [])
  const visibleCommentHeight = Math.min(commentHeight, Math.max(28, height - 150))
  useEffect(() => setComment(game.comment), [game.node_id, game.comment])
  const layout = useMemo(() => {
    const byId = new Map(game.nodes.map(node => [node.id, node]))
    const positions = new Map<string, {x: number; y: number}>()
    let row = 0
    const pending = [{id: game.nodes[0].id, depth: 0, branch: false}]
    while (pending.length) {
      const item = pending.pop()!
      if (item.branch) row++
      positions.set(item.id, {x: 12 + row * 42, y: 12 + item.depth * 42})
      const node = byId.get(item.id)!
      for (let i = node.children.length - 1; i >= 0; i--) pending.push({id: node.children[i], depth: item.depth + 1, branch: i > 0})
    }
    return {positions, width: 66 + row * 42, height: Math.max(...Array.from(positions.values(), p => p.y)) + 54}
  }, [game.nodes])
  return <section className="tree-section" ref={section}>
    <div className="section-heading"><h3>变化树</h3><span>{game.nodes.length} 节点</span></div>
    <div className="tree-list" role="tree" aria-label="棋谱变化树" inert={disabled}>
      <div className="tree-graph" style={{width: layout.width, height: layout.height}}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">{game.nodes.flatMap(node => node.children.map(id => {
          const a = layout.positions.get(node.id)!, b = layout.positions.get(id)!
          return <path key={id} d={`M${a.x + 15},${a.y + 15} V${b.y - 7} H${b.x + 15} V${b.y + 15}`}/>
        }))}</svg>
        {game.nodes.map(node => <TreeNode key={node.id} node={node} {...layout.positions.get(node.id)!} active={node.id === game.node_id} loss={game.move_losses[node.id]} onNavigate={onNavigate}/>)}
      </div>
    </div>
    <Splitter label="调整注释区域高度" vertical reverse value={visibleCommentHeight} min={28} max={Math.max(28, height - 150)} onChange={setCommentHeight}/>
    <div className="comment" style={{height: visibleCommentHeight}}><label className="eyebrow" htmlFor="node-comment">棋谱注释</label><textarea id="node-comment" value={comment} disabled={disabled} onChange={e => setComment(e.target.value)}/><button disabled={disabled || comment === game.comment} onClick={() => onComment(comment)}>保存注释</button></div>
  </section>
}
