import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Client, ClientInput, SimilarClientMatch } from '@shared/types';
import { api } from '@renderer/services/api';
import { Button, FormSection, Input, Textarea } from '@renderer/ui/components';

const emptyForm: ClientInput = {
  firstName: '',
  lastName: '',
  phone: '',
  email: null,
  address: null,
  notes: null
};

type SubmitOptions = { force?: boolean };

const extractMatchesFromError = (error: Error | null): SimilarClientMatch[] | null => {
  if (!error) return null;
  const message = String(error.message ?? '');
  const marker = 'SIMILAR_MATCHES=';
  const idx = message.indexOf(marker);
  if (idx < 0) return null;
  try {
    return JSON.parse(message.slice(idx + marker.length)) as SimilarClientMatch[];
  } catch {
    return null;
  }
};

const stripSimilarBlob = (error: Error | null) => {
  if (!error) return '';
  return String(error.message ?? '').replace(/SIMILAR_MATCHES=.*$/s, '').trim();
};

export const ClientForm = ({
  initialValue,
  onSubmit,
  onCancel,
  submitError
}: {
  initialValue?: Client | null;
  onSubmit: (value: ClientInput, options?: SubmitOptions) => void;
  onCancel?: () => void;
  submitError?: Error | null;
}) => {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors }
  } = useForm<ClientInput>({ defaultValues: emptyForm });

  const [previewMatches, setPreviewMatches] = useState<SimilarClientMatch[]>([]);
  const [serverMatches, setServerMatches] = useState<SimilarClientMatch[]>([]);
  const lookupTimer = useRef<number | null>(null);

  useEffect(() => {
    reset(
      initialValue
        ? {
            firstName: initialValue.firstName,
            lastName: initialValue.lastName,
            phone: initialValue.phone,
            email: initialValue.email,
            address: initialValue.address,
            notes: initialValue.notes
          }
        : emptyForm
    );
    setPreviewMatches([]);
    setServerMatches([]);
  }, [initialValue, reset]);

  // Cuando el backend rechaza la creación porque ya existe un cliente
  // similar, recupera la lista exacta para mostrarla en pantalla.
  useEffect(() => {
    const matches = extractMatchesFromError(submitError ?? null);
    if (matches && matches.length > 0) {
      setServerMatches(matches);
    }
  }, [submitError]);

  const firstName = watch('firstName');
  const lastName = watch('lastName');
  const phone = watch('phone');

  // Búsqueda preventiva: a medida que el usuario escribe nombre/apellido o
  // teléfono completos, consultamos similares con debounce. No bloquea
  // el guardado: solo informa antes de enviar.
  useEffect(() => {
    if (initialValue) {
      setPreviewMatches([]);
      return;
    }

    if (lookupTimer.current) {
      window.clearTimeout(lookupTimer.current);
      lookupTimer.current = null;
    }

    const hasPhone = String(phone ?? '').replace(/\D/g, '').length >= 7;
    const hasNames = String(firstName ?? '').trim().length >= 2 && String(lastName ?? '').trim().length >= 2;
    if (!hasPhone && !hasNames) {
      setPreviewMatches([]);
      return;
    }

    lookupTimer.current = window.setTimeout(async () => {
      try {
        const matches = await api.findSimilarClients({
          firstName: String(firstName ?? ''),
          lastName: String(lastName ?? ''),
          phone: String(phone ?? '')
        });
        setPreviewMatches(matches);
      } catch {
        setPreviewMatches([]);
      }
    }, 450);

    return () => {
      if (lookupTimer.current) {
        window.clearTimeout(lookupTimer.current);
        lookupTimer.current = null;
      }
    };
  }, [firstName, lastName, phone, initialValue]);

  const visibleMatches = serverMatches.length > 0 ? serverMatches : previewMatches;
  const hasMatches = !initialValue && visibleMatches.length > 0;

  const handleNormalSubmit = handleSubmit((values) => {
    setServerMatches([]);
    onSubmit(
      {
        ...values,
        email: null,
        address: null,
        notes: values.notes || null
      },
      { force: false }
    );
  });

  const handleForceSubmit = handleSubmit((values) => {
    setServerMatches([]);
    onSubmit(
      {
        ...values,
        email: null,
        address: null,
        notes: values.notes || null
      },
      { force: true }
    );
  });

  const cleanError = stripSimilarBlob(submitError ?? null);

  return (
    <form className="stack-gap" onSubmit={handleNormalSubmit}>
      <FormSection title="Datos del cliente">
        <div className="form-grid">
          <label>
            <span>Nombres</span>
            <Input {...register('firstName', { required: 'Requerido' })} />
            {errors.firstName && <small className="error-text">{errors.firstName.message}</small>}
          </label>
          <label>
            <span>Apellidos</span>
            <Input {...register('lastName', { required: 'Requerido' })} />
            {errors.lastName && <small className="error-text">{errors.lastName.message}</small>}
          </label>
          <label>
            <span>Teléfono</span>
            <Input {...register('phone', { required: 'Requerido' })} />
            {errors.phone && <small className="error-text">{errors.phone.message}</small>}
          </label>
          <label className="full-span">
            <span>
              Notas <small style={{ fontWeight: 400, color: '#6b7280' }}>(400 car. máx.)</small>
            </span>
            <Textarea
              {...register('notes', { maxLength: { value: 400, message: 'Máximo 400 caracteres' } })}
              maxLength={400}
            />
          </label>
        </div>
      </FormSection>

      {hasMatches ? (
        <div
          style={{
            border: '1px solid #f59e0b',
            background: '#fffbeb',
            padding: 12,
            borderRadius: 6
          }}
        >
          <strong style={{ color: '#92400e' }}>
            Ya existe un cliente similar. Revísalo antes de crear uno nuevo.
          </strong>
          <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 13 }}>
            {visibleMatches.map((m) => (
              <li key={m.id} style={{ marginBottom: 4 }}>
                <strong>{m.code}</strong> · {m.firstName} {m.lastName} — {m.phone}{' '}
                <em style={{ color: '#6b7280' }}>
                  ({m.matchedBy === 'both'
                    ? 'mismo nombre y teléfono'
                    : m.matchedBy === 'phone'
                      ? 'mismo teléfono'
                      : 'mismo nombre'})
                </em>
              </li>
            ))}
          </ul>
          {serverMatches.length > 0 ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280' }}>
              Si confirmas que es un cliente nuevo distinto, pulsa "Crear de todas formas".
            </p>
          ) : null}
        </div>
      ) : null}

      {cleanError ? <p className="error-text">{cleanError}</p> : null}

      <div className="form-actions">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit">Guardar cliente</Button>
        {serverMatches.length > 0 ? (
          <Button type="button" variant="secondary" onClick={handleForceSubmit}>
            Crear de todas formas
          </Button>
        ) : null}
      </div>
    </form>
  );
};
