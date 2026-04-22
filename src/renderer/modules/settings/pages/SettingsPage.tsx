import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@shared/types';
import { api } from '@renderer/services/api';
import { Button, DataTable, Input, PageHeader } from '@renderer/ui/components';

export const SettingsPage = ({ user }: { user: SessionUser }) => {
  const [unlocked, setUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({});
  const [currentAdminPassword, setCurrentAdminPassword] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [pdfDirInput, setPdfDirInput] = useState('');
  const [pdfDirError, setPdfDirError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['company-settings'],
    queryFn: api.companySettings,
    enabled: unlocked
  });

  const { data: backups = [] } = useQuery({
    queryKey: ['backups'],
    queryFn: api.listBackups,
    enabled: unlocked
  });

  const {
    data: runtimeDiagnostics,
    refetch: refetchRuntimeDiagnostics,
    isFetching: isRuntimeDiagnosticsLoading
  } = useQuery({
    queryKey: ['runtime-diagnostics'],
    queryFn: api.runtimeDiagnostics,
    enabled: unlocked
  });

  const { data: pdfOutputDir } = useQuery({
    queryKey: ['pdf-output-dir'],
    queryFn: async () => {
      try {
        return await api.getPdfOutputDir();
      } catch {
        return null;
      }
    },
    enabled: unlocked
  });

  const { data: autoReadyByDueDateEnabled = true } = useQuery({
    queryKey: ['auto-ready-by-due-date-enabled'],
    queryFn: api.getAutoReadyByDueDateEnabled,
    enabled: unlocked
  });

  useEffect(() => {
    if (unlocked && data) setForm(data);
  }, [unlocked, data]);

  useEffect(() => {
    if (!unlocked) return;
    setPdfDirInput(pdfOutputDir ?? '');
  }, [unlocked, pdfOutputDir]);

  const [driveUploadStatus, setDriveUploadStatus] = useState<'idle' | 'uploading' | 'refreshing' | 'reauth-required'>('idle');

  const connectDriveMutation = useMutation({
    mutationFn: api.connectDriveBackup,
    onSuccess: () => setDriveUploadStatus('idle')
  });

  const uploadBackupMutation = useMutation({
    mutationFn: () => {
      setDriveUploadStatus('uploading');
      const unsubscribe = (window.desktopApi as any).onBackupUploadProgress?.((status: string) => {
        if (status === 'refreshing') setDriveUploadStatus('refreshing');
      });
      return api.uploadBackupToDrive().finally(() => { try { unsubscribe?.(); } catch {} });
    },
    onSuccess: async () => {
      setDriveUploadStatus('idle');
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error: Error) => {
      if (error.message.startsWith('REAUTH_REQUIRED:')) {
        setDriveUploadStatus('reauth-required');
      } else {
        setDriveUploadStatus('idle');
      }
    }
  });

  const updateAdminPasswordMutation = useMutation({
    mutationFn: api.updateOrderProtectionPassword,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order-protection-password'] });

      setCurrentAdminPassword('');
      setNewAdminPassword('');
      setConfirmAdminPassword('');
    }
  });

  const updatePdfDirMutation = useMutation({
    mutationFn: api.updatePdfOutputDir,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pdf-output-dir'] });
    }
  });

  const updateAutoReadyMutation = useMutation({
    mutationFn: api.updateAutoReadyByDueDateEnabled,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auto-ready-by-due-date-enabled'] });
    }
  });

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwLoading(true);
    try {
      await api.login({ username: user.username, password: pwInput });
      setUnlocked(true);
    } catch {
      setPwError('Contraseña incorrecta. Intenta de nuevo.');
    } finally {
      setPwLoading(false);
    }
  };

  if (!unlocked) {
    return (
      <section className="stack-gap">
        <PageHeader title="Configuración" subtitle="Se requiere tu contraseña para continuar." />
        <div className="card-panel" style={{ maxWidth: 400 }}>
          <form className="stack-gap" onSubmit={handleUnlock}>
            <label>
              <span>Contraseña</span>
              <Input
                type="password"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder="Ingresa tu contraseña de sesión"
                autoFocus
              />
            </label>
            {pwError && <p className="error-text">{pwError}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={pwLoading || !pwInput.trim()}>
                {pwLoading ? 'Verificando...' : 'Confirmar y continuar'}
              </Button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  const handleSave = async () => {
    setSaveSuccess(false);
    await api.updateCompanySettings(form);
    await refetch();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleLogoUpload = (file: File) => {
    const reader = new FileReader();

    reader.onload = () => {
      setForm((prev: any) => ({
        ...prev,
        logoBase64: reader.result
      }));
    };

    reader.readAsDataURL(file);
  };

  return (
    <section className="stack-gap">
      <PageHeader
        title="Configuración"
        subtitle="Datos del negocio, políticas, seguridad y backups."
      />

      <div className="card-panel stack-gap">
        <label>
          <span>Nombre comercial</span>
          <Input
            value={form.companyName || ''}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
        </label>

        <label>
          <span>NIT</span>
          <Input
            value={form.nit || ''}
            onChange={(e) => setForm({ ...form, nit: e.target.value })}
          />
        </label>

        <label>
          <span>Nombre legal</span>
          <Input
            value={form.legalName || ''}
            onChange={(e) => setForm({ ...form, legalName: e.target.value })}
          />
        </label>

        <label>
          <span>Teléfono</span>
          <Input
            value={form.phone || ''}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>

        <label>
          <span>Email</span>
          <Input
            value={form.email || ''}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>

        <label>
          <span>Dirección</span>
          <Input
            value={form.address || ''}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </label>

        <label>
          <span>Logo</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                handleLogoUpload(e.target.files[0]);
              }
            }}
          />
        </label>

        {form.logoBase64 && (
          <div className="card-panel" style={{ background: '#f8fafc' }}>
            <p style={{ marginTop: 0 }}><strong>Vista previa del logo</strong></p>
            <img
              src={form.logoBase64}
              alt="Logo del negocio"
              style={{
                maxWidth: 140,
                maxHeight: 140,
                objectFit: 'contain',
                display: 'block'
              }}
            />
          </div>
        )}

        <label>
          <span>Políticas del negocio (factura y WhatsApp)</span>
          <textarea
            className="field"
            rows={6}
            value={form.invoicePolicies || ''}
            onChange={(e) =>
              setForm({ ...form, invoicePolicies: e.target.value })
            }
            placeholder="Ej: No nos hacemos responsables por prendas no reclamadas en 30 días..."
            style={{ resize: 'vertical', paddingTop: 12 }}
          />
        </label>

        <div className="form-actions">
          <Button onClick={handleSave}>
            Guardar configuración
          </Button>
        </div>
        {saveSuccess && (
          <p style={{ margin: 0, color: 'green' }}>Configuración guardada correctamente ✅</p>
        )}
      </div>

      <div className="card-panel stack-gap">
  <h3>Seguridad de órdenes</h3>

  <label>
    <span>Contraseña administrativa actual</span>
    <Input
      type="password"
      value={currentAdminPassword}
      onChange={(e) => setCurrentAdminPassword(e.target.value)}
      placeholder="Ingresa la contraseña actual"
    />
  </label>

  <label>
    <span>Nueva contraseña administrativa</span>
    <Input
      type="password"
      value={newAdminPassword}
      onChange={(e) => setNewAdminPassword(e.target.value)}
      placeholder="Ingresa la nueva contraseña"
    />
  </label>

  <label>
    <span>Confirmar nueva contraseña</span>
    <Input
      type="password"
      value={confirmAdminPassword}
      onChange={(e) => setConfirmAdminPassword(e.target.value)}
      placeholder="Repite la nueva contraseña"
    />
  </label>

  <div className="form-actions">
    <Button
      onClick={() =>
        updateAdminPasswordMutation.mutate({
          currentPassword: currentAdminPassword,
          newPassword: newAdminPassword,
          confirmPassword: confirmAdminPassword
        })
      }
      disabled={updateAdminPasswordMutation.isPending}
    >
      {updateAdminPasswordMutation.isPending
        ? 'Guardando...'
        : 'Actualizar contraseña'}
    </Button>
  </div>

  {updateAdminPasswordMutation.isError && (
    <p className="error-text">
      {(updateAdminPasswordMutation.error as Error).message}
    </p>
  )}

  {updateAdminPasswordMutation.isSuccess && (
    <p style={{ color: 'green', margin: 0 }}>
      Contraseña administrativa actualizada correctamente.
    </p>
  )}
</div>

      <div className="card-panel stack-gap">
        <h3>Automatización de órdenes</h3>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={autoReadyByDueDateEnabled}
            onChange={(e) => updateAutoReadyMutation.mutate(e.target.checked)}
            disabled={updateAutoReadyMutation.isPending}
            style={{ marginTop: 4 }}
          />
          <div>
            <strong>Cambio automático a "Lista" por fecha promesa</strong>
            <p style={{ margin: '6px 0 0', color: '#6b7280' }}>
              Si se desactiva, las órdenes vencidas seguirán apareciendo para revisión,
              pero no cambiarán automáticamente a "Lista".
            </p>
          </div>
        </label>

        {updateAutoReadyMutation.isError && (
          <p className="error-text">
            {(updateAutoReadyMutation.error as Error).message}
          </p>
        )}

        {updateAutoReadyMutation.isSuccess && (
          <p style={{ color: 'green', margin: 0 }}>
            Preferencia de automatización actualizada correctamente.
          </p>
        )}
      </div>

      <div className="card-panel stack-gap">
        <h3>PDF y Facturas</h3>
        <label>
          <span>Carpeta de guardado PDF (facturas/reportes)</span>
          <Input
            value={pdfDirInput}
            onChange={(e) => setPdfDirInput(e.target.value)}
            placeholder="Ej: /Users/tuusuario/Documents/LavaSuite/Facturas"
          />
        </label>
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              setPdfDirError('');
              try {
                const result = await api.selectDirectory();
                if (result.selected && result.path) {
                  setPdfDirInput(result.path);
                }
              } catch (error) {
                setPdfDirError((error as Error).message);
              }
            }}
          >
            Seleccionar carpeta
          </Button>
          <Button
            type="button"
            onClick={() => {
              setPdfDirError('');
              updatePdfDirMutation.mutate(pdfDirInput || null);
            }}
            disabled={updatePdfDirMutation.isPending}
          >
            {updatePdfDirMutation.isPending ? 'Guardando...' : 'Guardar carpeta PDF'}
          </Button>
        </div>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          Aquí se guarda automáticamente la exportación de facturas y reportes.
        </p>
        {updatePdfDirMutation.isError && (
          <p className="error-text">{(updatePdfDirMutation.error as Error).message}</p>
        )}
        {pdfDirError && <p className="error-text">{pdfDirError}</p>}
        {updatePdfDirMutation.isSuccess && (
          <p style={{ margin: 0, color: 'green' }}>Carpeta PDF actualizada.</p>
        )}
      </div>

      <div className="card-panel stack-gap">
        <h3>Diagnóstico runtime (build autocontenida)</h3>
        <p style={{ margin: 0, color: '#6b7280' }}>
          Estado de dependencias críticas para instalación Windows.
        </p>

        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => refetchRuntimeDiagnostics()}
            disabled={isRuntimeDiagnosticsLoading}
          >
            {isRuntimeDiagnosticsLoading ? 'Verificando...' : 'Revalidar diagnóstico'}
          </Button>
        </div>

        {runtimeDiagnostics ? (
          <>
            <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151' }}>
              <span><strong>Plataforma:</strong> {runtimeDiagnostics.platform}</span>
              <span><strong>Empaquetada:</strong> {runtimeDiagnostics.isPackaged ? 'Sí' : 'No'}</span>
              <span><strong>appPath:</strong> {runtimeDiagnostics.appPath}</span>
              <span><strong>resourcesPath:</strong> {runtimeDiagnostics.resourcesPath}</span>
            </div>

            <DataTable
              rows={runtimeDiagnostics.checks}
              columns={[
                {
                  key: 'check',
                  header: 'Chequeo',
                  render: (row) => row.key
                },
                {
                  key: 'status',
                  header: 'Estado',
                  render: (row) => {
                    const color =
                      row.status === 'ok'
                        ? '#065f46'
                        : row.status === 'warning'
                          ? '#92400e'
                          : '#991b1b';
                    const background =
                      row.status === 'ok'
                        ? '#d1fae5'
                        : row.status === 'warning'
                          ? '#fef3c7'
                          : '#fee2e2';

                    return (
                      <span
                        style={{
                          color,
                          background,
                          borderRadius: 999,
                          padding: '2px 8px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          fontSize: 11
                        }}
                      >
                        {row.status}
                      </span>
                    );
                  }
                },
                {
                  key: 'required',
                  header: 'Requerido',
                  render: (row) => (row.required ? 'Sí' : 'No')
                },
                {
                  key: 'message',
                  header: 'Mensaje',
                  render: (row) => row.message
                },
                {
                  key: 'path',
                  header: 'Ruta detectada',
                  render: (row) => row.resolvedPath || '—'
                }
              ]}
            />
          </>
        ) : (
          <p style={{ margin: 0, color: '#6b7280' }}>
            Ejecuta “Revalidar diagnóstico” para obtener el estado actual.
          </p>
        )}
      </div>

      <div className="card-panel stack-gap">
        <h3>Backups en Google Drive</h3>

        {driveUploadStatus === 'reauth-required' && (
          <div className="alert-warning">
            Tu conexión con Google Drive expiró. Por favor haz clic en{' '}
            <strong>"Conectar Google Drive"</strong> para reconectar.
          </div>
        )}

        <div className="form-actions">
          <Button
            onClick={() => {
              setDriveUploadStatus('idle');
              connectDriveMutation.mutate();
            }}
            disabled={connectDriveMutation.isPending}
          >
            {connectDriveMutation.isPending ? 'Conectando...' : 'Conectar Google Drive'}
          </Button>

          <Button
            variant="secondary"
            onClick={() => uploadBackupMutation.mutate()}
            disabled={uploadBackupMutation.isPending || driveUploadStatus === 'reauth-required'}
          >
            {driveUploadStatus === 'refreshing'
              ? 'Reconectando con Google Drive...'
              : uploadBackupMutation.isPending
                ? 'Subiendo...'
                : 'Crear backup y subir'}
          </Button>
        </div>

        {connectDriveMutation.isError && (
          <p className="error-text">
            {(connectDriveMutation.error as Error).message}
          </p>
        )}

        {uploadBackupMutation.isError && driveUploadStatus !== 'reauth-required' && (
          <p className="error-text">
            {(uploadBackupMutation.error as Error).message.replace(/^REAUTH_REQUIRED:\s*/, '')}
          </p>
        )}

        {connectDriveMutation.data && (
          <p>{connectDriveMutation.data.message}</p>
        )}

        {uploadBackupMutation.data && (
          <p>{uploadBackupMutation.data.message}</p>
        )}

        <DataTable
          rows={backups}
          columns={[
            {
              key: 'file',
              header: 'Archivo',
              render: (row) => row.file_name
            },
            {
              key: 'status',
              header: 'Estado',
              render: (row) => row.status
            },
            {
              key: 'message',
              header: 'Mensaje',
              render: (row) => row.message || '—'
            },
            {
              key: 'date',
              header: 'Fecha',
              render: (row) =>
                row.created_at
                  ? new Date(row.created_at).toLocaleString('es-CO')
                  : '—'
            }
          ]}
        />
      </div>
    </section>
  );
};
