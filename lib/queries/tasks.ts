import { sql } from '@/lib/db'

/**
 * מסך 15 — תפעול ומשימות (ADDENDUM ב.10).
 * "משימה אוטומטית נסגרת לבד כשהתנאי מפסיק להתקיים" — הסגירה האוטומטית
 * יושבת ב-lib/jobs/tasks.ts; כאן רק קריאה.
 */

export interface TaskRow {
  id: string
  title: string
  description: string | null
  notes: string | null
  assignee_id: string | null
  assignee_name: string | null
  waiting_on: string | null
  waiting_on_name: string | null
  due_date: string | null
  priority: 'high' | 'normal' | 'low'
  status: 'open' | 'in_progress' | 'waiting' | 'done'
  parent_task_id: string | null
  deal_id: string | null
  deal_client: string | null
  tx_id: string | null
  employee_id: string | null
  supplier_id: string | null
  auto_generated: boolean
  auto_key: string | null
  tags: string[]
  subtasks: number
  subtasks_done: number
  created_at: string
  overdue_days: number
}

export async function listTasks(opts: { status?: string; assignee?: string; dealId?: string } = {}): Promise<TaskRow[]> {
  return sql<TaskRow[]>`
    select t.id, t.title, t.description, t.notes, t.assignee_id::text, u.full_name as assignee_name,
           t.waiting_on::text, w.full_name as waiting_on_name,
           to_char(t.due_date, 'YYYY-MM-DD') as due_date, t.priority, t.status,
           t.parent_task_id::text, t.deal_id::text, d.client_name as deal_client, t.tx_id::text,
           t.employee_id::text, t.supplier_id::text, t.auto_generated, t.auto_key, t.tags,
           (select count(*) from tasks s where s.parent_task_id = t.id and s.deleted_at is null)::int as subtasks,
           (select count(*) from tasks s where s.parent_task_id = t.id and s.deleted_at is null and s.status = 'done')::int as subtasks_done,
           t.created_at::text,
           greatest(0, current_date - t.due_date)::int as overdue_days
    from tasks t
    left join users u on u.id = t.assignee_id
    left join users w on w.id = t.waiting_on
    left join deals d on d.id = t.deal_id
    where t.deleted_at is null
      and (${opts.status ?? null}::text is null or t.status = ${opts.status ?? null})
      and (${opts.assignee ?? null}::uuid is null or t.assignee_id = ${opts.assignee ?? null})
      and (${opts.dealId ?? null}::uuid is null or t.deal_id = ${opts.dealId ?? null})
    order by
      case t.status when 'open' then 0 when 'in_progress' then 1 when 'waiting' then 2 else 3 end,
      case t.priority when 'high' then 0 when 'normal' then 1 else 2 end,
      t.due_date nulls last, t.created_at desc
    limit 400`
}

export interface TaskCounts {
  today: number; week: number; overdue: number; waiting: number; auto: number; done7: number; open: number
}

export async function taskCounts(): Promise<TaskCounts> {
  const [r] = await sql<TaskCounts[]>`
    select
      count(*) filter (where status <> 'done' and due_date = current_date)::int                          as today,
      count(*) filter (where status <> 'done' and due_date between current_date and current_date + 6)::int as week,
      count(*) filter (where status <> 'done' and due_date < current_date)::int                          as overdue,
      count(*) filter (where status = 'waiting')::int                                                    as waiting,
      count(*) filter (where status <> 'done' and auto_generated)::int                                   as auto,
      count(*) filter (where status = 'done' and updated_at >= now() - interval '7 days')::int            as done7,
      count(*) filter (where status <> 'done')::int                                                      as open
    from tasks where deleted_at is null`
  return r ?? { today: 0, week: 0, overdue: 0, waiting: 0, auto: 0, done7: 0, open: 0 }
}

export async function listUsers(): Promise<{ id: string; full_name: string; role: string }[]> {
  return sql`select id, full_name, role::text from users where deleted_at is null and active order by full_name`
}

/** ב.10 — "ווידג'ט 3 המשימות הבאות". */
export async function nextTasks(limit = 3): Promise<TaskRow[]> {
  const all = await listTasks()
  return all.filter((t) => t.status !== 'done').slice(0, limit)
}

// ── מסך 16 — שאלות לשותפים ─────────────────────────────────────────────────

export interface QuestionRow {
  tx_id: string
  date: string
  amount_gross: number
  counterparty: string | null
  description: string | null
  category_name: string | null
  review_status: string
  review_note: string | null
  division: string
  days_open: number
  account_name: string | null
}

const ASK = ['ask_nissim', 'ask_aviv', 'ask_yoni'] as const
export type AskWho = (typeof ASK)[number]

/**
 * מסך 16 — "תור 'לשאול את ניסים/אביב' — השותף עונה מהנייד וסוגר".
 * התור הוא תנועות שסומנו לשאלה; התשובה נכתבת ל-review_note והסטטוס נסגר.
 */
export async function listQuestions(who?: AskWho): Promise<QuestionRow[]> {
  return sql<QuestionRow[]>`
    select t.id as tx_id, to_char(t.date_cash, 'YYYY-MM-DD') as date, t.amount_gross,
           t.counterparty, t.description, c.name as category_name, t.review_status::text,
           t.review_note, t.division::text, a.name as account_name,
           greatest(0, current_date - t.date_cash)::int as days_open
    from transactions t
    left join categories c on c.id = t.category_id
    left join accounts a on a.id = t.account_id
    where t.deleted_at is null and t.review_status::text = any(${who ? [who] : [...ASK]})
    order by t.date_cash desc limit 300`
}

export async function questionCounts(): Promise<{ who: string; n: number; amount: number }[]> {
  return sql`
    select review_status::text as who, count(*)::int as n, coalesce(sum(abs(amount_gross)), 0) as amount
    from transactions
    where deleted_at is null and review_status::text = any(${[...ASK]})
    group by review_status order by count(*) desc`
}

// ── מסך 17 — קישורים ───────────────────────────────────────────────────────

export interface LinkRow { id: string; title: string; url: string; category: string; icon: string | null; sort_order: number }

export async function listLinks(): Promise<LinkRow[]> {
  return sql<LinkRow[]>`
    select id, title, url, category, icon, sort_order from links
    where deleted_at is null order by category, sort_order, title`
}
