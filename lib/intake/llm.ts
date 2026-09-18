/**
 * חילוץ שדות ממסמך לא מוכר ב-LLM — ADDENDUM ב.3 שלב 3 / הנחיה 17:
 * "LLM = הצעה בלבד". התוצאה נכנסת ל-inbox_candidates.extracted עם method='llm' ו-verified=false.
 * מפתח: ANTHROPIC_API_KEY בסביבת השרת (או ant auth). בלי מפתח — מדלגים בשקט על השלב הזה.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Extracted } from './extract'

const InvoiceFields = z.object({
  supplier_name: z.string().nullable().describe('שם הספק כפי שמופיע במסמך'),
  doc_type: z.enum(['invoice', 'receipt', 'invoice_receipt', 'credit_note', 'statement', 'other']),
  doc_number: z.string().nullable(),
  date: z.string().nullable().describe('YYYY-MM-DD'),
  currency: z.enum(['ILS', 'USD', 'EUR', 'other']),
  net: z.number().nullable().describe('סכום לפני מע"מ'),
  vat: z.number().nullable(),
  gross: z.number().nullable().describe('סה"כ לתשלום כולל מע"מ'),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullable(),
})

export type LlmInvoiceFields = z.infer<typeof InvoiceFields>

export function llmAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE)
}

const SYSTEM = `אתה מחלץ שדות ממסמכי הנהלת חשבונות ישראליים (חשבונית מס, קבלה, חשבונית-קבלה, זיכוי) לצורך רישום הוצאה.
החזר רק מה שכתוב במסמך. אם שדה לא מופיע — null. סכומים כמספרים (ללא פסיפים). תאריך בפורמט YYYY-MM-DD (בישראל כותבים יום/חודש/שנה).
"סה"כ לתשלום" הוא gross. אם יש רק gross ומע"מ 18% — אל תמציא net. confidence = עד כמה אתה בטוח שהשדות נכונים.`

/** מקבל טקסט (מ-pdf-parse) או PDF גולמי (לסרוקים) ומחזיר הצעה. */
export async function proposeWithClaude(input: { text?: string; pdf?: Buffer; fileName?: string }, client: Anthropic = new Anthropic()): Promise<Extracted> {
  const content: Anthropic.ContentBlockParam[] = []
  if (input.pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.toString('base64') } })
  content.push({ type: 'text', text: `קובץ: ${input.fileName ?? ''}\n${input.text ? `טקסט המסמך:\n${input.text.slice(0, 20_000)}` : 'המסמך מצורף.'}` })
  const res = await client.beta.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(InvoiceFields) },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  })
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`ה-LLM לא החזיר שדות (${res.stop_reason})`)
  const p = res.parsed_output
  return {
    supplierName: p.supplier_name ?? undefined, docNumber: p.doc_number ?? undefined, date: p.date ?? undefined,
    gross: p.gross ?? undefined, vat: p.vat ?? undefined, net: p.net ?? undefined,
    currency: p.currency === 'other' ? undefined : p.currency,
    confidence: Math.round(p.confidence * 100) / 100, method: 'llm',
    warnings: [...(p.doc_type === 'statement' ? ['נראה כמו דף פירוט — לתור הייבוא'] : []), ...(p.notes ? [p.notes] : [])],
  }
}
