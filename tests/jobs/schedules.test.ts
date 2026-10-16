import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import schedules from '../../deploy/jobs.schedule.json'

/**
 * הנחיה 14: "חלק ג' הוא המקור היחיד לאוטומציות — אין ג'וב שלא רשום שם."
 *
 * בפועל התזמונים חיים בשני מקומות טכניים: deploy/jobs.schedule.json (שממנו
 * server-install.sh גוזר את cron של השרת) ו-.github/workflows/cron.yml
 * (ש-GitHub Actions דורש כטקסט בקובץ, ואי אפשר לייצר בזמן ריצה).
 * הבדיקה הזו היא מה שמונע מהשניים להיפרד בשקט.
 */
const workflow = readFileSync('.github/workflows/cron.yml', 'utf8')

const workflowCrons = new Set(
  [...workflow.matchAll(/^\s*- cron:\s*'([^']+)'/gm)].map((m) => m[1]!),
)
const jobNames = new Set(schedules.jobs.map((j) => j.name))

describe('תזמוני חלק ג׳', () => {
  it('19 הג׳ובים רשומים', () => {
    expect(schedules.jobs).toHaveLength(19)
    expect(jobNames.size).toBe(19)
  })

  it('לכל ג׳וב יש נתיב שתואם לשמו', () => {
    for (const j of schedules.jobs) expect(j.path).toBe(`/api/jobs/${j.name}`)
  })

  it('כל תזמון הוא ביטוי cron בן 5 שדות', () => {
    for (const j of schedules.jobs) expect(j.schedule.trim().split(/\s+/)).toHaveLength(5)
  })

  it('כל תזמון קיים גם ב-GitHub Actions', () => {
    const missing = schedules.jobs
      .filter((j) => !workflowCrons.has(j.schedule))
      .map((j) => `${j.name} (${j.schedule})`)
    expect(missing, 'ג׳ובים שלא ירוצו ב-GitHub Actions').toEqual([])
  })

  it('אין ב-GitHub Actions תזמון שאינו מוכר', () => {
    const extra = [...workflowCrons].filter((c) => !schedules.jobs.some((j) => j.schedule === c))
    expect(extra, 'תזמון ב-cron.yml בלי ג׳וב מתאים').toEqual([])
  })

  it('Vercel Cron לא בשימוש — חשבון Hobby חוסם פריסה עם יותר מ-2 ג׳ובים יומיים', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
    expect(vercel.crons).toBeUndefined()
  })
})
