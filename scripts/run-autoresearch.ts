/**
 * Manual autoresearch trigger — run one cycle immediately.
 * Used for testing or manual triggering outside the nightly schedule.
 *
 *   npm run autoresearch
 */

import 'dotenv/config'
import { getDb } from '../src/db/index.js'
import { runAutoresearchCycle } from '../src/autoresearch/loop.js'

// Initialize DB first
getDb()

console.log('Running autoresearch cycle manually...\n')

runAutoresearchCycle()
  .then((report) => {
    console.log('\nCycle complete:')
    console.log(`  Analyzed: ${report.missed_opps_analyzed} missed opps`)
    console.log(`  Simulations: ${report.simulations_run}`)
    console.log(`  Applied: ${report.applied}`)
    if (report.improvement_pct !== null) {
      console.log(`  Improvement: ${report.improvement_pct.toFixed(2)}%`)
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('Failed:', err)
    process.exit(1)
  })
