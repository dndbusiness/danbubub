'use client'

import * as React from 'react'
import { Card, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { Money } from '@/components/money'
import { PinGate } from '@/components/pin-gate'
import { CertaintyPill, InvoicePill } from '@/components/status-pill'

interface DemoRow {
  id: string
  date: string
  description: string
  amount: number
  certainty: 'actual' | 'committed' | 'expected'
  invoice: string
  division: 'finance' | 'realestate' | 'shared'
  locked: boolean
}

// דוגמאות ויזואליות בלבד — לא נתונים.
const rows: DemoRow[] = [
  { id: '1', date: '2026-09-01', description: 'שכירות משרד', amount: -8_000, certainty: 'actual', invoice: 'has_invoice', division: 'finance', locked: false },
  { id: '2', date: '2026-09-05', description: 'תוכנה ומערכות', amount: -5_000, certainty: 'actual', invoice: 'missing', division: 'shared', locked: false },
  { id: '3', date: '2026-08-14', description: 'שכ"ט לקוח', amount: 50_000, certainty: 'actual', invoice: 'has_invoice', division: 'finance', locked: true },
  { id: '4', date: '2026-10-10', description: 'יתרה — success fee', amount: 38_000, certainty: 'committed', invoice: 'unknown', division: 'finance', locked: false },
  { id: '5', date: '2026-09-06', description: 'עמלת יזם', amount: 40_000, certainty: 'expected', invoice: 'no_invoice_needed', division: 'realestate', locked: false },
]

const columns: Column<DemoRow>[] = [
  { key: 'date', header: 'תאריך' },
  { key: 'description', header: 'תיאור' },
  { key: 'certainty', header: 'ודאות', cell: (r) => <CertaintyPill certainty={r.certainty} /> },
  { key: 'invoice', header: 'חשבונית', cell: (r) => <InvoicePill status={r.invoice} /> },
  {
    key: 'amount', header: 'סכום', align: 'end',
    cell: (r) => <Money value={r.amount} certainty={r.certainty} />,
    footer: <Money value={rows.reduce((a, r) => a + r.amount, 0)} />,
  },
]

export function UiKitClient() {
  const [drill, setDrill] = React.useState<DemoRow | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-2 font-mono" dir="ltr">{'<DataTable> — UIUX §4.5'}</h2>
        <DataTable
          rows={rows}
          columns={columns}
          onRowClick={setDrill}
          rowDivision={(r) => r.division}
          rowLocked={(r) => r.locked}
          exportName="ui-kit"
          initialSort={{ key: 'date', dir: 'desc' }}
        />
        <DataTable rows={[]} columns={columns} emptyState="אין תנועות לא מזוהות. 🎉" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-2 font-mono" dir="ltr">{'<DrillDrawer> — UIUX §4.4'}</h2>
        <Card>
          <Button onClick={() => setDrawerOpen(true)}>פתח מגירה</Button>
          <DrillDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            title="הוצאות קבועות מוכרות"
            amount={<Money value={17_360} size="lg" certainty="actual" />}
            breadcrumb={['כרטיס ניסים', '09/2026']}
            footer={<Button variant="ghost" size="sm">ייצוא</Button>}
          >
            <DataTable rows={rows.slice(0, 3)} columns={columns} exportName="drill" />
          </DrillDrawer>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-2 font-mono" dir="ltr">{'<PinGate> — SPEC §6'}</h2>
        <PinGate areaLabel="כרטיס ניסים" verify={async (pin) => pin === '1234'}>
          <Card>
            <CardTitle>תוכן מוגן (דוגמה: הקוד 1234)</CardTitle>
            <Money value={36_517} size="kpi" nature="open" />
          </Card>
        </PinGate>
      </section>

      <DrillDrawer
        open={drill !== null}
        onOpenChange={(o) => !o && setDrill(null)}
        title={drill?.description ?? ''}
        amount={drill && <Money value={drill.amount} certainty={drill.certainty} size="lg" />}
        breadcrumb={['טבלה', 'שורה']}
      >
        <p className="text-sm text-text-2">מגירה שנייה מתוך שורה — breadcrumb בראש.</p>
      </DrillDrawer>
    </>
  )
}
