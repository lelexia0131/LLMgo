export interface Marker {id: number; coordinate: string; role: 'best_move' | 'candidate'}
export interface Move {color: 'B' | 'W'; coordinate: string}
export interface GameNode {id: string; parent_id: string | null; children: string[]; move: Move | null; comment: string; move_number: number}
export interface GameContext {
  game_id: string; node_id: string; revision: number; move_number: number; to_play: 'B' | 'W'
  board_state: {size: number; sign_map: number[][]; last_move: string | null; move_numbers: number[][]}
  markers: Marker[]; metadata: Record<string, string>; nodes: GameNode[]
  comment: string; filename: string | null
  can_undo: boolean; can_redo: boolean; move_losses: Record<string, number>
}
export interface Candidate {coordinate: string; score_lead: number; winrate: number; visits: number; prior: number; pv: string[]}
export interface Analysis {score_lead: number; winrate: number; visits: number; perspective: 'B' | 'W'; candidates: Candidate[]; cached: boolean}
export interface AnalysisResult {analysis: Analysis; context: GameContext}
export interface Preview {sign_map: number[][]; steps: {id: number; coordinate: string; color: string}[]}
export interface Reply {
  answer: {conclusion: string; reasons: string; key_variation: string; principle: string; referenced_markers: number[]}
  current_markers: Marker[]; tool_calls: string[]; preview: Preview | null
}
export interface Engine {name: string; executable: string; models: string[]; configs: string[]}
export interface Settings {
  katago_executable: string; katago_model: string; katago_config: string; visits: number; openai_model: string
  has_api_key: boolean; engines: Engine[]
  provider: 'openai' | 'deepseek' | 'compatible'; base_url: string; sound_enabled: boolean
  engine_threads: number; engine_gpu: number
}
declare global {
  interface Window {llmgo: {
    invoke: (action: string, body?: unknown) => Promise<unknown>
    openDropped: (file: File) => Promise<GameContext | null>
    onMenu: (callback: (action: string) => void) => () => void
  }}
}
