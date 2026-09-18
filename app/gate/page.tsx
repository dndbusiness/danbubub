import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'

export const dynamic = 'force-dynamic'

/** שער הגישה הזמני (ראו middleware.ts). לא מסך ההתחברות של §6 — זה שלב 10. */
export default async function GatePage({ searchParams }: { searchParams: Promise<{ next?: string; bad?: string }> }) {
  const sp = await searchParams
  const next = typeof sp.next === 'string' && sp.next.startsWith('/') ? sp.next : '/'

  async function enter(fd: FormData) {
    'use server'
    const password = process.env.APP_PASSWORD
    const given = String(fd.get('password') ?? '')
    const target = String(fd.get('next') ?? '/')
    if (!password || given !== password) redirect(`/gate?next=${encodeURIComponent(target)}&bad=1`)
    let h = 0x811c9dc5
    for (let i = 0; i < password.length; i++) { h ^= password.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    const jar = await cookies()
    jar.set('harel_gate', (h >>> 0).toString(36) + password.length.toString(36), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
    redirect(target.startsWith('/') ? target : '/')
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm flex flex-col gap-4">
        <div className="flex items-center gap-2"><Lock size={18} className="text-text-2" /><h1 className="font-semibold">הר-אל — כספים</h1></div>
        <form action={enter} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <Field label="קוד גישה" required error={sp.bad ? 'קוד שגוי' : undefined}>
            <Input name="password" type="password" autoFocus required autoComplete="current-password" />
          </Field>
          <Button type="submit" variant="primary">כניסה</Button>
        </form>
        <p className="text-xs text-text-3">שער זמני עד שלב 10. אזורי ניסים, שותפים ופרייבט מוגנים בנוסף ב-PIN.</p>
      </Card>
    </main>
  )
}
