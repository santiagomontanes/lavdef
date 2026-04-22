import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import type { CatalogsPayload, Client, OrderDetail, OrderInput, PaymentLineInput } from '@shared/types';
import { Button, FormSection, Input, PriceInput, Select, Textarea } from '@renderer/ui/components';
import { currency } from '@renderer/utils/format';

const NOTES_MAX = 400;
const OBS_MAX = 400;

const defaultValues: OrderInput = {
  clientId: 0,
  notes: null,
  dueDate: null,
  discountTotal: 0,
  discountReason: null,
  initialPaymentLines: [],
  items: [
    {
      garmentTypeId: null,
      serviceId: null,
      description: '',
      quantity: 1,
      color: null,
      brand: null,
      sizeReference: null,
      material: null,
      receivedCondition: null,
      workDetail: null,
      stains: null,
      damages: null,
      missingAccessories: null,
      customerObservations: null,
      internalObservations: null,
      unitPrice: 0,
      discountAmount: 0,
      discountReason: null,
      surchargeAmount: 0,
      surchargeReason: null,
      subtotal: 0,
      total: 0
    }
  ]
};

const emptyPaymentLine = (methodId: number): PaymentLineInput => ({
  paymentMethodId: methodId,
  amount: 0,
  reference: null
});

/** Computes per-item subtotal and total from base fields (never stale). */
const computeItemTotals = (item: OrderInput['items'][number]) => {
  const qty = Math.max(1, Math.trunc(Number(item.quantity || 1)));
  const price = Number(item.unitPrice || 0);
  const disc = Math.max(0, Math.trunc(Number(item.discountAmount || 0)));
  const surch = Math.max(0, Math.trunc(Number(item.surchargeAmount || 0)));
  const itemSubtotal = qty * price;
  const itemTotal = Math.max(0, itemSubtotal - disc + surch);
  return { itemSubtotal, itemTotal };
};

