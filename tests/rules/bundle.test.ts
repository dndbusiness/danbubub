import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * db/bundle.sql הוא הסכימה כולה בקובץ אחד, להדבקה ב-SQL editor של בסיס
 * נתונים מנוהל — המסלול היחיד להקים סכימה בלי טרמינל. אם מוסיפים קובץ
 * ל-db/schema ושוכחים לייצר אותו מחדש, מי שמתקין מקבל סכימה חסרה בשקט.
 */
describe('db/bundle.sql', () => {
  it('מעודכן מול db/schema, db/views ו-db/seed', () => {
    const generated = execFileSync('node', ['scripts/build-sql-bundle.mjs'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    expect(readFileSync('db/bundle.sql', 'utf8'), 'הרצו: node scripts/build-sql-bundle.mjs > db/bundle.sql').toBe(generated)
  })
})
