import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isServerless, storageDir } from '@/lib/storage-dir'

describe('storageDir — תיקיית עבודה שאפשר לכתוב אליה', () => {
  it('מקומית: storage/ בתיקיית הפרויקט', () => {
    expect(storageDir('backups', {})).toBe(path.join(process.cwd(), 'storage', 'backups'))
  })
  it('ב-Vercel: /tmp, כי תיקיית הקוד לקריאה בלבד (db_backup נפל על mkdir /var/task/storage)', () => {
    expect(isServerless({ VERCEL: '1' })).toBe(true)
    expect(storageDir('backups', { VERCEL: '1' })).toBe(path.join(tmpdir(), 'harel-storage', 'backups'))
  })
  it('STORAGE_DIR גובר', () => {
    expect(storageDir('reports', { VERCEL: '1', STORAGE_DIR: '/data/x' })).toBe(path.join('/data/x', 'reports'))
  })
})
