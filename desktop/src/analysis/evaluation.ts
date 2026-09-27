import type {Candidate} from '../api/types'

export const percent = (n: number) => `${(n * 100).toFixed(1)}%`
export const score = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
export const LOSS_LEVELS = [
  {limit: .5, color: '#58a86b', label: '较好'},
  {limit: 1.5, color: '#a5c65d', label: '轻微损失'},
  {limit: 3, color: '#e6cd55', label: '一般损失'},
  {limit: 6, color: '#e89945', label: '明显损失'},
  {limit: Infinity, color: '#d8665f', label: '严重损失'}
]
export const lossColor = (loss?: number) => loss === undefined ? '#d9dfd7' : LOSS_LEVELS.find(level => loss < level.limit)!.color
// AnalysisService has already converted every candidate to the player-to-move perspective.
export const candidateLoss = (candidate: Candidate, candidates: Candidate[]) => Math.max(0, ...candidates.map(c => c.score_lead - candidate.score_lead))
