import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Client, ClientMergeResult } from '@shared/types';
import { api } from '@renderer/services/api';
import { useModal } from '@renderer/hooks/useModal';
import { Button, DataTable, Modal, PageHeader } from '@renderer/ui/components';
import { showToast } from '@renderer/utils/toast';
import { clientMatchesSearch } from '@renderer/utils/clientSearch';
import { ClientForm } from '../components/ClientForm';

const ROW_LIMIT = 200;

type MergeContext = {
  duplicate: Client;
  primaryId: number | null;
};

export const ClientsPage = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [createFormKey, setCreateFormKey] = useState(0);
  const [deleteInfo, setDeleteInfo] = useState<string | null>(null);
  const [mergeCtx, setMergeCtx] = useState<MergeContext | null>(null);
  const [mergeSearch, setMergeSearch] = useState('');
  const editModal = useModal<Client>();

  // Si la consulta falla, la tabla NO debe quedar vacía en silencio: eso
  // hace creer que los clientes se borraron. Conservamos los datos previos
  // y mostramos el error con un botón de reintento.
  const {
    data = [],
    isLoading: loadingClients,
    isError: clientsError,
    error: clientsErrorObj,
    isFetching: fetchingClients,
    refetch: refetchClients
  } = useQuery({
    queryKey: ['clients'],
    queryFn: api.listClients,
    retry: 2,
    placeholderData: (previous: Client[] | undefined) => previous
  });

  const createMutation = useMutation({
    mutationFn: api.createClient,
    onSuccess: async () => {
      setCreateFormKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.updateClient(id, data),
    onSuccess: async () => {
      editModal.close();
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteClient,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  });

  const mergeMutation = useMutation({
    mutationFn: ({ primaryId, duplicateId }: { primaryId: number; duplicateId: number }) =>
      api.mergeClients(primaryId, duplicateId),
    onSuccess: async (result: ClientMergeResult) => {
      setMergeCtx(null);
      setMergeSearch('');
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['orders-page'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const moved = result.movedCounts;
      const summary = [
        moved.orders > 0 ? `${moved.orders} órdenes` : null,
        moved.invoices > 0 ? `${moved.invoices} facturas` : null,
        moved.payments > 0 ? `${moved.payments} pagos` : null,
        moved.deliveries > 0 ? `${moved.deliveries} entregas` : null,
        moved.measurements > 0 ? `${moved.measurements} mediciones` : null
      ]
        .filter(Boolean)
        .join(' · ') || 'sin historial';
      showToast(
        `Fusión exitosa: se reasignó ${summary} a ${result.primary.firstName} ${result.primary.lastName}.`,
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
    }
  });

  const trimmedSearch = search.trim();

  const filtered = useMemo(
    () => data.filter((client) => clientMatchesSearch(client, trimmedSearch)),
    [data, trimmedSearch]
  );

  // Red de seguridad: si el listado local no encuentra nada, se pregunta
  // directo a la base de datos antes de dar por hecho que el cliente no
  // existe (listado desactualizado, carga fallida, etc.).
  const {
    data: serverMatches = [],
    isFetching: searchingServer
  } = useQuery({
    queryKey: ['clients-search', trimmedSearch],
    queryFn: () => api.searchClientsByName(trimmedSearch, 50),
    enabled: trimmedSearch.length >= 2 && filtered.length === 0,
    staleTime: 30 * 1000
  });

  const usingServerMatches = filtered.length === 0 && serverMatches.length > 0;
  const visibleClients = usingServerMatches ? serverMatches : filtered;

  // Con miles de clientes, pintar todas las filas congela la pantalla. Se
  // muestran las primeras y el buscador sigue recorriendo la lista
  // completa, así que ningún cliente queda fuera de alcance.
  const renderedClients = visibleClients.slice(0, ROW_LIMIT);
  const hiddenCount = visibleClients.length - renderedClients.length;

  const emptyMessage = loadingClients
    ? 'Cargando clientes...'
    : clientsError
      ? 'No se pudo cargar el listado. Los clientes NO fueron eliminados: revisa el mensaje de arriba y pulsa "Reintentar".'
      : searchingServer
        ? 'Buscando en la base de datos...'
        : trimmedSearch
          ? `Ningún cliente coincide con "${trimmedSearch}". Prueba con el teléfono (solo números), el código CLI o solo el apellido antes de crear uno nuevo.`
          : 'Aún no hay clientes registrados.';

  const mergeCandidates = useMemo(() => {
    if (!mergeCtx) return [] as Client[];
    return data
      .filter((c) => c.id !== mergeCtx.duplicate.id)
      .filter((c) => clientMatchesSearch(c, mergeSearch))
      .slice(0, 25);
  }, [data, mergeSearch, mergeCtx]);

  return (
    <section className="stack-gap">
      <PageHeader
        title="Clientes"
        subtitle="Listado y formulario funcional para registrar, editar, fusionar y eliminar clientes."
        actions={
          <input
            className="field compact-field"
            placeholder="Buscar cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />

      {clientsError && (
        <div className="card-panel" style={{ borderLeft: '4px solid #dc2626' }}>
          <p className="error-text" style={{ margin: 0 }}>
            <strong>No fue posible cargar el listado de clientes.</strong>{' '}
            {(clientsErrorObj as Error)?.message}
          </p>
          <p style={{ margin: '6px 0 10px', color: '#6b7280' }}>
            Ningún cliente fue eliminado: es un problema de conexión con la base de datos. No
            vuelvas a crear el cliente; reintenta la carga.
          </p>
          <Button variant="secondary" onClick={() => refetchClients()} disabled={fetchingClients}>
            {fetchingClients ? 'Reintentando...' : 'Reintentar'}
          </Button>
        </div>
      )}

      <div className="split-grid">
        <div className="card-panel">
          {usingServerMatches && (
            <p style={{ margin: '0 0 10px', color: '#2563eb', fontSize: 13 }}>
              Estos resultados vienen directo de la base de datos porque no aparecían en el
              listado cargado. El cliente existe: no lo crees de nuevo.
            </p>
          )}
          <DataTable
            emptyMessage={emptyMessage}
            rows={renderedClients}
            columns={[
              { key: 'code', header: 'Código', render: (row) => row.code },
              { key: 'name', header: 'Cliente', render: (row) => `${row.firstName} ${row.lastName}` },
              { key: 'phone', header: 'Teléfono', render: (row) => row.phone },
              {
                key: 'orders',
                header: 'Órdenes',
                render: (row) => row.ordersCount ?? 0
              },
              {
                key: 'actions',
                header: 'Acciones',
                render: (row) => (
                  <div className="row-actions">
                    <Button variant="secondary" onClick={() => editModal.open(row)}>
                      Editar
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMergeCtx({ duplicate: row, primaryId: null });
                        setMergeSearch('');
                      }}
                      title="Fusionar este cliente duplicado en otro existente"
                    >
                      Fusionar duplicado
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (Number(row.ordersCount ?? 0) > 0) {
                          setDeleteInfo(
                            `No se puede eliminar este cliente porque tiene ${row.ordersCount} orden(es). ` +
                              `Si es un duplicado, usa "Fusionar duplicado".`
                          );
                          return;
                        }
                        setDeleteInfo(null);
                        deleteMutation.mutate(row.id);
                      }}
                      title={
                        Number(row.ordersCount ?? 0) > 0
                          ? `No se puede eliminar: tiene ${row.ordersCount} orden(es).`
                          : 'Eliminar cliente'
                      }
                    >
                      Eliminar
                    </Button>
                  </div>
                )
              }
            ]}
          />
          {hiddenCount > 0 && (
            <p style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
              Mostrando {renderedClients.length} de {visibleClients.length} clientes. Usa el
              buscador (nombre, teléfono o código) para llegar a cualquiera de los demás.
            </p>
          )}
          {deleteInfo && <p className="error-text" style={{ marginTop: 10 }}>{deleteInfo}</p>}
        </div>

        <div className="card-panel">
          <PageHeader title="Nuevo cliente" />
          <ClientForm
            key={createFormKey}
            onSubmit={(value, options) =>
              createMutation.mutate({ ...value, force: options?.force ?? false })
            }
            submitError={createMutation.error as Error | null}
          />
          {createMutation.isSuccess && (
            <p style={{ color: '#16a34a', fontSize: 13, marginTop: 8 }}>
              Cliente registrado correctamente.
            </p>
          )}
        </div>
      </div>

      <Modal open={editModal.isOpen} title="Editar cliente" onClose={editModal.close}>
        <ClientForm
          initialValue={editModal.payload}
          onCancel={editModal.close}
          onSubmit={(value) =>
            editModal.payload && updateMutation.mutate({ id: editModal.payload.id, data: value })
          }
          submitError={updateMutation.error as Error | null}
        />
      </Modal>

      <Modal
        open={!!mergeCtx}
        title="Fusionar cliente duplicado"
        onClose={() => {
          setMergeCtx(null);
          setMergeSearch('');
        }}
      >
        {mergeCtx ? (
          <div className="stack-gap">
            <p style={{ marginTop: 0 }}>
              Vas a mover todo el historial (órdenes, facturas, pagos, entregas, mediciones) del
              cliente duplicado <strong>{mergeCtx.duplicate.code} · {mergeCtx.duplicate.firstName} {mergeCtx.duplicate.lastName}</strong>{' '}
              hacia un cliente principal. El cliente duplicado se eliminará al finalizar.
            </p>

            <input
              className="field"
              placeholder="Buscar cliente principal por nombre, teléfono o código"
              value={mergeSearch}
              onChange={(e) => setMergeSearch(e.target.value)}
              autoFocus
            />

            <div
              style={{
                maxHeight: 280,
                overflow: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 6
              }}
            >
              <table style={{ width: '100%', fontSize: 13 }}>
                <thead style={{ background: '#f9fafb' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8 }}>Código</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Cliente</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Teléfono</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Seleccionar</th>
                  </tr>
                </thead>
                <tbody>
                  {mergeCandidates.map((c) => (
                    <tr
                      key={c.id}
                      style={{
                        background: mergeCtx.primaryId === c.id ? '#ecfdf5' : undefined,
                        borderTop: '1px solid #f1f5f9'
                      }}
                    >
                      <td style={{ padding: 8 }}>{c.code}</td>
                      <td style={{ padding: 8 }}>
                        {c.firstName} {c.lastName}
                      </td>
                      <td style={{ padding: 8 }}>{c.phone}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <Button
                          variant={mergeCtx.primaryId === c.id ? 'primary' : 'secondary'}
                          onClick={() => setMergeCtx({ ...mergeCtx, primaryId: c.id })}
                        >
                          {mergeCtx.primaryId === c.id ? 'Elegido' : 'Elegir'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {mergeCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, color: '#6b7280' }}>
                        No hay coincidencias. Ajusta el término de búsqueda.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="form-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setMergeCtx(null);
                  setMergeSearch('');
                }}
              >
                Cancelar
              </Button>
              <Button
                disabled={!mergeCtx.primaryId || mergeMutation.isPending}
                onClick={() => {
                  if (!mergeCtx.primaryId) return;
                  const ok = window.confirm(
                    `¿Confirmas la fusión? Se moverá el historial al cliente principal y se eliminará ${mergeCtx.duplicate.code}. Esta acción es irreversible.`
                  );
                  if (!ok) return;
                  mergeMutation.mutate({
                    primaryId: mergeCtx.primaryId,
                    duplicateId: mergeCtx.duplicate.id
                  });
                }}
              >
                {mergeMutation.isPending ? 'Fusionando...' : 'Fusionar ahora'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {deleteMutation.isError && (
        <p className="error-text">{(deleteMutation.error as Error).message}</p>
      )}
    </section>
  );
};
