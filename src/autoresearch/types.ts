// Types shared across the autoresearch layer

export interface HeuristicParams {
  max_gas_gwei: number
  min_profit_eth: number
  hf_alert_threshold: number
  scan_interval_ms: number
  scan_batch_size: number
  gas_estimate_liquidation: number
  circuit_breaker_failures: number
  circuit_breaker_pause_secs: number
  version: number
  updated_at: number | null
  rationale: string | null
}

export interface MissedOpportunity {
  id: number
  borrower: string
  collateral_asset: string
  debt_asset: string
  profit_missed_eth: number | null
  winner_address: string
  winner_gas_gwei: number | null
  block_number: number
  timestamp: number
}

export interface SimulationResult {
  borrower: string
  block_number: number
  current_params_win: boolean          // would we have won with current params?
  proposed_params_win: boolean         // would we have won with proposed params?
  current_gas_gwei: number
  winner_gas_gwei: number
  required_gas_gwei: number           // minimum gas to have won
  estimated_profit_eth: number
}

export interface ShadowScore {
  total_opportunities: number
  wins: number
  win_rate: number
  total_profit_eth: number
  avg_profit_per_opp: number
}

export interface AutoresearchReport {
  run_id: number
  timestamp: string
  missed_opps_analyzed: number
  simulations_run: number
  current_score: ShadowScore
  proposed_score: ShadowScore | null
  improvement_pct: number | null
  applied: boolean
  new_params: HeuristicParams | null
  rationale: string
}
