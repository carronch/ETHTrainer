import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SCHEMA_SQL } from './schema.js'

const DB_PATH = join(process.cwd(), 'data', 'ethtrainer.db')

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  // Ensure data directory exists
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  _db = new DatabaseSync(DB_PATH)

  // Enable WAL mode for better concurrent read performance
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')

  // Run schema migrations
  _db.exec(SCHEMA_SQL)

  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
