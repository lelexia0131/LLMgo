import {useEffect, useRef} from 'react'
import type {GameContext} from '../api/types'

export function GameTree({game, disabled, onNavigate}: {game: GameContext; disabled: boolean; onNavigate: (direction: string, node?: string) => void}) {
  const active = useRef<HTMLButtonElement>(null)
  useEffect(() => {active.current?.scrollIntoView({block: 'nearest'})}, [game.node_id])
  const depths: Record<string, number> = {}
  game.nodes.forEach(n => {depths[n.id] = n.parent_id === null ? 0 : depths[n.parent_id] + (game.nodes[Number(n.parent_id)].children.length > 1 ? 1 : 0)})
  return <section className="tree-section">
    <div className="section-heading"><h3>变化树</h3><span>{game.nodes.length} 节点</span></div>
    <div className="tree-list" role="tree" aria-label="棋谱变化树">
      {game.nodes.map(node => <button role="treeitem" aria-selected={node.id === game.node_id} ref={node.id === game.node_id ? active : null}
        key={node.id} className={`tree-node ${node.id === game.node_id ? 'active' : ''}`} style={{paddingLeft: 14 + Math.min(depths[node.id], 5) * 15}}
        disabled={disabled} onClick={() => onNavigate('node', node.id)}>
        <i className={`stone-dot ${node.move?.color === 'W' ? 'white' : ''}`}/>
        <span>{node.move ? `第 ${node.move_number} 手` : '初始局面'}</span>
        {node.move?.coordinate === 'pass' && <small>停一手</small>}{node.children.length > 1 && <small>{node.children.length} 分支</small>}
      </button>)}
    </div>
    <div className="comment"><span className="eyebrow">棋谱注释</span><p>{game.comment || '当前节点没有注释。'}</p></div>
  </section>
}
