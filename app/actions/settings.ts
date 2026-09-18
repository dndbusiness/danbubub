'use server'

import { revalidatePath } from 'next/cache'
import { disconnectGoogle } from '@/lib/google/store'
import { dailySummaryJob } from '@/lib/jobs/daily-summary'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export async function disconnectGoogleAction(): Promise<Result> {
  try { await disconnectGoogle(); revalidatePath('/settings'); return { ok: true } } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** "הפק עכשיו" — אותה פונקציה של הג'וב (הנחיה 20). */
export async function runDailySummaryNow(date?: string): Promise<Result<{ pdf: string | null; driveUrl: string | null; emailed: boolean; skipped?: string }>> {
  try {
    const r = await dailySummaryJob(date ?? new Date().toISOString().slice(0, 10), { force: true })
    revalidatePath('/settings')
    return { ok: true, pdf: r.pdf, driveUrl: r.driveUrl, emailed: r.emailed, skipped: r.skipped }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
