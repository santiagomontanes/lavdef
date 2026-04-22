import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import type { BatchPaymentInput, CatalogsPayload, PaymentLineInput } from '@shared/types';
import { Button, Input, PriceInput, Select } from '@renderer/ui/components';
import { currency } from '@renderer/utils/format';

type FormValues = {
  lines: PaymentLineInput[];
};

export const PaymentForm = ({
  orderId,
  catalogs,
  balanceDue,
  onSubmit
}: {
  orderId: number;
  catalogs?: CatalogsPayload;
  balanceDue: number;
  onSubmit: (value: BatchPaymentInput) => void;
}) => {
  const defaultMethodId = catalogs?.paymentMethods?.[0]?.id ?? 1;

  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      lines: [{ paymentMethodId: defaultMethodId, amount: Number(balanceDue || 0), reference: null }]
    }
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // useWatch triggers re-render on every field change (unlike watch which may batch)
  const lines = useWatch({ control, name: 'lines' }) ?? [];

  const totalEntered = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const amountApplied = Math.min(totalEntered, Number(balanceDue || 0));
  const change = Math.max(0, totalEntered - Number(balanceDue || 0));
  const pendingAfter = Math.max(0, Number(balanceDue || 0) - amountApplied);

  return (
    <form
      className="stack-gap"
      onSubmit={handleSubmit((values) => {
        const validLines = values.lines.filter((l) => Number(l.amount || 0) > 0);
        if (validLines.length === 0) return;

        onSubmit({
          orderId,
          lines: validLines.map((l) => ({
            paymentMethodId: Number(l.paymentMethodId),
            amount: Number(l.amount),
            reference: l.reference || null
          }))
        });
      })}
    >
      <div className="stack-gap">
        {fields.map((field, index) => (
          <div key={field.id} className="card-panel" style={{ padding: '12px 16px' }}>
            <div className="form-grid">
              <label>
                <span>Método de pago</span>
                <Select
                  {...register(`lines.${index}.paymentMethodId`, { valueAsNumber: true })}
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
                  value={lines[index]?.amount ?? 0}
                  onChange={(v) => setValue(`lines.${index}.amount`, v)}
                />
              </label>

              <label>
                <span>Referencia</span>
                <Input {...register(`lines.${index}.reference`)} placeholder="Opcional" />
              </label>

              {fields.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Button type="button" variant="danger" onClick={() => remove(index)}>
                    Quitar
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            append({ paymentMethodId: defaultMethodId, amount: 0, reference: null })
          }
        >
          + Agregar método de pago
        </Button>
      </div>

      <div className="card-panel stack-gap" style={{ background: '#f8fafc' }}>
        <div className="detail-row">
          <span>Saldo pendiente</span>
          <strong>{currency(Number(balanceDue || 0))}</strong>
        </div>
        <div className="detail-row">
          <span>Total ingresado</span>
          <strong>{currency(totalEntered)}</strong>
        </div>
        <div className="detail-row">
          <span>Se aplicará al pago</span>
          <strong>{currency(amountApplied)}</strong>
        </div>
        <div className="detail-row">
          <span>Cambio a devolver</span>
          <strong>{currency(change)}</strong>
        </div>
        <div className="detail-row">
          <span>Saldo después del pago</span>
          <strong>{currency(pendingAfter)}</strong>
        </div>
      </div>

      <div className="form-actions">
        <Button type="submit">Registrar pago</Button>
      </div>
    </form>
  );
};
