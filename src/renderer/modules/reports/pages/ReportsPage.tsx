import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { Button, DataTable, Input, PageHeader, SummaryCard } from '@renderer/ui/components';
import { currency } from '@renderer/utils/format';
import { showToast } from '@renderer/utils/toast';
import type { ReportsSummary } from '@shared/types';

const localDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const today = new Date();
const todayKey = localDateKey(today);
const monthStartKey = localDateKey(new Date(today.getFullYear(), today.getMonth(), 1));
const yearStartKey = localDateKey(new Date(today.getFullYear(), 0, 1));
const sanitizeWindowsFileName = (value: string) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const reportModes = ['day', 'month', 'year', 'custom', 'all'] as const;
type ReportMode = (typeof reportModes)[number];
const reportThemes: Record<Exclude<ReportMode, 'all'>, { accent: string; bg: string }> = {
  day: { accent: '#2563eb', bg: '#eff6ff' },
  month: { accent: '#7c3aed', bg: '#f5f3ff' },
  year: { accent: '#b45309', bg: '#fffbeb' },
  custom: { accent: '#0f766e', bg: '#f0fdfa' }
};

const BarChart = ({
  title,
  rows,
  getLabel,
  getValue,
  color
}: {
  title: string;
  rows: any[];
  getLabel: (row: any) => string;
  getValue: (row: any) => number;
  color: string;
}) => {
  const max = Math.max(1, ...rows.map((row) => Number(getValue(row) || 0)));
  return (
    <div className="card-panel stack-gap">
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div className="stack-gap">
        {rows.slice(0, 14).map((row, index) => {
          const value = Number(getValue(row) || 0);
          const width = Math.max(2, Math.round((value / max) * 100));
          return (
            <div key={`${getLabel(row)}-${index}`} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getLabel(row)}
              </span>
              <div style={{ background: '#f1f5f9', borderRadius: 8, height: 12, overflow: 'hidden' }}>
                <div style={{ width: `${width}%`, height: '100%', background: color }} />
              </div>
              <strong style={{ fontSize: 12, textAlign: 'right' }}>{currency(value)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const buildThermalReportHtml = (
  title: string,
  data: ReportsSummary,
  companyName: string,
  generatedAt: string
) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: 80mm auto; margin: 2mm; }
      body { font-family: monospace; color: #000; margin: 0; padding: 0; width: 76mm; font-size: 11px; }
      .wrap { padding: 2mm; }
      h1 { font-size: 13px; text-align: center; margin: 0 0 6px; }
      .meta { color: #444; font-size: 10px; margin: 0 0 6px; }
      .line { display: flex; justify-content: space-between; border-top: 1px dashed #000; padding: 4px 0; gap: 8px; }
      .muted { color: #444; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>${companyName || 'Lavandería'}</h1>
      <div class="meta">${generatedAt}</div>
      <h1>${title}</h1>
      <div class="muted">${data.from} a ${data.to}</div>
      <div class="line"><span>Ventas</span><strong>${currency(data.totalSales)}</strong></div>
      <div class="line"><span>Gastos</span><strong>${currency(data.totalExpenses)}</strong></div>
      <div class="line"><span>Devoluciones (PAYMENT_OUT)</span><strong>${currency(data.totalPaymentOut)}</strong></div>
      <div class="line"><span>Utilidad</span><strong>${currency(data.netUtility)}</strong></div>
      <div class="line"><span>Pagos</span><strong>${currency(data.totalPayments)}</strong></div>
      <div class="line"><span>Órdenes</span><strong>${data.totalOrders}</strong></div>
      <div class="line"><span>Garantías (nuevas)</span><strong>${data.warrantiesCreated}</strong></div>
      <div class="line"><span>Garantías (cerradas)</span><strong>${data.warrantiesClosed}</strong></div>
      <div class="line"><span>Garantías abiertas</span><strong>${data.openWarranties}</strong></div>
    </div>
  </body>
</html>`;

const ReportSection = ({
  id,
  title,
  data,
  hidden,
  onExportPdf,
  onPrintThermal
}: {
  id: ReportMode;
  title: string;
  data?: ReportsSummary;
  hidden: boolean;
  onExportPdf: (id: ReportMode, title: string) => Promise<void>;
  onPrintThermal: (title: string, data?: ReportsSummary) => void;
}) => {
  if (hidden) return null;
  const theme = reportThemes[id === 'all' ? 'custom' : id];
  return (
    <div
      className="stack-gap card-panel report-section"
      data-report-mode={id}
      style={{ borderLeft: `6px solid ${theme.accent}`, background: theme.bg }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: theme.accent }}>{title}</h2>
        <div className="row-actions no-print">
          <Button type="button" variant="secondary" onClick={() => onExportPdf(id, title)}>
            Exportar PDF
          </Button>
          <Button type="button" variant="secondary" onClick={() => onPrintThermal(title, data)}>
            Imprimir
          </Button>
        </div>
      </div>

      <div className="summary-grid">
        <SummaryCard title="Ventas" value={currency(data?.totalSales ?? 0)} accent="#5fae88" />
        <SummaryCard title="Gastos" value={currency(data?.totalExpenses ?? 0)} accent="#c97373" />
        <SummaryCard title="Devoluciones" value={currency(data?.totalPaymentOut ?? 0)} accent="#af5a5a" />
        <SummaryCard title="Utilidad" value={currency(data?.netUtility ?? 0)} accent="#5a7cff" />
        <SummaryCard title="Pagos" value={currency(data?.totalPayments ?? 0)} accent="#d89d4f" />
      </div>
      <div className="summary-grid">
        <SummaryCard title="Órdenes" value={String(data?.totalOrders ?? 0)} accent="#6786a8" />
        <SummaryCard title="Garantías nuevas" value={String(data?.warrantiesCreated ?? 0)} accent="#7a8a94" />
        <SummaryCard title="Garantías cerradas" value={String(data?.warrantiesClosed ?? 0)} accent="#a67c52" />
        <SummaryCard title="Garantías abiertas" value={String(data?.openWarranties ?? 0)} accent="#63b08c" />
      </div>

      <div className="split-grid">
        <BarChart
          title="Ventas por día"
          rows={data?.dailySeries ?? []}
          getLabel={(row) => row.date}
          getValue={(row) => row.sales}
          color="#1d4ed8"
        />
        <BarChart
          title="Gastos por día"
          rows={data?.dailySeries ?? []}
          getLabel={(row) => row.date}
          getValue={(row) => row.expenses}
          color="#b91c1c"
        />
      </div>

      <div className="split-grid">
        <div className="card-panel">
          <h3>Pagos por método</h3>
          <DataTable
            rows={data?.paymentMethods ?? []}
            columns={[
              { key: 'method', header: 'Método', render: (row) => row.methodName },
              { key: 'count', header: 'Cantidad', render: (row) => row.count },
              { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) }
            ]}
          />
        </div>
        <div className="card-panel">
          <h3>Gastos por método</h3>
          <DataTable
            rows={data?.expensesByPaymentMethod ?? []}
            columns={[
              { key: 'method', header: 'Método', render: (row) => row.methodName },
              { key: 'count', header: 'Registros', render: (row) => row.count },
              { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) }
            ]}
          />
        </div>
      </div>

      <div className="split-grid">
        <div className="card-panel">
          <h3>Gastos por categoría</h3>
          <DataTable
            rows={data?.expensesByCategory ?? []}
            columns={[
              { key: 'category', header: 'Categoría', render: (row) => row.categoryName },
              { key: 'count', header: 'Registros', render: (row) => row.count },
              { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) }
            ]}
          />
        </div>
      </div>

      <div className="split-grid">
        <div className="card-panel">
          <h3>Estados de órdenes</h3>
          <DataTable
            rows={data?.orderStatuses ?? []}
            columns={[
              { key: 'status', header: 'Estado', render: (row) => row.statusName },
              { key: 'count', header: 'Cantidad', render: (row) => row.count },
              { key: 'total', header: 'Total', render: (row) => currency(row.total) }
            ]}
          />
        </div>
        <div className="card-panel">
          <h3>Gastos más grandes</h3>
          <DataTable
            rows={data?.biggestExpenses ?? []}
            columns={[
              { key: 'date', header: 'Fecha', render: (row) => row.date },
              { key: 'cat', header: 'Categoría', render: (row) => row.categoryName },
              { key: 'desc', header: 'Descripción', render: (row) => row.description },
              { key: 'amount', header: 'Monto', render: (row) => currency(row.amount) }
            ]}
          />
        </div>
      </div>
    </div>
  );
};

export const ReportsPage = () => {
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(todayKey);
  const [appliedFrom, setAppliedFrom] = useState(todayKey);
  const [appliedTo, setAppliedTo] = useState(todayKey);
  const [exportMode, setExportMode] = useState<ReportMode | null>(null);
  const [customApplied, setCustomApplied] = useState(false);
  const { data: pdfOutputDir } = useQuery({
    queryKey: ['pdf-output-dir'],
    queryFn: api.getPdfOutputDir
  });
  const { data: company } = useQuery({
    queryKey: ['company-settings-report-print'],
    queryFn: api.companySettings
  });

  const dayQuery = useQuery({
    queryKey: ['reports-summary-day', todayKey, todayKey],
    queryFn: () => api.reportsSummary(todayKey, todayKey)
  });
  const monthQuery = useQuery({
    queryKey: ['reports-summary-month', monthStartKey, todayKey],
    queryFn: () => api.reportsSummary(monthStartKey, todayKey)
  });
  const yearQuery = useQuery({
    queryKey: ['reports-summary-year', yearStartKey, todayKey],
    queryFn: () => api.reportsSummary(yearStartKey, todayKey)
  });
  const customQuery = useQuery({
    queryKey: ['reports-summary-custom', appliedFrom, appliedTo],
    queryFn: () => api.reportsSummary(appliedFrom, appliedTo)
  });

  const allSections = useMemo(
    () => [
      { id: 'custom' as const, title: `Reporte personalizado (${appliedFrom} 00:00 a ${appliedTo} 23:59)`, data: customQuery.data },
      { id: 'day' as const, title: `Reporte diario (${todayKey} 00:00 a ${todayKey} 23:59)`, data: dayQuery.data },
      { id: 'month' as const, title: `Reporte mensual (${monthStartKey} 00:00 a ${todayKey} 23:59)`, data: monthQuery.data },
      { id: 'year' as const, title: `Reporte anual (${yearStartKey} 00:00 a ${todayKey} 23:59)`, data: yearQuery.data },
    ],
    [dayQuery.data, monthQuery.data, yearQuery.data, customQuery.data, appliedFrom, appliedTo]
  );

  useEffect(() => {
    const html = document.documentElement;
    if (exportMode) {
      html.classList.add('reports-export-print');
    } else {
      html.classList.remove('reports-export-print');
    }
    return () => html.classList.remove('reports-export-print');
  }, [exportMode]);

  const exportPdf = async (mode: ReportMode, title: string) => {
    setExportMode(mode);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    try {
      const fileBase = sanitizeWindowsFileName(title) || 'reporte';
      const result = await api.printToPdfAuto({
        defaultFileName: `${fileBase}-${todayKey}.pdf`,
        targetDir: pdfOutputDir ?? null,
        subfolder: `Reportes/${todayKey}`,
        pageSize: 'A4',
        landscape: true
      });
      if (result.saved) {
        showToast(`PDF exportado${result.path ? `: ${result.path}` : ''}`, 'success');
      } else {
        showToast('Exportación cancelada.', 'info');
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No fue posible exportar el PDF.',
        'error'
      );
    } finally {
      setExportMode(null);
    }
  };

  const printThermal = (title: string, data?: ReportsSummary) => {
    if (!data) return;
    const win = window.open('', '_blank', 'width=430,height=900');
    if (!win) return;
    const generatedAt = new Date().toLocaleString('es-CO');
    win.document.open();
    win.document.write(
      buildThermalReportHtml(
        title,
        data,
        company?.companyName ?? 'Lavandería',
        generatedAt
      )
    );
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  return (
    <section className="stack-gap">
      <div className="reports-page-header">
        <PageHeader
          title="Reportes"
          subtitle="Vista financiera y operativa (diaria, mes, anual y personalizada) con gráficos."
          actions={
            <div className="row-actions no-print">
              <Button type="button" variant="secondary" onClick={() => exportPdf('all', 'Reporte completo')}>
                Exportar Todo PDF
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => printThermal('Reporte completo', customQuery.data)}
              >
                Imprimir Todo
              </Button>
            </div>
          }
        />
      </div>

      <div className="card-panel stack-gap reports-filter-card">
        <h3 style={{ margin: 0 }}>Rango personalizado</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ minWidth: 180 }}>
            <span>Desde</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ minWidth: 180 }}>
            <span>Hasta</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button onClick={() => {
            setAppliedFrom(from);
            setAppliedTo(to);
            setCustomApplied(true);
          }}>
            Aplicar filtro
          </Button>
        </div>
      </div>

      <div
        className="reports-export-header"
        style={{
          display: exportMode ? 'block' : 'none',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 14
        }}
      >
        <h2 style={{ margin: 0 }}>
          {exportMode === 'all'
            ? 'Reporte consolidado'
            : allSections.find((s) => s.id === exportMode)?.title ?? 'Reporte'}
        </h2>
        <p style={{ margin: '8px 0 0', color: '#4b5563' }}>
          Generado: {new Date().toLocaleString('es-CO')}
        </p>
      </div>

      {allSections.map((section) => (
        <ReportSection
          key={section.id}
          id={section.id}
          title={section.title}
          data={section.data}
          hidden={
            (section.id === 'custom' && !customApplied) ||
            Boolean(exportMode && exportMode !== 'all' && exportMode !== section.id)
          }
          onExportPdf={exportPdf}
          onPrintThermal={printThermal}
        />
      ))}

      {dayQuery.isLoading || monthQuery.isLoading || yearQuery.isLoading || customQuery.isLoading ? (
        <div className="card-panel">Cargando reportes...</div>
      ) : null}

      <style>
        {`
          @media print {
            @page {
              size: A4 landscape;
              margin: 1.5cm;
            }

            html.reports-export-print {
              background: #fff !important;
            }

            html.reports-export-print,
            html.reports-export-print body,
            html.reports-export-print #root {
              width: auto !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
            }

            html.reports-export-print body {
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
              font-size: 12px !important;
              letter-spacing: normal !important;
              font-weight: 400 !important;
            }

            html.reports-export-print .app-shell {
              display: block !important;
              width: auto !important;
              height: auto !important;
              overflow: visible !important;
            }

            html.reports-export-print .sidebar,
            html.reports-export-print .topbar {
              display: none !important;
            }

            html.reports-export-print .page-content {
              padding: 0 !important;
              margin: 0 !important;
              width: auto !important;
              max-width: none !important;
              height: auto !important;
              overflow: visible !important;
            }

            html.reports-export-print .reports-page-header,
            html.reports-export-print .reports-filter-card {
              display: none !important;
            }

            html.reports-export-print .stack-gap {
              gap: 10px !important;
            }

            html.reports-export-print .report-section {
              gap: 10px !important;
              padding: 12px !important;
            }

            html.reports-export-print .card-panel {
              border-radius: 12px !important;
              box-shadow: none !important;
              overflow: visible !important;
              padding: 12px !important;
            }

            html.reports-export-print .report-section {
              break-inside: auto !important;
              page-break-inside: auto !important;
            }

            html.reports-export-print .summary-grid {
              display: grid !important;
              grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
              gap: 10px !important;
            }

            html.reports-export-print .split-grid {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
              gap: 10px !important;
              align-items: start !important;
            }

            html.reports-export-print .report-section > .summary-grid,
            html.reports-export-print .report-section > .split-grid,
            html.reports-export-print .report-section > .card-panel {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }

            html.reports-export-print h2,
            html.reports-export-print h3 {
              word-break: normal !important;
              overflow-wrap: break-word !important;
              white-space: normal !important;
              line-height: 1.15 !important;
              margin-bottom: 6px !important;
            }

            html.reports-export-print span,
            html.reports-export-print strong,
            html.reports-export-print p {
              word-break: normal !important;
              overflow-wrap: break-word !important;
              white-space: normal !important;
            }

            html.reports-export-print [data-report-mode] [style*='grid-template-columns: 160px 1fr 90px'] {
              grid-template-columns: 130px 1fr 78px !important;
              gap: 6px !important;
            }
          }
        `}
      </style>
    </section>
  );
};
