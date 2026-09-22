import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { Card, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Money } from '@/components/money'
import { KpiCard } from '@/components/kpi-card'
import {
  CertaintyPill, CollectionPill, DivisionPill, InvoicePill, PeriodPill, ReviewPill, StatusPill,
} from '@/components/status-pill'
import { StaleBadge } from '@/components/stale-badge'
import { RiskBanner } from '@/components/risk-banner'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { UiKitClient } from './client'

/**
 * /ui-kit — UIUX הנחיה 23: "כל הרכיבים בכל המצבים — נבנה בשלב 2, לפני המסכים."
 * הערכים כאן הם דוגמאות ויזואליות בלבד ואינם נתונים (SPEC §11.11).
 */
export default async function UiKitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const twoDaysAgo = new Date(Date.now() - 50 * 3_600_000).toISOString()
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  return (
    <>
      <Topbar period={period} division={division} alertCount={3} />
      <RiskBanner message="נקודה נמוכה −12,000 ₪ ב-08/11" />
      <main className="p-4 md:p-6 flex flex-col gap-8 max-w-6xl">
        <header>
          <h1 className="text-xl font-semibold">ספריית רכיבים</h1>
          <p className="text-sm text-text-2">UIUX §4 — כל רכיב בכל מצב. הערכים כאן הם דוגמאות בלבד.</p>
        </header>

        {/* ── Tokens ── */}
        <Section title="Tokens — ודאות היא צבע (UIUX §1.2)">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ['actual', 'בפועל'], ['committed', 'ודאי צפוי'], ['expected', 'פוטנציאל'],
              ['open', 'פתוח / חסר'], ['locked', 'נעול'],
            ].map(([k, l]) => (
              <div key={k} className={`rounded-[var(--radius-card)] p-3 bg-${k}-bg`}>
                <div className={`w-6 h-6 rounded-full bg-${k} mb-2`} />
                <div className={`text-sm font-medium text-${k}`}>{l}</div>
                <div className="text-[10px] text-text-3 font-mono">--{k}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {[['realestate', 'נדל"ן'], ['finance', 'מימון'], ['shared', 'משותף'], ['private', 'פרטי']].map(([k, l]) => (
              <Card key={k} division={k as 'finance'}><DivisionPill division={k!} /><div className="text-xs text-text-3 mt-1">{l} — פס 3px</div></Card>
            ))}
          </div>
        </Section>

        {/* ── Money ── */}
        <Section title="<Money> — UIUX §4.3">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <CardTitle>לפי ודאות</CardTitle>
              <div className="flex flex-col gap-2 mt-2">
                <Row label="actual"><Money value={123_456.78} certainty="actual" /></Row>
                <Row label="committed"><Money value={45_000} certainty="committed" /></Row>
                <Row label="expected"><Money value={242_000} certainty="expected" /></Row>
                <Row label="open"><Money value={8_200} nature="open" /></Row>
                <Row label="locked"><Money value={17_360} nature="locked" /></Row>
                <Row label="שלילי — מינוס אמיתי"><Money value={-12_000} /></Row>
                <Row label="tooltip net/vat/gross"><Money value={14_160} vat={{ net: 12_000, vat: 2_160, gross: 14_160 }} /></Row>
              </div>
            </Card>
            <Card>
              <CardTitle>גדלים — אגורות מוסתרות בכרטיסים, מוצגות בטבלאות</CardTitle>
              <div className="flex flex-col gap-3 mt-2 items-start">
                <Money value={1_234.56} size="sm" />
                <Money value={1_234.56} size="md" />
                <Money value={1_234.56} size="lg" />
                <Money value={187_400.5} size="kpi" certainty="actual" />
              </div>
            </Card>
          </div>
          <Card>
            <CardTitle>hero — 56px, "מספר הבוקר בנייד": ממלא את הרוחב (UIUX §1.1)</CardTitle>
            <div className="mt-2"><Money value={187_400.5} size="hero" certainty="actual" /></div>
          </Card>
        </Section>

        {/* ── KpiCard ── */}
        <Section title="<KpiCard> — UIUX §4.1">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="נגבה החודש" value={123_500} certainty="actual" icon={<ArrowDownLeft size={16} />}
              delta={0.12} subtitle="· יעד 500K" division="finance"
              drill={<p className="text-sm text-text-2">כאן יופיעו השורות שמרכיבות את המספר.</p>}
            />
            <KpiCard title="פתוח ודאי" value={153_142} certainty="committed" delta={-0.04} division="finance" drill={<p className="text-sm">…</p>} />
            <KpiCard title="פוטנציאל" value={242_000} certainty="expected" icon={<ArrowUpRight size={16} />} drill={<p className="text-sm">…</p>} />
            <KpiCard
              title="מזומן" value={187_400} certainty="actual"
              stale={<StaleBadge updatedAt={twoDaysAgo} now={now} />}
              drill={<p className="text-sm">…</p>}
            />
            <KpiCard title="טעינה" value={0} loading />
            <KpiCard title="בלי drill (אסור במסך אמיתי)" value={9_999} nature="locked" />
          </div>
        </Section>

        {/* ── StatusPill ── */}
        <Section title="<StatusPill> — UIUX §4.2">
          <Card>
            <div className="flex flex-wrap gap-2">
              <CertaintyPill certainty="actual" /><CertaintyPill certainty="committed" /><CertaintyPill certainty="expected" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <CollectionPill status="fully_paid" /><CollectionPill status="partially_paid" /><CollectionPill status="advance_paid" />
              <CollectionPill status="not_collected" /><CollectionPill status="not_collected" daysOverdue={32} />
              <CollectionPill status="legal_collection" /><CollectionPill status="cancelled" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <InvoicePill status="has_invoice" /><InvoicePill status="missing" /><InvoicePill status="no_invoice_needed" /><InvoicePill status="unknown" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <PeriodPill locked period="08/2026" /><PeriodPill locked={false} period="09/2026" />
              <ReviewPill status="ok" /><ReviewPill status="ask_nissim" /><ReviewPill status="ask_aviv" /><ReviewPill status="unknown_expense" />
              <StatusPill tone="neutral">ניטרלי</StatusPill>
            </div>
          </Card>
        </Section>

        {/* ── StaleBadge / RiskBanner ── */}
        <Section title="<StaleBadge> · <RiskBanner> — UIUX §4.1, §4.8">
          <Card className="flex flex-col gap-2">
            <StaleBadge updatedAt={oneHourAgo} now={now} />
            <StaleBadge updatedAt={twoDaysAgo} now={now} />
            <StaleBadge updatedAt={null} now={now} />
            <p className="text-xs text-text-3 mt-2">פס הסיכון מוצג בראש העמוד הזה.</p>
          </Card>
        </Section>

        {/* ── Forms ── */}
        <Section title="טפסים — UIUX §4.6">
          <Card>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="סכום" required hint="ללא מע״מ · מע״מ 2,160 · כולל 14,160"><Input inputMode="decimal" placeholder="0" dir="ltr" /></Field>
              <Field label="ספק" error="שדה חובה"><Input placeholder="חיפוש…" /></Field>
              <Field label="פעילות"><Select defaultValue="finance"><option value="finance">מימון</option><option value="realestate">נדל"ן</option><option value="shared">משותף</option></Select></Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="primary">ראשי</Button><Button>משני</Button><Button variant="ghost">שקוף</Button>
              <Button variant="danger">מחיקה</Button><Button disabled>מושבת</Button><Button size="sm">קטן</Button><Button size="lg">גדול</Button>
            </div>
          </Card>
        </Section>

        {/* ── Client-only: DataTable, DrillDrawer, PinGate ── */}
        <UiKitClient />

        <Section title="Skeleton — UIUX §4.1 'skeleton, לא spinner'">
          <Card><div className="skeleton h-4 w-32 mb-2" /><div className="skeleton h-10 w-56 mb-2" /><div className="skeleton h-3 w-40" /></Card>
        </Section>
      </main>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-text-2 font-mono" dir="ltr">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-text-3 text-xs">{label}</span>
      {children}
    </div>
  )
}
