import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@renderer/services/api';
import { Button, PageHeader } from '@renderer/ui/components';
import { currency, dateTime } from '@renderer/utils/format';
import { Barcode } from '@renderer/ui/components/Barcode';
import { showToast } from '@renderer/utils/toast';
import type { SessionUser } from '@shared/types';

const renderValue = (value?: string | null) => {
  const text = String(value ?? '').trim();
  return text ? text : '—';
};

const renderDateOnly = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CO');
};

const localDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeBarcode = (value?: string | number | null) =>
  String(value ?? '')
    .replace(/[–—−]/g, '-')
    .replace(/"/g, '-')
    .replace(/'/g, '-')
    .trim()
    .toUpperCase();

export const InvoiceDetailPage = ({ user }: { user: SessionUser }) => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [runningPdfAction, setRunningPdfAction] = useState(false);
  const [printMode, setPrintMode] = useState<'both' | 'customer' | 'internal'>('both');
  const autoSavedRef = useRef(false);
  const autoPrintedRef = useRef(false);

  const [notesDraft, setNotesDraft] = useState('');
  const [notesEdited, setNotesEdited] = useState(false);

  const shouldAutoPrint = searchParams.get('autoPrint') === '1';
  const shouldAutoSave = searchParams.get('autoSave') !== '0';
  const numericOrderId = Number(orderId);
  const invoiceQueryKey = ['invoice-from-order', numericOrderId] as const;

  const { data: pdfOutputDir } = useQuery({
    queryKey: ['pdf-output-dir'],
    queryFn: async () => {
      try {
        return await api.getPdfOutputDir();
      } catch {
        return null;
      }
    }
  });

  // createFromOrder es idempotente: si la factura ya existe, refresca el
  // snapshot desde order_items para evitar mostrar observaciones antiguas.
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error
  } = useQuery({
    queryKey: invoiceQueryKey,
    queryFn: async () => api.createInvoiceFromOrder(numericOrderId),
    enabled: Number.isFinite(numericOrderId) && numericOrderId > 0,
    retry: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });

  const { data: showBarcode = true } = useQuery({
    queryKey: ['invoice-show-barcode-enabled'],
    queryFn: api.getInvoiceShowBarcodeEnabled,
    staleTime: 5 * 60 * 1000
  });

  const barcodeValue = useMemo(
    () => normalizeBarcode(data?.orderNumber || data?.ticketCode || data?.orderId),
    [data?.orderNumber, data?.ticketCode, data?.orderId]
  );

  // El draft local se inicializa con las notas del servidor SOLO la
  // primera vez que llegan datos o cuando el usuario aún no ha tocado el
  // campo. Si el usuario ya editó, el refetch no debe sobreescribirlo.
  useEffect(() => {
    if (!data) return;
    if (notesEdited) return;
    setNotesDraft(data.notes ?? '');
  }, [data, notesEdited]);

  const notesMutation = useMutation({
    mutationFn: async (value: string) => {
      return api.updateInvoiceNotes(numericOrderId, value.trim().length > 0 ? value : null);
    },
    onSuccess: async (result) => {
      // Reflejamos el valor confirmado en caché sin disparar refetch para
      // evitar que un createFromOrder accidental pise la factura impresa.
      queryClient.setQueryData(invoiceQueryKey, (prev: any) =>
        prev ? { ...prev, notes: result.notes } : prev
      );
      queryClient.invalidateQueries({ queryKey: ['order-detail', numericOrderId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setNotesEdited(false);
      showToast('Notas guardadas correctamente.', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'No fue posible guardar las notas.', 'error');
    }
  });

  const normalizedPhone = String(data?.clientPhone ?? '').replace(/\D/g, '');
  const saveSubfolder = `Facturas generadas/${localDateKey(new Date())}`;
  const pdfFileName = data ? `Factura-${data.orderNumber}.pdf` : 'factura.pdf';

  const generatePdf = async () => {
    if (!data) {
      throw new Error('No hay datos de la factura.');
    }

    return api.printToPdfAuto({
      defaultFileName: pdfFileName,
      targetDir: pdfOutputDir ?? null,
      subfolder: saveSubfolder,
      pageSize: 'A4',
      landscape: false,
      preferCssPageSize: false
    });
  };

  const handleSavePdf = async () => {
    try {
      setRunningPdfAction(true);
      const result = await generatePdf();
      if (result.saved) {
        showToast(`PDF guardado${result.path ? `: ${result.path}` : ''}`, 'success');
      }
    } catch (saveError) {
      showToast(
        saveError instanceof Error ? saveError.message : 'No fue posible generar el PDF.',
        'error'
      );
    } finally {
      setRunningPdfAction(false);
    }
  };

  const handlePrint = async () => {
    try {
      setRunningPdfAction(true);
      const result = await generatePdf();
      if (result.saved) {
        window.setTimeout(() => window.print(), 150);
      }
    } catch (printError) {
      showToast(
        printError instanceof Error ? printError.message : 'No fue posible imprimir la factura.',
        'error'
      );
    } finally {
      setRunningPdfAction(false);
    }
  };

  const handlePrintMode = async (mode: 'both' | 'customer' | 'internal') => {
    setPrintMode(mode);
    // Esperar a que React aplique la className antes de imprimir.
    await new Promise((resolve) => setTimeout(resolve, 80));
    await handlePrint();
  };

  const handleWhatsapp = async () => {
    if (!data) return;
    if (!normalizedPhone) {
      showToast('El cliente no tiene teléfono válido para WhatsApp.', 'error');
      return;
    }

    const withCountryCode = normalizedPhone.startsWith('57') ? normalizedPhone : `57${normalizedPhone}`;
    const url = `https://wa.me/${withCountryCode}?text=${encodeURIComponent(data.whatsappMessage)}`;
    await api.openExternal(url);
  };

  useEffect(() => {
    if (!data || isFetching || !shouldAutoSave || shouldAutoPrint || autoSavedRef.current) return;
    autoSavedRef.current = true;

    void generatePdf().catch((saveError) => {
      console.error('No fue posible autoguardar la factura en PDF:', saveError);
    });
  }, [data, isFetching, shouldAutoSave, shouldAutoPrint, pdfOutputDir]);

  useEffect(() => {
    if (!data || isFetching || !shouldAutoPrint || autoPrintedRef.current) return;
    autoPrintedRef.current = true;

    let cancelled = false;
    const run = async () => {
      try {
        await generatePdf();
        autoSavedRef.current = true;
        if (!cancelled) {
          window.setTimeout(() => window.print(), 180);
        }
      } catch (printError) {
        console.error('No fue posible preparar la impresión automática:', printError);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [data, isFetching, shouldAutoPrint, pdfOutputDir]);

  if (isLoading) {
    return <div className="card-panel">Cargando factura...</div>;
  }

  if (isError || !data) {
    return (
      <div className="card-panel">
        <p className="error-text">
          {(error as Error)?.message || 'No fue posible generar la factura.'}
        </p>
      </div>
    );
  }

  return (
    <section className={`stack-gap invoice-page invoice-mode-${printMode}`}>
      <div className="no-print">
        <PageHeader
          title={`Factura ${data.invoiceNumber}`}
          subtitle={`Orden ${data.orderNumber} · Cliente: ${data.clientName}`}
          actions={
            <div className="row-actions no-print">
              <Button variant="secondary" onClick={() => navigate(`/ordenes/${orderId}`)}>
                Volver
              </Button>
              <Button variant="secondary" onClick={handleWhatsapp}>
                Enviar por WhatsApp
              </Button>
              <Button
                variant="secondary"
                onClick={handleSavePdf}
                disabled={runningPdfAction}
              >
                {runningPdfAction ? 'Generando PDF...' : 'Guardar PDF'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handlePrintMode('customer')}
                disabled={runningPdfAction}
              >
                Solo cliente
              </Button>
              <Button
                variant="secondary"
                onClick={() => handlePrintMode('internal')}
                disabled={runningPdfAction}
              >
                Solo negocio
              </Button>
              <Button onClick={() => handlePrintMode('both')} disabled={runningPdfAction}>
                {runningPdfAction ? 'Preparando impresión...' : 'Imprimir ambas'}
              </Button>
            </div>
          }
        />

        <div
          className="card-panel"
          style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <strong style={{ fontSize: 14 }}>Notas de la factura</strong>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
            Aparecen como "Notas generales" en la impresión térmica. El guardado es manual:
            escribe y pulsa "Guardar notas" cuando termines.
          </p>
          <textarea
            value={notesDraft}
            onChange={(e) => {
              setNotesEdited(true);
              setNotesDraft(e.target.value);
            }}
            placeholder="Escribe aquí las notas que aparecerán en la factura impresa..."
            rows={3}
            maxLength={1000}
            style={{
              width: '100%',
              padding: 8,
              fontSize: 13,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              resize: 'vertical',
              fontFamily: 'inherit'
            }}
          />
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'flex-end'
            }}
          >
            {notesEdited && !notesMutation.isPending ? (
              <span style={{ fontSize: 12, color: '#b45309' }}>
                Cambios sin guardar
              </span>
            ) : null}
            {notesMutation.isPending ? (
              <span style={{ fontSize: 12, color: '#2563eb' }}>Guardando...</span>
            ) : null}
            {notesMutation.isSuccess && !notesEdited ? (
              <span style={{ fontSize: 12, color: '#16a34a' }}>Guardado correctamente</span>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setNotesEdited(false);
                setNotesDraft(data.notes ?? '');
              }}
              disabled={!notesEdited || notesMutation.isPending}
            >
              Descartar cambios
            </Button>
            <Button
              onClick={() => notesMutation.mutate(notesDraft)}
              disabled={!notesEdited || notesMutation.isPending}
            >
              Guardar notas
            </Button>
          </div>
        </div>
      </div>

      <div className="thermal-invoice customer-copy">
        <div className="thermal-header">
          {data.companyLogo ? (
            <img
              src={data.companyLogo}
              alt="Logo del negocio"
              className="thermal-logo"
            />
          ) : null}

          <h2>{renderValue(data.companyName)}</h2>
          {data.companyLegalName ? <p>{data.companyLegalName}</p> : null}
          {data.companyNit ? <p>NIT: {data.companyNit}</p> : null}
          {data.companyPhone ? <p>Tel: {data.companyPhone}</p> : null}
          {data.companyAddress ? <p>{data.companyAddress}</p> : null}
          {data.companyEmail ? <p>{data.companyEmail}</p> : null}
        </div>

        <div className="thermal-copy-badge">
          <div className="thermal-copy-title">RECIBO / FACTURA DE SERVICIO</div>
          <div className="thermal-copy-tag">[COPIA CLIENTE]</div>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <div className="thermal-order-row">
            <h3>{data.isManual ? 'Orden sistema:' : 'Orden:'}</h3>
            <div className="thermal-order-number">{data.orderNumber}</div>
          </div>
          {data.isManual && data.manualOrderNumber ? (
            <p>
              <strong>Orden manual:</strong>{' '}
              <span className="thermal-manual-number">{data.manualOrderNumber}</span>
            </p>
          ) : null}
          {data.isManual && data.manualOrderDate ? (
            <p>
              <strong>Fecha manual:</strong> {renderDateOnly(data.manualOrderDate)}
            </p>
          ) : null}
          <p><strong>Factura:</strong> {data.invoiceNumber}</p>
          <p><strong>Fecha:</strong> {dateTime(data.createdAt)}</p>
          <p><strong>Fecha promesa:</strong> {renderDateOnly(data.dueDate)}</p>
          <p><strong>Estado:</strong> {Number(data.balanceDue) > 0 ? 'Con saldo' : 'Pagada'}</p>
          <p><strong>Generado por:</strong> {renderValue(user.displayName || user.username)}</p>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Cliente</h3>
          {data.clientCode ? <p><strong>Código:</strong> {data.clientCode}</p> : null}
          <p>
            <strong>Cliente:</strong>{' '}
            <strong className="thermal-client-name">{data.clientName}</strong>
          </p>
          <p><strong>Teléfono:</strong> {renderValue(data.clientPhone)}</p>
          {data.clientAddress ? <p><strong>Dirección:</strong> {data.clientAddress}</p> : null}
          {data.notes ? <p><strong>Notas generales:</strong> {data.notes}</p> : null}
        </div>

        <div className="thermal-divider" />

        {showBarcode && (
          <>
            <div className="thermal-barcode">
              <p><strong>Código de barras</strong></p>
              <Barcode value={barcodeValue} height={64} width={2} displayValue={false} />
              <div className="thermal-barcode-text">{barcodeValue}</div>
            </div>

            <div className="thermal-divider" />
          </>
        )}

        <div className="thermal-section">
          <h3>Notas por ítem</h3>
          {data.items.map((item, index) => (
            <div key={item.id} className="thermal-item">
              <div className="thermal-item-row thermal-item-title">
                <span>{index + 1}. {item.description}</span>
                <strong>{currency(item.total)}</strong>
              </div>
              <div className="thermal-item-row">
                <span>Cant: {item.quantity}</span>
                <span>Unit: {currency(item.unitPrice)}</span>
              </div>
              {(Number(item.discountAmount ?? 0) > 0 || Number(item.surchargeAmount ?? 0) > 0) ? (
                <div className="thermal-item-row">
                  <span>Desc: {currency(item.discountAmount)}</span>
                  <span>Rec: {currency(item.surchargeAmount)}</span>
                </div>
              ) : null}
              {String(item.customerObservations ?? '').trim() ? (
                <p className="thermal-item-note">
                  <strong>Obs:</strong> {item.customerObservations}
                </p>
              ) : (
                <p className="thermal-item-note thermal-muted">
                  Sin notas para este ítem.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="thermal-divider" />

        <div className="thermal-totals">
          <div><span>Subtotal</span><strong>{currency(data.subtotal)}</strong></div>
          <div><span>Total</span><strong>{currency(data.total)}</strong></div>
          <div><span>Abonado</span><strong>{currency(data.paidTotal)}</strong></div>
          <div><span>Saldo</span><strong>{currency(data.balanceDue)}</strong></div>
        </div>

        {data.payments && data.payments.length > 0 ? (
          <>
            <div className="thermal-divider" />
            <div className="thermal-section">
              <h3>Pagos recibidos</h3>
              {data.payments.map((p) => (
                <div key={p.id} className="thermal-item">
                  <div className="thermal-item-row thermal-item-title">
                    <span>{renderDateOnly(p.createdAt)} · {p.methodName}</span>
                    <strong>{currency(p.amount)}</strong>
                  </div>
                  {p.reference ? (
                    <div className="thermal-item-row">
                      <span>Ref: {p.reference}</span>
                    </div>
                  ) : null}
                </div>
              ))}
              <p>
                <strong>Estado de pago:</strong>{' '}
                {Number(data.balanceDue) <= 0
                  ? 'PAGADA'
                  : Number(data.paidTotal) > 0
                    ? 'PARCIAL'
                    : 'PENDIENTE'}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="thermal-divider" />
            <div className="thermal-section">
              <p>
                <strong>Estado de pago:</strong>{' '}
                {Number(data.balanceDue) <= 0 ? 'PAGADA' : 'PENDIENTE'}
              </p>
            </div>
          </>
        )}

        {data.activeOrders.length > 0 ? (
          <>
            <div className="thermal-divider" />

            <div className="thermal-section">
              <h3>Órdenes pendientes por reclamar</h3>
              {data.showAllActiveOrders ? (
                data.activeOrders.map((order, index) => (
                  <div key={order.id} className="thermal-item thermal-active-order">
                    <div className="thermal-item-row thermal-item-title">
                      <span>{index + 1}. Orden {order.orderNumber}</span>
                      <strong>{order.itemsCount} prenda{order.itemsCount !== 1 ? 's' : ''}</strong>
                    </div>
                    <div className="thermal-item-row">
                      <span>Fecha promesa</span>
                      <span>{renderDateOnly(order.dueDate)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p>
                  Tienes <strong>{data.activeOrders.length}</strong> orden{data.activeOrders.length !== 1 ? 'es' : ''} pendiente{data.activeOrders.length !== 1 ? 's' : ''} con un total de <strong>{data.activeOrders.reduce((sum, o) => sum + o.itemsCount, 0)}</strong> prenda{data.activeOrders.reduce((sum, o) => sum + o.itemsCount, 0) !== 1 ? 's' : ''} por recoger.
                </p>
              )}
            </div>
          </>
        ) : null}

        <div className="thermal-divider" />

        <div className="thermal-section thermal-centered thermal-thanks">
          <p><strong>Gracias por confiar en {renderValue(data.companyName)}.</strong></p>
          <p>Conserve este comprobante para reclamar su pedido.</p>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Políticas</h3>
          <p>{data.companyPolicies || 'No hay políticas configuradas.'}</p>
          <p className="thermal-muted thermal-centered">Generada con LavaSuite, software desarrollado por SisteTecni.</p>
        </div>
      </div>

      <div className="thermal-invoice internal-copy">
        <div className="thermal-header">
          {data.companyLogo ? (
            <img
              src={data.companyLogo}
              alt="Logo del negocio"
              className="thermal-logo"
            />
          ) : null}

          <h2>{renderValue(data.companyName)}</h2>
          {data.companyNit ? <p>NIT: {data.companyNit}</p> : null}
        </div>

        <div className="thermal-copy-badge thermal-internal-badge">
          <div className="thermal-copy-title">COPIA INTERNA DEL NEGOCIO</div>
          <div className="thermal-copy-tag">[NO ENTREGAR AL CLIENTE]</div>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <div className="thermal-order-row">
            <h3>{data.isManual ? 'Orden sistema:' : 'Orden:'}</h3>
            <div className="thermal-order-number">{data.orderNumber}</div>
          </div>
          {data.isManual && data.manualOrderNumber ? (
            <p>
              <strong>Orden manual:</strong>{' '}
              <span className="thermal-manual-number">{data.manualOrderNumber}</span>
            </p>
          ) : null}
          {data.isManual && data.manualOrderDate ? (
            <p>
              <strong>Fecha manual:</strong> {renderDateOnly(data.manualOrderDate)}
            </p>
          ) : null}
          <p><strong>Factura:</strong> {data.invoiceNumber}</p>
          <p><strong>Fecha registro:</strong> {dateTime(data.createdAt)}</p>
          <p><strong>Fecha promesa:</strong> {renderDateOnly(data.dueDate)}</p>
          <p><strong>Registró:</strong> {renderValue(data.generatedBy || user.displayName || user.username)}</p>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Cliente</h3>
          {data.clientCode ? <p><strong>Código:</strong> {data.clientCode}</p> : null}
          <p>
            <strong>Cliente:</strong>{' '}
            <strong className="thermal-client-name">{data.clientName}</strong>
          </p>
          <p><strong>Teléfono:</strong> {renderValue(data.clientPhone)}</p>
          {data.clientAddress ? <p><strong>Dirección:</strong> {data.clientAddress}</p> : null}
        </div>

        <div className="thermal-divider" />

        {showBarcode && (
          <>
            <div className="thermal-barcode">
              <p><strong>Código de barras</strong></p>
              <Barcode value={barcodeValue} height={64} width={2} displayValue={false} />
              <div className="thermal-barcode-text">{barcodeValue}</div>
            </div>

            <div className="thermal-divider" />
          </>
        )}

        <div className="thermal-section">
          <h3>Detalle interno</h3>
          {data.items.map((item, index) => (
            <div key={item.id} className="thermal-item">
              <div className="thermal-item-row thermal-item-title">
                <span>{index + 1}. {item.description}</span>
                <strong>{currency(item.total)}</strong>
              </div>
              <div className="thermal-item-row">
                <span>Cant: {item.quantity}</span>
                <span>Unit: {currency(item.unitPrice)}</span>
              </div>
              {(Number(item.discountAmount ?? 0) > 0 || Number(item.surchargeAmount ?? 0) > 0) ? (
                <div className="thermal-item-row">
                  <span>Desc: {currency(item.discountAmount)}</span>
                  <span>Rec: {currency(item.surchargeAmount)}</span>
                </div>
              ) : null}
              {String(item.customerObservations ?? '').trim() ? (
                <p className="thermal-item-note">
                  <strong>Obs cliente:</strong> {item.customerObservations}
                </p>
              ) : null}
              {String(item.internalObservations ?? '').trim() ? (
                <p className="thermal-item-note thermal-internal-note">
                  <strong>Obs interna:</strong> {item.internalObservations}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Estado</h3>
          <p><strong>Estado orden:</strong> {renderValue(data.statusName ?? data.statusCode)}</p>
          <p>
            <strong>Estado pago:</strong>{' '}
            {Number(data.balanceDue) <= 0
              ? 'PAGADA'
              : Number(data.paidTotal) > 0
                ? 'PARCIAL'
                : 'PENDIENTE'}
          </p>
        </div>

        <div className="thermal-divider" />

        <div className="thermal-totals">
          <div><span>Subtotal</span><strong>{currency(data.subtotal)}</strong></div>
          <div><span>Total</span><strong>{currency(data.total)}</strong></div>
          <div><span>Abonado</span><strong>{currency(data.paidTotal)}</strong></div>
          <div><span>Saldo</span><strong>{currency(data.balanceDue)}</strong></div>
        </div>

        {data.payments && data.payments.length > 0 ? (
          <>
            <div className="thermal-divider" />
            <div className="thermal-section">
              <h3>Pagos detallados</h3>
              {data.payments.map((p) => (
                <div key={p.id} className="thermal-item">
                  <div className="thermal-item-row thermal-item-title">
                    <span>{dateTime(p.createdAt)}</span>
                    <strong>{currency(p.amount)}</strong>
                  </div>
                  <div className="thermal-item-row">
                    <span>Método: {p.methodName}</span>
                  </div>
                  {p.receivedBy ? (
                    <div className="thermal-item-row">
                      <span>Recibió: {p.receivedBy}</span>
                    </div>
                  ) : null}
                  {p.reference ? (
                    <div className="thermal-item-row">
                      <span>Ref: {p.reference}</span>
                    </div>
                  ) : null}
                  {p.notes ? (
                    <p className="thermal-item-note">
                      <strong>Notas:</strong> {p.notes}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {data.notes ? (
          <>
            <div className="thermal-divider" />
            <div className="thermal-section">
              <h3>Observaciones de la orden</h3>
              <p>{data.notes}</p>
            </div>
          </>
        ) : null}

        <div className="thermal-divider" />

        <div className="thermal-section">
          <h3>Entrega / control interno</h3>
          <div className="thermal-signature-block">
            <p><span>Recibido por:</span><span className="thermal-signature-line" /></p>
            <p><span>Documento:</span><span className="thermal-signature-line" /></p>
            <p><span>Firma cliente:</span><span className="thermal-signature-line" /></p>
            <p><span>Fecha entrega:</span><span className="thermal-signature-line" /></p>
          </div>
        </div>
      </div>

      <style>
        {`
          .thermal-invoice {
            width: 100%;
            max-width: 72mm;
            margin: 0 auto;
            padding: 3mm 2.5mm 4mm;
            box-sizing: border-box;
            background: #fff;
            color: #000;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 10px;
            line-height: 1.22;
          }

          .thermal-header,
          .thermal-barcode {
            text-align: center;
          }

          .thermal-header h2,
          .thermal-section h3 {
            margin: 0 0 2px;
          }

          .thermal-header p,
          .thermal-section p {
            margin: 1px 0;
            word-break: break-word;
          }

          .thermal-logo {
            width: 28mm;
            max-width: 100%;
            max-height: 22mm;
            object-fit: contain;
            margin: 0 auto 4px;
            display: block;
          }

          .thermal-divider {
            border-top: 1px dashed rgba(0, 0, 0, 0.85);
            margin: 4px 0;
          }

          .thermal-order-number-block {
            text-align: center;
            margin: 1px 0 3px;
          }

          .thermal-order-number-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            opacity: 0.8;
          }

          .thermal-order-number {
            font-size: 22px;
            line-height: 1.05;
            font-weight: 800;
            letter-spacing: 0.8px;
          }

          .thermal-order-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .thermal-order-row h3 {
            margin: 0;
            font-size: 14px;
          }

          .thermal-item {
            padding: 0 0 4px;
            margin-bottom: 4px;
            border-bottom: 1px dashed rgba(0, 0, 0, 0.2);
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .thermal-active-order:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: 0;
          }

          .thermal-item-row,
          .thermal-totals > div {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
          }

          .thermal-item-title {
            font-weight: 700;
          }

          .thermal-item-title span,
          .thermal-item-row span:first-child,
          .thermal-totals > div span {
            flex: 1;
            min-width: 0;
            word-break: break-word;
          }

          .thermal-item-note {
            margin-top: 2px;
            font-weight: 600;
          }

          .thermal-client-name {
            font-weight: 900;
            font-size: 12px;
            letter-spacing: 0.3px;
            text-transform: none;
          }

          @media print {
            .thermal-client-name {
              font-weight: 900 !important;
              font-size: 13px !important;
            }
          }

          .thermal-totals {
            display: grid;
            gap: 2px;
          }

          .thermal-barcode {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            width: 100%;
            overflow: hidden;
          }

          .thermal-barcode svg {
            display: block;
            width: 100%;
            height: auto;
          }

          .thermal-barcode-text {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1.4px;
            font-family: Consolas, 'Courier New', monospace;
            text-align: center;
            word-break: break-word;
          }

          .thermal-muted {
            color: #444;
          }

          .thermal-centered {
            text-align: center;
            font-weight: 600;
          }

          .thermal-copy-badge {
            text-align: center;
            margin: 6px 0 2px;
            padding: 4px 0;
            border: 1px solid #000;
            border-radius: 2px;
          }

          .thermal-copy-title {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }

          .thermal-copy-tag {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1px;
            margin-top: 2px;
          }

          .thermal-internal-badge {
            background: #000;
            color: #fff;
          }

          .thermal-internal-badge .thermal-copy-title,
          .thermal-internal-badge .thermal-copy-tag {
            color: #fff;
          }

          .thermal-internal-note {
            background: rgba(0, 0, 0, 0.06);
            padding: 3px 4px;
            border-left: 2px solid #000;
          }

          .thermal-manual-number {
            display: inline-block;
            padding: 1px 6px;
            border: 1px solid #000;
            border-radius: 2px;
            font-weight: 800;
            letter-spacing: 0.5px;
          }

          .thermal-thanks p {
            margin: 2px 0;
          }

          .thermal-signature-block p {
            display: flex;
            align-items: flex-end;
            gap: 6px;
            margin: 5px 0 0;
          }

          .thermal-signature-block p span:first-child {
            white-space: nowrap;
            font-weight: 600;
          }

          .thermal-signature-line {
            flex: 1;
            border-bottom: 1px solid #000;
            min-height: 14px;
          }

          .invoice-mode-customer .internal-copy {
            display: none !important;
          }

          .invoice-mode-internal .customer-copy {
            display: none !important;
          }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }

            html,
            body {
              width: 80mm !important;
              min-width: 0 !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              overflow: visible !important;
            }

            #root,
            .app-shell,
            .page-content {
              width: 80mm !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              padding: 0 !important;
              margin: 0 !important;
              display: block !important;
            }

            .no-print {
              display: none !important;
            }

            .invoice-page {
              display: block !important;
              width: 80mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
            }

            .thermal-invoice {
              width: 80mm !important;
              max-width: 80mm !important;
              box-sizing: border-box !important;
              margin: 0 !important;
              padding: 3mm 4mm 10mm !important;
              overflow: visible !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }

            .invoice-mode-both .internal-copy {
              page-break-before: always !important;
              break-before: page !important;
            }

            .thermal-logo {
              filter: none !important;
            }

            .thermal-item,
            .thermal-section,
            .thermal-totals,
            .thermal-barcode {
              overflow: visible !important;
            }
          }
        `}
      </style>
    </section>
  );
};
