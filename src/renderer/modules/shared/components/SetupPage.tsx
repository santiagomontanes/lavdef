import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Input
} from '@renderer/ui/components';
import { api } from '@renderer/services/api';
import type {
  SetupInitializeProgress,
  SetupApplicationUserInput,
  SetupRootConnectionInput
} from '@shared/types';

type Props = {
  healthMessage?: string | null;
  onCompleted?: () => Promise<void> | void;
};

const initialRootState: SetupRootConnectionInput = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  databaseName: 'lavand',
  ssl: false
};

const initialAdminUser: SetupApplicationUserInput = {
  username: 'admin',
  password: '',
  fullName: ''
};

const initialSellerUser: SetupApplicationUserInput = {
  username: 'vendedor',
  password: '',
  fullName: ''
};

export const SetupPage = ({ healthMessage, onCompleted }: Props) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rootConfig, setRootConfig] = useState(initialRootState);
  const [mysqlAppUsername, setMysqlAppUsername] = useState('lavand_app');
  const [mysqlAppPassword, setMysqlAppPassword] = useState('');
  const [adminUser, setAdminUser] = useState(initialAdminUser);
  const [sellerUser, setSellerUser] = useState(initialSellerUser);
  const [schemaSummary, setSchemaSummary] = useState<string[]>([]);
  const [schemaProgress, setSchemaProgress] = useState<SetupInitializeProgress | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    return api.onSetupInitializeProgress((progress) => {
      setSchemaProgress(progress);
      if (progress.status === 'completed') {
        setSchemaSummary((prev) =>
          progress.file && !prev.includes(progress.file)
            ? [...prev, progress.file]
            : prev
        );
      }
    });
  }, []);

  const createDatabaseMutation = useMutation({
    mutationFn: api.setupCreateDatabase,
    onSuccess: () => {
      setLocalError('');
      setStep(2);
    }
  });

  const initializeSchemaMutation = useMutation({
    mutationFn: api.setupInitializeSchema,
    onSuccess: (result) => {
      setLocalError('');
      setSchemaSummary(result.executedFiles);
      setSchemaProgress((prev) =>
        prev
          ? {
              ...prev,
              current: result.executedFiles.length,
              total: result.executedFiles.length,
              percent: 100,
              status: 'completed',
              message: 'Inicialización completada.'
            }
          : null
      );
      setStep(3);
    }
  });

  const finalizeMutation = useMutation({
    mutationFn: api.setupFinalize,
    onSuccess: async () => {
      if (onCompleted) {
        await onCompleted();
      }

      await api.restartApp();
    }
  });

  const currentError = useMemo(() => {
    if (localError) return localError;
    if (createDatabaseMutation.isError) {
      return (createDatabaseMutation.error as Error).message;
    }
    if (initializeSchemaMutation.isError) {
      return (initializeSchemaMutation.error as Error).message;
    }
    if (finalizeMutation.isError) {
      return (finalizeMutation.error as Error).message;
    }

    return '';
  }, [
    createDatabaseMutation.error,
    createDatabaseMutation.isError,
    finalizeMutation.error,
    finalizeMutation.isError,
    initializeSchemaMutation.error,
    initializeSchemaMutation.isError,
    localError
  ]);

  const updateRootField = <K extends keyof SetupRootConnectionInput>(
    key: K,
    value: SetupRootConnectionInput[K]
  ) => {
    setRootConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreateDatabase = () => {
    if (!rootConfig.host.trim()) {
      setLocalError('Debes ingresar el host de MySQL.');
      return;
    }

    if (!rootConfig.user.trim()) {
      setLocalError('Debes ingresar el usuario root de MySQL.');
      return;
    }

    if (!rootConfig.databaseName.trim()) {
      setLocalError('Debes indicar el nombre de la base de datos.');
      return;
    }

    setLocalError('');
    createDatabaseMutation.mutate(rootConfig);
  };

  const handleInitializeSchema = () => {
    setLocalError('');
    setSchemaSummary([]);
    setSchemaProgress({
      current: 0,
      total: 1,
      percent: 0,
      file: '',
      status: 'running',
      message: 'Preparando ejecución de migraciones...'
    });
    initializeSchemaMutation.mutate(rootConfig);
  };

  const handleFinalize = () => {
    if (!mysqlAppUsername.trim()) {
      setLocalError('Debes ingresar el usuario MySQL de la aplicación.');
      return;
    }

    if (!mysqlAppPassword.trim()) {
      setLocalError('Debes ingresar la contraseña del usuario MySQL de la aplicación.');
      return;
    }

    if (!adminUser.username.trim() || !adminUser.password.trim() || !adminUser.fullName.trim()) {
      setLocalError('Completa todos los datos del Administrador.');
      return;
    }

    if (!sellerUser.username.trim() || !sellerUser.password.trim() || !sellerUser.fullName.trim()) {
      setLocalError('Completa todos los datos del Vendedor.');
      return;
    }

    setLocalError('');
    finalizeMutation.mutate({
      root: rootConfig,
      appUser: {
        username: mysqlAppUsername.trim(),
        password: mysqlAppPassword
      },
      adminUser: {
        username: adminUser.username.trim(),
        password: adminUser.password,
        fullName: adminUser.fullName.trim()
      },
      sellerUser: {
        username: sellerUser.username.trim(),
        password: sellerUser.password,
        fullName: sellerUser.fullName.trim()
      }
    });
  };

  return (
    <div className="auth-screen">
      <div className="setup-card-large stack-gap">
        <div>
          <span className="eyebrow">Configuración inicial</span>
          <h2>Asistente de instalación de LavaSuite</h2>
          <p>
            Este asistente se muestra cuando no existe una base configurada o la conexión actual falló.
          </p>
          {healthMessage ? (
            <p className="alert-warning" style={{ marginTop: 12 }}>
              {healthMessage}
            </p>
          ) : null}
        </div>

        <div className="summary-grid">
          {[1, 2, 3].map((wizardStep) => (
            <div
              key={wizardStep}
              className="card-panel"
              style={{
                border: wizardStep === step ? '2px solid #4f6ef7' : '1px solid #e5ebf1',
                padding: 16
              }}
            >
              <strong>Paso {wizardStep}</strong>
              <p style={{ margin: '8px 0 0' }}>
                {wizardStep === 1
                  ? 'Crear base de datos'
                  : wizardStep === 2
                    ? 'Inicializar esquema SQL'
                    : 'Crear usuarios y conexión final'}
              </p>
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="card-panel stack-gap">
            <h3>Paso 1. Crear la base de datos</h3>

            <div className="form-grid">
              <label>
                <span>Host</span>
                <Input
                  value={rootConfig.host}
                  onChange={(e) => updateRootField('host', e.target.value)}
                />
              </label>

              <label>
                <span>Puerto</span>
                <Input
                  type="number"
                  value={rootConfig.port}
                  onChange={(e) => updateRootField('port', Number(e.target.value))}
                />
              </label>

              <label>
                <span>Usuario root</span>
                <Input
                  value={rootConfig.user}
                  onChange={(e) => updateRootField('user', e.target.value)}
                />
              </label>

              <label>
                <span>Contraseña root</span>
                <Input
                  type="password"
                  value={rootConfig.password}
                  onChange={(e) => updateRootField('password', e.target.value)}
                />
              </label>

              <label className="full-span">
                <span>Base de datos</span>
                <Input
                  value={rootConfig.databaseName}
                  onChange={(e) => updateRootField('databaseName', e.target.value)}
                />
              </label>
            </div>

            <div className="form-actions">
              <Button
                onClick={handleCreateDatabase}
                disabled={createDatabaseMutation.isPending}
              >
                {createDatabaseMutation.isPending
                  ? 'Creando base de datos...'
                  : 'Crear base de datos'}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="card-panel stack-gap">
            <h3>Paso 2. Ejecutar script SQL de inicialización</h3>
            <p>
              Se ejecutarán las migraciones SQL idempotentes sobre la base <strong>{rootConfig.databaseName}</strong>.
            </p>

            {schemaProgress ? (
              <div className="card-panel" style={{ background: '#f8fafc' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 8,
                    fontSize: 14
                  }}
                >
                  <strong>{schemaProgress.message}</strong>
                  <span>{schemaProgress.percent}%</span>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 12,
                    borderRadius: 999,
                    background: '#dbe4f0',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${schemaProgress.percent}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #4f6ef7 0%, #6ea8fe 100%)',
                      transition: 'width 180ms ease'
                    }}
                  />
                </div>

                <p style={{ margin: '8px 0 0', fontSize: 14 }}>
                  {schemaProgress.file
                    ? `Archivo actual: ${schemaProgress.file} (${schemaProgress.current}/${schemaProgress.total})`
                    : `Preparando scripts...`}
                </p>

                {schemaSummary.length ? (
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: '#4b5563' }}>
                    Completados: {schemaSummary.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="form-actions">
              <Button
                variant="secondary"
                onClick={() => setStep(1)}
                disabled={initializeSchemaMutation.isPending}
              >
                Volver
              </Button>

              <Button
                onClick={handleInitializeSchema}
                disabled={initializeSchemaMutation.isPending}
              >
                {initializeSchemaMutation.isPending
                  ? 'Inicializando esquema...'
                  : 'Ejecutar inicialización SQL'}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="card-panel stack-gap">
            <h3>Paso 3. Usuario MySQL y usuarios del sistema</h3>

            {schemaSummary.length ? (
              <div className="card-panel" style={{ background: '#f8fafc' }}>
                <strong>Scripts ejecutados</strong>
                <p style={{ margin: '8px 0 0' }}>{schemaSummary.join(', ')}</p>
              </div>
            ) : null}

            <div className="detail-grid">
              <div className="stack-gap">
                <h4 style={{ margin: 0 }}>Conexión final de la aplicación</h4>

                <label>
                  <span>Usuario MySQL</span>
                  <Input
                    value={mysqlAppUsername}
                    onChange={(e) => setMysqlAppUsername(e.target.value)}
                  />
                </label>

                <label>
                  <span>Contraseña MySQL</span>
                  <Input
                    type="password"
                    value={mysqlAppPassword}
                    onChange={(e) => setMysqlAppPassword(e.target.value)}
                  />
                </label>
              </div>

              <div className="stack-gap">
                <h4 style={{ margin: 0 }}>Administrador</h4>

                <label>
                  <span>Username</span>
                  <Input
                    value={adminUser.username}
                    onChange={(e) =>
                      setAdminUser((prev) => ({ ...prev, username: e.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Contraseña</span>
                  <Input
                    type="password"
                    value={adminUser.password}
                    onChange={(e) =>
                      setAdminUser((prev) => ({ ...prev, password: e.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Nombre completo</span>
                  <Input
                    value={adminUser.fullName}
                    onChange={(e) =>
                      setAdminUser((prev) => ({ ...prev, fullName: e.target.value }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="card-panel stack-gap" style={{ background: '#f8fafc' }}>
              <h4 style={{ margin: 0 }}>Vendedor</h4>

              <div className="detail-grid">
                <label>
                  <span>Username</span>
                  <Input
                    value={sellerUser.username}
                    onChange={(e) =>
                      setSellerUser((prev) => ({ ...prev, username: e.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Contraseña</span>
                  <Input
                    type="password"
                    value={sellerUser.password}
                    onChange={(e) =>
                      setSellerUser((prev) => ({ ...prev, password: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label>
                <span>Nombre completo</span>
                <Input
                  value={sellerUser.fullName}
                  onChange={(e) =>
                    setSellerUser((prev) => ({ ...prev, fullName: e.target.value }))
                  }
                />
              </label>
            </div>

            <div className="form-actions">
              <Button
                variant="secondary"
                onClick={() => setStep(2)}
                disabled={finalizeMutation.isPending}
              >
                Volver
              </Button>

              <Button
                onClick={handleFinalize}
                disabled={finalizeMutation.isPending}
              >
                {finalizeMutation.isPending
                  ? 'Finalizando configuración...'
                  : 'Finalizar instalación'}
              </Button>
            </div>
          </div>
        ) : null}

        {currentError ? <p className="error-text">{currentError}</p> : null}
      </div>
    </div>
  );
};
