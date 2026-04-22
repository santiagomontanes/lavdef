import { useState } from 'react';
import { api } from '@renderer/services/api';
import type { SessionUser } from '@shared/types';

type Props = {
  onLogin: (user: SessionUser) => void;
};

export const LoginPage = ({ onLogin }: Props) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError('');

      const user = await api.login({
        username: username.trim(),
        password,
        rememberMe
      });

      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth-screen">
      <div className="auth-backdrop" />

      <div className="auth-layout">

        {/* Botón cerrar — esquina superior derecha de toda la pantalla */}
        <button
          type="button"
          onClick={() => api.quitApp()}
          title="Cerrar aplicación"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            background: 'rgba(0,0,0,0.18)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.75)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,50,50,0.75)';
            (e.currentTarget as HTMLButtonElement).style.color = '#fff';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,50,50,0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.18)';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.75)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.15)';
          }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L12 12M12 1L1 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Cerrar app
        </button>

        <div className="auth-brand-panel">
          <div className="auth-brand-badge">LavaSuite</div>

          <h1>
            Controla tu lavandería y sastrería
            <span> con imagen profesional</span>
          </h1>

          <p>
            Gestiona órdenes, entregas, pagos, garantías, caja, reportes y clientes
            desde una sola plataforma.
          </p>

          <div className="auth-feature-list">
            <div className="auth-feature-card">
              <strong>Más orden</strong>
              <span>Procesos claros desde la recepción hasta la entrega.</span>
            </div>

            <div className="auth-feature-card">
              <strong>Más control</strong>
              <span>Caja, gastos y operación en tiempo real.</span>
            </div>

            <div className="auth-feature-card">
              <strong>Más confianza</strong>
              <span>Una imagen moderna para un negocio serio y profesional.</span>
            </div>
          </div>
        </div>

        <div className="auth-form-panel">
          <div className="auth-card">
            <div className="auth-card-header">
              <div className="auth-logo-circle">LS</div>
              <div>
                <h2>Bienvenido</h2>
                <p>Inicia sesión para continuar</p>
              </div>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label>
                <span>Usuario</span>
                <input
                  className="field auth-field"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ingresa tu usuario"
                  autoComplete="username"
                />
              </label>

              <label>
                <span>Contraseña</span>
                <input
                  className="field auth-field"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña"
                  autoComplete="current-password"
                />
              </label>

              <label className="auth-checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Recordar sesión en este equipo</span>
              </label>

              {error ? <p className="error-text auth-error">{error}</p> : null}

              <button
                type="submit"
                className="button button-primary auth-submit"
                disabled={loading || !username.trim() || !password.trim()}
              >
                {loading ? 'Ingresando...' : 'Entrar al sistema'}
              </button>
            </form>

            <div className="auth-footer-note">
              <span>Desarrollado por SISTETECNI</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