export const OrderForm = ({
  clients,
  catalogs,
  onSearchClients,
  onSubmit,
  initialValue,
  initialDraft,
  onDraftChange,
  onDraftRestored,
  hideInitialPaymentFields = false,
  submitLabel = 'Guardar orden'
}: {
  clients: Client[];
  catalogs: CatalogsPayload | undefined;
  onSearchClients?: (term: string, limit?: number) => Promise<Client[]>;
  onSubmit: (value: OrderInput) => void;
  initialValue?: OrderDetail | null;
  initialDraft?: OrderInput | null;
  onDraftChange?: (value: OrderInput) => void;
  onDraftRestored?: () => void;
  hideInitialPaymentFields?: boolean;
  submitLabel?: string;
}) => {
  const {
    register,
    control,
    watch,
    setValue,
    handleSubmit,
    reset,
    getValues,
    formState: { errors }
  } = useForm<OrderInput>({ defaultValues });

  const { fields: itemFields, append: appendItem, remove: removeItem, replace } = useFieldArray({
    control,
    name: 'items'
  });

  const defaultMethodId = catalogs?.paymentMethods?.[0]?.id ?? 1;

  const {
    fields: paymentFields,
    append: appendPayment,
    remove: removePayment
  } = useFieldArray({ control, name: 'initialPaymentLines' });

  const [serviceSearch, setServiceSearch] = useState<Record<number, string>>({});
  const [clientSearch, setClientSearch] = useState('');
  const [searchedClients, setSearchedClients] = useState<Client[]>([]);
  const [searchingClients, setSearchingClients] = useState(false);
  const skipNextDraftSyncRef = useRef(Boolean(initialDraft && !initialValue));
  const hasInitializedRef = useRef(false);

  const buildServiceSearchState = (items: OrderInput['items']) =>
    items.reduce<Record<number, string>>((acc, item, index) => {
      acc[index] = item.serviceId
        ? catalogs?.services?.find((service) => service.id === item.serviceId)?.name ?? ''
        : '';
      return acc;
    }, {});

  useEffect(() => {
    if (initialValue) {
      const mapped: OrderInput = {
        clientId: initialValue.clientId,
        notes: initialValue.notes || null,
        dueDate: initialValue.dueDate ? initialValue.dueDate.slice(0, 10) : null,
        discountTotal: Number(initialValue.discountTotal || 0),
        discountReason: initialValue.discountReason || null,
        initialPaymentLines: [],
        items: initialValue.items.map((item) => ({
          garmentTypeId: item.garmentTypeId,
          serviceId: item.serviceId,
          description: item.description,
          quantity: Number(item.quantity),
          color: null,
          brand: null,
          sizeReference: null,
          material: null,
          receivedCondition: null,
          workDetail: null,
          stains: null,
          damages: null,
          missingAccessories: null,
          customerObservations: item.customerObservations,
          internalObservations: null,
          unitPrice: Number(item.unitPrice),
          discountAmount: Number(item.discountAmount),
          discountReason: item.discountReason ?? null,
          surchargeAmount: Number(item.surchargeAmount),
          surchargeReason: item.surchargeReason ?? null,
          subtotal: Number(item.subtotal),
          total: Number(item.total)
        }))
      };

      reset(mapped);
      replace(mapped.items);
      setServiceSearch(buildServiceSearchState(mapped.items));
      hasInitializedRef.current = true;
      return;
    }

    if (initialDraft && !hasInitializedRef.current) {
      const hydratedDraft: OrderInput = {
        ...defaultValues,
        ...initialDraft,
        items: initialDraft.items?.length ? initialDraft.items : defaultValues.items
      };

      reset(hydratedDraft);
      replace(hydratedDraft.items);
      setServiceSearch(buildServiceSearchState(hydratedDraft.items));
      onDraftRestored?.();
      hasInitializedRef.current = true;
      return;
    }

    if (!hasInitializedRef.current) {
      reset(defaultValues);
      setServiceSearch({});
      hasInitializedRef.current = true;
    }
  }, [initialValue, initialDraft, reset, replace, catalogs, onDraftRestored]);

  useEffect(() => {
    if (!onDraftChange || initialValue) {
      return;
    }

    const timeoutRef = { current: 0 as number | undefined };
    const subscription = watch(() => {
      if (skipNextDraftSyncRef.current) {
        skipNextDraftSyncRef.current = false;
        return;
      }

      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        const current = getValues();
        onDraftChange({
          ...current,
          notes: current.notes || null,
          dueDate: current.dueDate || null,
          discountTotal: Number(current.discountTotal || 0),
          initialPaymentLines: (current.initialPaymentLines ?? []).map((l) => ({
            paymentMethodId: Number(l.paymentMethodId),
            amount: Number(l.amount || 0),
            reference: l.reference || null
          })),
          items: (current.items?.length ? current.items : defaultValues.items).map((item) => {
            const { itemSubtotal, itemTotal } = computeItemTotals(item);
            return {
              ...item,
              color: item.color || null,
              brand: item.brand || null,
              sizeReference: item.sizeReference || null,
              material: item.material || null,
              receivedCondition: item.receivedCondition || null,
              workDetail: item.workDetail || null,
              stains: item.stains || null,
              damages: item.damages || null,
              missingAccessories: item.missingAccessories || null,
              customerObservations: item.customerObservations || null,
              internalObservations: item.internalObservations || null,
              quantity: Math.max(1, Math.trunc(Number(item.quantity || 1))),
              unitPrice: Number(item.unitPrice || 0),
              discountAmount: Math.max(0, Math.trunc(Number(item.discountAmount || 0))),
              discountReason: item.discountReason || null,
              surchargeAmount: Math.max(0, Math.trunc(Number(item.surchargeAmount || 0))),
              surchargeReason: item.surchargeReason || null,
              subtotal: itemSubtotal,
              total: itemTotal
            };
          })
        });
      }, 250);
    });

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeoutRef.current);
    };
  }, [getValues, initialValue, onDraftChange, watch]);

  useEffect(() => {
    if (!onSearchClients) {
      setSearchedClients([]);
      return;
    }

    const term = clientSearch.trim();
    if (term.length < 2) {
      setSearchedClients([]);
      setSearchingClients(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchingClients(true);
        const rows = await onSearchClients(term, 40);
        if (!cancelled) setSearchedClients(rows);
      } catch {
        if (!cancelled) setSearchedClients([]);
      } finally {
        if (!cancelled) setSearchingClients(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [clientSearch, onSearchClients]);

  const watchedItems = useWatch({ control, name: 'items' }) ?? [];
  const watchedInitialPaymentLines = useWatch({ control, name: 'initialPaymentLines' }) ?? [];
  const initialPaymentLines = watchedInitialPaymentLines;
  const paidAmount = useMemo(
    () => initialPaymentLines.reduce((s, l) => s + Number(l.amount || 0), 0),
    [initialPaymentLines]
  );

  // Always-accurate totals computed directly from base fields — no stale state
  const computedItems = useMemo(() => watchedItems.map(computeItemTotals), [watchedItems]);

  const subtotal = useMemo(
    () => computedItems.reduce((s, c) => s + c.itemSubtotal, 0),
    [computedItems]
  );

  const displayDiscount = useMemo(
    () => watchedItems.reduce((s, item) => s + Math.max(0, Math.trunc(Number(item.discountAmount || 0))), 0),
    [watchedItems]
  );

  const total = Math.max(0, computedItems.reduce((s, c) => s + c.itemTotal, 0));

  const balance = Math.max(0, total - paidAmount);

  const getFilteredServices = (index: number) => {
    const term = String(serviceSearch[index] ?? '').trim().toLowerCase();

    if (!term) {
      return catalogs?.services ?? [];
    }

    return (catalogs?.services ?? []).filter((service) =>
      String(service.name ?? '').toLowerCase().includes(term)
    );
  };

  const clientOptions = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return clients;
    if (searchedClients.length > 0) return searchedClients;
    return clients.filter((client) =>
      `${client.firstName} ${client.lastName}`.toLowerCase().includes(term)
    );
  }, [clientSearch, searchedClients, clients]);

  return (
    <form
      className="stack-gap"
      onSubmit={handleSubmit((values) => {
        const computedDiscountTotal = values.items.reduce(
          (s, item) => s + Math.max(0, Math.trunc(Number(item.discountAmount || 0))),
          0
        );
        onSubmit({
          ...values,
          dueDate: values.dueDate || null,
          notes: values.notes || null,
          discountTotal: computedDiscountTotal,
          discountReason: null,
          initialPaymentLines: hideInitialPaymentFields
            ? []
            : (values.initialPaymentLines ?? [])
                .filter((l) => Number(l.amount || 0) > 0)
                .map((l) => ({
                  paymentMethodId: Number(l.paymentMethodId),
                  amount: Number(l.amount),
                  reference: l.reference || null
                })),
          items: values.items.map((item) => {
            const { itemSubtotal, itemTotal } = computeItemTotals(item);
            return {
              ...item,
              color: null,
              brand: null,
              sizeReference: null,
              material: null,
              receivedCondition: null,
              workDetail: null,
              stains: null,
              damages: null,
              missingAccessories: null,
              internalObservations: null,
              quantity: Math.max(1, Math.trunc(Number(item.quantity))),
              unitPrice: Number(item.unitPrice),
              discountAmount: Math.max(0, Math.trunc(Number(item.discountAmount))),
              discountReason: item.discountReason || null,
              surchargeAmount: Math.max(0, Math.trunc(Number(item.surchargeAmount))),
              surchargeReason: item.surchargeReason || null,
              subtotal: itemSubtotal,
              total: itemTotal,
              customerObservations: item.customerObservations || null
            };
          })
        });
      })}
    >
      <FormSection title="Encabezado de la orden">
        <div className="form-grid">
          <label>
            <span>Buscar cliente</span>
            <Input
              placeholder="Nombre, apellido o número WhatsApp"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
            {searchingClients ? (
              <small style={{ color: '#6b7280' }}>Buscando clientes...</small>
            ) : null}
          </label>

          <label>
            <span>Cliente</span>
            <Select
              {...register('clientId', {
                valueAsNumber: true,
                required: 'Selecciona un cliente'
              })}
            >
              <option value={0}>Selecciona un cliente</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.firstName} {client.lastName}{client.phone ? ` — ${client.phone}` : ''}
                </option>
              ))}
            </Select>
            {errors.clientId && (
              <small className="error-text">{errors.clientId.message}</small>
            )}
          </label>

          <label>
            <span>Fecha promesa</span>
            <Input type="date" {...register('dueDate')} />
          </label>

          <label className="full-span">
            <span>Notas generales <small style={{ fontWeight: 400, color: '#6b7280' }}>({NOTES_MAX} car. máx.)</small></span>
            <Textarea
              {...register('notes', { maxLength: { value: NOTES_MAX, message: `Máximo ${NOTES_MAX} caracteres` } })}
              maxLength={NOTES_MAX}
            />
            {errors.notes && <small className="error-text">{errors.notes.message}</small>}
          </label>
        </div>
      </FormSection>

      <FormSection title="Prendas / ítems">
        <div className="stack-gap">
          {itemFields.map((field, index) => {
            const { itemSubtotal, itemTotal } = computedItems[index] ?? { itemSubtotal: 0, itemTotal: 0 };

            return (
              <div key={field.id} className="item-card">
                <div className="item-grid">
                  <label>
                    <span>Buscar servicio</span>
                    <Input
                      placeholder="Escribe para filtrar servicios"
                      value={serviceSearch[index] ?? ''}
                      onChange={(e) =>
                        setServiceSearch((prev) => ({
                          ...prev,
                          [index]: e.target.value
                        }))
                      }
                    />
                  </label>

                  <label>
                    <span>Servicio</span>
                    <Select
                      {...register(`items.${index}.serviceId` as const, {
                        setValueAs: (value) => (value === '' ? null : Number(value))
                      })}
                      onChange={(e) => {
                        const serviceId =
                          e.target.value === '' ? null : Number(e.target.value);
                        setValue(`items.${index}.serviceId`, serviceId);

                        const selectedService = catalogs?.services?.find(
                          (service) => service.id === serviceId
                        );

                        if (selectedService) {
                          setValue(
                            `items.${index}.unitPrice`,
                            Number(selectedService.basePrice ?? 0)
                          );

                          const currentDescription = getValues(`items.${index}.description`);
                          if (!currentDescription || !currentDescription.trim()) {
                            setValue(`items.${index}.description`, selectedService.name);
                          }

                          setServiceSearch((prev) => ({
                            ...prev,
                            [index]: selectedService.name
                          }));
                        }
                      }}
                    >
                      <option value="">Selecciona un servicio</option>
                      {getFilteredServices(index).map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} - {currency(Number(service.basePrice ?? 0))}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label className="full-span">
                    <span>Descripción</span>
                    <Input
                      {...register(`items.${index}.description` as const, {
                        required: 'Describe la prenda o servicio'
                      })}
                    />
                    {errors.items?.[index]?.description && (
                      <small className="error-text">{errors.items[index]?.description?.message}</small>
                    )}
                  </label>

                  <label>
                    <span>Cantidad</span>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      {...register(`items.${index}.quantity` as const, {
                        valueAsNumber: true
                      })}
                    />
                  </label>

                  <label>
                    <span>Precio unitario</span>
                    <PriceInput
                      value={watchedItems[index]?.unitPrice ?? 0}
                      disabled={Boolean(watchedItems[index]?.serviceId)}
                      onChange={(v) => setValue(`items.${index}.unitPrice`, v)}
                    />
                  </label>

                  <label>
                    <span>Descuento ($)</span>
                    <PriceInput
                      value={watchedItems[index]?.discountAmount ?? 0}
                      onChange={(v) => setValue(`items.${index}.discountAmount`, v)}
                    />
                  </label>

                  <label>
                    <span>Razón del descuento</span>
                    <Input
                      placeholder="Ej: cortesía, cliente VIP..."
                      {...register(`items.${index}.discountReason` as const)}
                    />
                  </label>

                  <label>
                    <span>Recargo ($)</span>
                    <PriceInput
                      value={watchedItems[index]?.surchargeAmount ?? 0}
                      onChange={(v) => setValue(`items.${index}.surchargeAmount`, v)}
                    />
                  </label>

                  <label>
                    <span>Razón del recargo</span>
                    <Input
                      placeholder="Ej: urgencia, manejo especial..."
                      {...register(`items.${index}.surchargeReason` as const)}
                    />
                  </label>

                  <label className="full-span">
                    <span>Observaciones <small style={{ fontWeight: 400, color: '#6b7280' }}>({OBS_MAX} car. máx.)</small></span>
                    <Textarea
                      {...register(`items.${index}.customerObservations` as const, {
                        maxLength: { value: OBS_MAX, message: `Máximo ${OBS_MAX} caracteres` }
                      })}
                      maxLength={OBS_MAX}
                      placeholder="Ej: prenda delicada, mancha visible, entregar con cuidado..."
                    />
                    {errors.items?.[index]?.customerObservations && (
                      <small className="error-text">{errors.items[index]?.customerObservations?.message}</small>
                    )}
                  </label>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>Subtotal ítem</span>
                    <strong style={{ fontSize: 15 }}>{currency(itemSubtotal)}</strong>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>Total ítem</span>
                    <strong style={{ fontSize: 15, color: '#2563eb' }}>{currency(itemTotal)}</strong>
                  </div>
                </div>

                {itemFields.length > 1 && (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => removeItem(index)}
                  >
                    Quitar ítem
                  </Button>
                )}
              </div>
            );
          })}

          <Button
            type="button"
            variant="primary"
            style={{
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: '#ffffff',
              fontWeight: 600,
              borderRadius: 12,
              padding: '12px 18px',
              boxShadow: '0 6px 18px rgba(37, 99, 235, 0.35)',
              transition: 'all 0.2s ease',
              border: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 10px 24px rgba(37, 99, 235, 0.45)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 6px 18px rgba(37, 99, 235, 0.35)';
            }}
            onClick={() =>
              appendItem({
                garmentTypeId: null,
                serviceId: null,
                description: '',
                quantity: 1,
                color: null,
                brand: null,
                sizeReference: null,
                material: null,
                receivedCondition: null,
                workDetail: null,
                stains: null,
                damages: null,
                missingAccessories: null,
                customerObservations: null,
                internalObservations: null,
                unitPrice: 0,
                discountAmount: 0,
                discountReason: null,
                surchargeAmount: 0,
                surchargeReason: null,
                subtotal: 0,
                total: 0
              })
            }
          >
            + Agregar ítem
          </Button>
        </div>
      </FormSection>

      <div className="totals-panel">
        <div className="total-box">
          <span>Subtotal</span>
          <strong>{currency(subtotal)}</strong>
        </div>
        <div className="total-box">
          <span>Descuento</span>
          <strong>{currency(displayDiscount)}</strong>
        </div>
        <div className="total-box">
          <span>Total</span>
          <strong>{currency(total)}</strong>
        </div>
        <div className="total-box">
          <span>Saldo</span>
          <strong>{currency(balance)}</strong>
        </div>
      </div>

      <FormSection title="Descuentos y abono">
        {displayDiscount > 0 && (
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
            Descuento global (calculado de ítems):{' '}
            <strong>{currency(displayDiscount)}</strong>
          </div>
        )}

        {!hideInitialPaymentFields && (
          <div className="stack-gap" style={{ marginTop: 12 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
              Abono inicial{' '}
              <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 13 }}>
                (opcional — puedes agregar varios métodos de pago)
              </span>
            </p>

            {paymentFields.map((field, index) => (
              <div key={field.id} className="card-panel" style={{ padding: '12px 16px' }}>
                <div className="form-grid">
                  <label>
                    <span>Método de pago</span>
                    <Select
                      {...register(`initialPaymentLines.${index}.paymentMethodId`, { valueAsNumber: true })}
                    >
                      {catalogs?.paymentMethods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.name}
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label>
                    <span>Valor</span>
                    <PriceInput
                      value={watchedInitialPaymentLines[index]?.amount ?? 0}
                      onChange={(v) => setValue(`initialPaymentLines.${index}.amount`, v)}
                    />
                  </label>

                  <label>
                    <span>Referencia</span>
                    <Input
                      {...register(`initialPaymentLines.${index}.reference`)}
                      placeholder="Opcional"
                    />
                  </label>

                  {paymentFields.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Button type="button" variant="danger" onClick={() => removePayment(index)}>
                        Quitar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => appendPayment(emptyPaymentLine(defaultMethodId))}
              >
                + Agregar método de pago
              </Button>

              {paymentFields.length > 0 && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    for (let i = paymentFields.length - 1; i >= 0; i--) removePayment(i);
                  }}
                >
                  Quitar abono
                </Button>
              )}
            </div>

            <div style={{ fontSize: 13, color: '#374151' }}>
              Total abono: <strong>{currency(paidAmount)}</strong>
              {' · '}Saldo tras abono: <strong>{currency(Math.max(0, total - paidAmount))}</strong>
            </div>
          </div>
        )}
      </FormSection>

      <div className="form-actions">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
};
