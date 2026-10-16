'use server'

import { revalidatePath } from 'next/cache'
import { withActor } from '@/lib/db'
import { settingValues } from '@/lib/queries/cashflow'
import { enqueueOutbox, flushOutbox } from '@/lib/jobs/outbox'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

const STATUSES = ['open', 'in_progress', 'waiting', 'done']
const PRIORITIES = ['high', 'normal', 'low']

/** מסך 15 — משימה חדשה (ב.10). כל השדות אופציונליים חוץ מהכותרת. */
export async function addTask(fd: FormData): Promise<Result<{ id: string }>> {
  const title = str(fd, 'title')
  if (!title) return { ok: false, error: 'יש להזין כותרת' }
  const priority = str(fd, 'priority') ?? 'normal'
  if (!PRIORITIES.includes(priority)) return { ok: false, error: 'עדיפות לא מוכרת' }
  const tags = (str(fd, 'tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean)

  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into tasks (title, description, assignee_id, due_date, priority, status, parent_task_id, deal_id, tags, notes)
        values (${title}, ${str(fd, 'description')}, ${str(fd, 'assignee_id')}, ${str(fd, 'due_date')},
                ${priority}, 'open', ${str(fd, 'parent_task_id')}, ${str(fd, 'deal_id')}, ${tags}, ${str(fd, 'notes')})
        returning id`
      return row!.id
    })
    // ב.10 — "אחראי מקבל וואטסאפ על משימה חדשה/דחופה". דרך outbox (הנחיה 16).
    if (priority === 'high') await notifyAssignee(title, str(fd, 'due_date'))
    revalidatePath('/tasks')
    return { ok: true, id }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

async function notifyAssignee(title: string, dueDate: string | null) {
  const s = await settingValues(['notify_whatsapp_dan'])
  const target = typeof s.notify_whatsapp_dan === 'string' ? s.notify_whatsapp_dan : null
  if (!target) return
  const base = process.env.APP_BASE_URL ?? ''
  await enqueueOutbox([{
    channel: 'whatsapp', target, subject: null,
    body: `משימה דחופה: ${title}${dueDate ? ` · ליום ${dueDate}` : ''}${base ? `\n${base}/tasks` : ''}`,
    dedupKey: `task_urgent:${title}:${new Date().toISOString().slice(0, 10)}`,
  }])
  await flushOutbox()
}

export async function setTaskStatus(id: string, status: string): Promise<Result> {
  if (!STATUSES.includes(status)) return { ok: false, error: 'סטטוס לא מוכר' }
  try {
    await withActor(async (tx) => {
      await tx`update tasks set status = ${status} where id = ${id} and deleted_at is null`
    })
    revalidatePath('/tasks'); revalidatePath('/')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function updateTask(id: string, patch: {
  assignee_id?: string | null; due_date?: string | null; priority?: string; waiting_on?: string | null; notes?: string | null
}): Promise<Result> {
  if (patch.priority && !PRIORITIES.includes(patch.priority)) return { ok: false, error: 'עדיפות לא מוכרת' }
  try {
    await withActor(async (tx) => {
      await tx`
        update tasks set
          assignee_id = ${patch.assignee_id === undefined ? null : patch.assignee_id}::uuid,
          due_date    = coalesce(${patch.due_date ?? null}::date, due_date),
          priority    = coalesce(${patch.priority ?? null}, priority),
          waiting_on  = ${patch.waiting_on === undefined ? null : patch.waiting_on}::uuid,
          notes       = coalesce(${patch.notes ?? null}, notes)
        where id = ${id} and deleted_at is null`
    })
    revalidatePath('/tasks')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** §11.4 — אין מחיקה פיזית. משימה אוטומטית לא נמחקת ידנית: היא נסגרת לבד. */
export async function deleteTask(id: string): Promise<Result> {
  try {
    const blocked = await withActor(async (tx) => {
      const [t] = await tx<{ auto_generated: boolean }[]>`select auto_generated from tasks where id = ${id} and deleted_at is null`
      if (t?.auto_generated) return true
      await tx`update tasks set deleted_at = now() where id = ${id} and deleted_at is null`
      return false
    })
    if (blocked) return { ok: false, error: 'משימה אוטומטית נסגרת לבד כשהתנאי מפסיק להתקיים (ב.10) — אפשר לסמן "בוצע"' }
    revalidatePath('/tasks')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

// ── מסך 16 — שאלות לשותפים ─────────────────────────────────────────────────

/**
 * השותף עונה מהנייד: התשובה נשמרת ב-review_note, הסטטוס נסגר, ואם נבחרה
 * קטגוריה — היא נכתבת לתנועה. השאלה נשארת בהיסטוריה של התנועה.
 */
export async function answerQuestion(txId: string, answer: string, opts: { categoryId?: string | null; deductible?: boolean | null } = {}): Promise<Result> {
  if (!answer.trim()) return { ok: false, error: 'יש לכתוב תשובה' }
  try {
    await withActor(async (tx) => {
      const [t] = await tx<{ review_note: string | null; review_status: string }[]>`
        select review_note, review_status::text from transactions where id = ${txId} and deleted_at is null`
      const prefix = t?.review_note ? `${t.review_note}\n` : ''
      const who = { ask_nissim: 'ניסים', ask_aviv: 'אביב', ask_yoni: 'יוני' }[t?.review_status ?? ''] ?? 'השותף'
      await tx`
        update transactions
        set review_status = 'ok',
            review_note = ${`${prefix}תשובת ${who} (${new Date().toISOString().slice(0, 10)}): ${answer.trim()}`},
            category_id = coalesce(${opts.categoryId ?? null}::uuid, category_id),
            deductible = coalesce(${opts.deductible ?? null}::boolean, deductible)
        where id = ${txId} and deleted_at is null`
      // המשימה האוטומטית שנפתחה על התנועה נסגרת יחד איתה (ב.10).
      await tx`update tasks set status = 'done' where tx_id = ${txId} and auto_generated and status <> 'done'`
    })
    revalidatePath('/questions'); revalidatePath('/transactions'); revalidatePath('/nissim')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** סימון "לשאול את…" מהמסך — כדי שהתור יתמלא גם ידנית. */
export async function askPartner(txId: string, who: 'ask_nissim' | 'ask_aviv' | 'ask_yoni', question?: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`
        update transactions
        set review_status = ${who}::review_status,
            review_note = coalesce(${question ?? null}, review_note)
        where id = ${txId} and deleted_at is null`
    })
    revalidatePath('/questions'); revalidatePath('/transactions')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

// ── מסך 17 — קישורים ───────────────────────────────────────────────────────

export async function addLink(fd: FormData): Promise<Result<{ id: string }>> {
  const title = str(fd, 'title')
  const url = str(fd, 'url')
  const category = str(fd, 'category') ?? 'כללי'
  if (!title) return { ok: false, error: 'יש להזין שם' }
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: 'כתובת חייבת להתחיל ב-http או https' }
  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into links (title, url, category, sort_order)
        values (${title}, ${url}, ${category},
                coalesce((select max(sort_order) + 1 from links where category = ${category} and deleted_at is null), 0))
        returning id`
      return row!.id
    })
    revalidatePath('/links')
    return { ok: true, id }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function deleteLink(id: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update links set deleted_at = now() where id = ${id} and deleted_at is null`
    })
    revalidatePath('/links')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
