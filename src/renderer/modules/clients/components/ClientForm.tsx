import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { Client, ClientInput } from '@shared/types';
import { Button, FormSection, Input, Textarea } from '@renderer/ui/components';

const emptyForm: ClientInput = { firstName: '', lastName: '', phone: '', email: null, address: null, notes: null };

export const ClientForm = ({ initialValue, onSubmit, onCancel }: { initialValue?: Client | null; onSubmit: (value: ClientInput) => void; onCancel?: () => void }) => {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ClientInput>({ defaultValues: emptyForm });

  useEffect(() => {
    reset(initialValue ? {
      firstName: initialValue.firstName,
      lastName: initialValue.lastName,
      phone: initialValue.phone,
      email: initialValue.email,
      address: initialValue.address,
      notes: initialValue.notes
    } : emptyForm);
  }, [initialValue, reset]);

  return (
    <form className="stack-gap" onSubmit={handleSubmit((values) => onSubmit({
      ...values,
      email: null,
      address: null,
      notes: values.notes || null
    }))}>
      <FormSection title="Datos del cliente">
        <div className="form-grid">
          <label><span>Nombres</span><Input {...register('firstName', { required: 'Requerido' })} />{errors.firstName && <small className="error-text">{errors.firstName.message}</small>}</label>
          <label><span>Apellidos</span><Input {...register('lastName', { required: 'Requerido' })} />{errors.lastName && <small className="error-text">{errors.lastName.message}</small>}</label>
          <label><span>Teléfono</span><Input {...register('phone', { required: 'Requerido' })} />{errors.phone && <small className="error-text">{errors.phone.message}</small>}</label>
          <label className="full-span"><span>Notas <small style={{ fontWeight: 400, color: '#6b7280' }}>(400 car. máx.)</small></span><Textarea {...register('notes', { maxLength: { value: 400, message: 'Máximo 400 caracteres' } })} maxLength={400} /></label>
        </div>
      </FormSection>
      <div className="form-actions">
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit">Guardar cliente</Button>
      </div>
    </form>
  );
};
