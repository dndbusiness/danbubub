'use server'

import { revalidatePath } from 'next/cache'
import { withActor } from '@/lib/db'
import { isPeriodLocked, vatRateOn } from '@/lib/queries/common'

const NATURES = ['income', 'expense', 'financing', 'transfer', 'advance', 'draw', 'vat', 'tax'] as const
const DIVISIONS = ['finance', 'realestate', 'shared', 'private'] as const

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(fd: FormData, k: string): number | null {
  const v = str(fd, k)
  if (v === null) return null
  const n = Number(v.replace(/[,\s₪]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * הזנה ידנית של תנועה — SPEC §5 מסך 5.
 * המע"מ מחושב ב-DB (trigger, §11.5). הנעילה נאכפת ב-DB (§11.8) וגם כאן לפני,
 * כדי להחזיר הודעה ברורה ולא שגיאת SQL.
 */
export async function createTransaction(fd: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const dateCash = str(fd, 'date_cash')
  const accountId = str(fd, 'account_id')
  const amount = num(fd, 'amount')
  const nature = str(fd, 'nature') as (typeof NATURES)[number] | null
  const division = str(fd, 'division') as (typeof DIVISIONS)[number] | null
  const vatMode = str(fd, 'vat_mode') ?? 'excl'
  const categoryId = str(fd, 'category_id')
  const dealId = str(fd, 'deal_id')
  const fixedExpenseId = str(fd, 'fixed_expense_id')
  const partnerId = str(fd, 'partner_id')
  const txClass = str(fd, 'tx_class') ?? 'business'
  const deductible = fd.get('deductible') === 'on'
  const invoiceStatus = str(fd, 'invoice_status') ?? 'unknown'
  const counterparty = str(fd, 'counterparty')
  const description = str(fd, 'description')
  const financeSplit = num(fd, 'split_finance')

  if (!dateCash || !accountId || amount === null || !nature || !division) {
    return { ok: false, error: 'חסרים שדות חובה: תאריך, חשבון, סכום, סוג, פעילות' }
  }
  if (!NATURES.includes(nature) || !DIVISIONS.includes(division)) return { ok: false, error: 'ערך לא חוקי' }
  if (nature === 'expense' && !categoryId) return { ok: false, error: 'הוצאה חייבת קטגוריה (נספח ב #7)' }
  if (nature === 'draw' && !partnerId) return { ok: false, error: 'משיכה חייבת שותף' }
  if (nature === 'advance' && division !== 'finance') return { ok: false, error: 'מקדמה לניסים היא תמיד בפעילות המימון' }

  // SPEC §2.1 — הכנסה חיובית, הוצאה שלילית. המשתמש מקליד סכום; הסימן נגזר מהטבע.
  const signed = nature === 'income' ? Math.abs(amount) : nature === 'expense' ? -Math.abs(amount) : amount

  const month = dateCash.slice(0, 7)
  const lockDivision = division === 'realestate' ? 'realestate' : 'finance'
  if (await isPeriodLocked(month, lockDivision)) {
    return { ok: false, error: `התקופה ${month.slice(5)}/${month.slice(0, 4)} נעולה. תיקון = תנועת תיקון בתקופה הפתוחה (SPEC §1.6)` }
  }

  const vatRate = await vatRateOn(dateCash)
  const split = division === 'shared'
    ? JSON.stringify({ finance: financeSplit ?? 0.8, realestate: 1 - (financeSplit ?? 0.8) })
    : null

  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into transactions
          (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, division_split,
           category_id, tx_class, deductible, fixed_expense_id, deal_id, partner_id,
           counterparty, description, invoice_status, source)
        values
          (${dateCash}, ${accountId}, ${signed}, ${vatMode}, ${vatRate}, ${nature}, ${division}, ${split}::jsonb,
           ${categoryId}, ${txClass}, ${nature === 'expense' ? deductible : null}, ${fixedExpenseId}, ${dealId}, ${partnerId},
           ${counterparty}, ${description}, ${invoiceStatus}, 'manual')
        returning id`
      return row!.id
    })
    revalidatePath('/transactions')
    if (dealId) revalidatePath(`/deals/${dealId}`)
    if (fixedExpenseId) revalidatePath('/fixed-expenses')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** סיווג בשורה — UIUX §4.5 "✎ עריכה בשורה לשדות פשוטים". */
export async function classifyTransaction(
  id: string,
  patch: {
    category_id?: string | null
    division?: string
    tx_class?: string
    deductible?: boolean
    invoice_status?: string
    review_status?: string
    deal_id?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withActor(async (tx) => {
      await tx`update transactions set ${tx(patch)} where id = ${id} and deleted_at is null`
    })
    revalidatePath('/transactions')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** SPEC §11.4 — soft delete בלבד. */
export async function softDeleteTransaction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withActor(async (tx) => {
      await tx`update transactions set deleted_at = now() where id = ${id}`
    })
    revalidatePath('/transactions')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
