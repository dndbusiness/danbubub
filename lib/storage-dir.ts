import { tmpdir } from 'node:os'
import path from 'node:path'

/** האם אנחנו ב-serverless (Vercel / Lambda) — שם אין דפדפן מותקן ותיקיית הקוד לקריאה בלבד. */
export function isServerless(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_EXECUTION_ENV)
}

/**
 * תיקיית עבודה לקבצים שהמערכת כותבת (גיבויים, דוחות, קליטת מסמכים).
 * מקומית — `storage/` בתיקיית הפרויקט. ב-serverless תיקיית הקוד (/var/task) לקריאה בלבד,
 * ולכן `/tmp`: זמני לכל ריצה — העותק הקבוע הוא בדרייב או במסד (lib/files.ts), לא כאן.
 */
export function storageDir(sub: string, env: Record<string, string | undefined> = process.env): string {
  const base = env.STORAGE_DIR ?? (isServerless(env) ? path.join(tmpdir(), 'harel-storage') : path.join(process.cwd(), 'storage'))
  return path.join(base, sub)
}
