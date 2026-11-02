import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { GlobalSearchResult, PendingReadyCheck, SessionUser } from '@shared/types';
import { IconBell, IconCheck, IconClose, IconLogout, IconSearch, navIcons } from '@renderer/ui/components/icons';

const menu = [
  { to: '/', label: 'Inicio' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/ordenes', label: 'Órdenes' },
  { to: '/entregas', label: 'Inventario' },
  { to: '/facturacion', label: 'Facturación' },
  { to: '/pagos', label: 'Pagos' },
  { to: '/caja', label: 'Caja' },
  { to: '/gastos', label: 'Gastos' },
  { to: '/garantias', label: 'Garantías' },
  { to: '/inventario', label: 'Servicios' },
  { to: '/reportes', label: 'Reportes' },
  { to: '/whatsapp', label: 'WhatsApp' },
  { to: '/configuracion', label: 'Configuración' },
  { to: '/usuarios', label: 'Usuarios' },
  { to: '/auditoria', label: 'Auditoría' }
];

type AppShellProps = {
  user: SessionUser;
  onLogout: () => void;
  pendingReadyChecks: PendingReadyCheck[];
  onConfirmReady: (check: PendingReadyCheck) => Promise<void>;
  onRescheduleReady: (queueId: number) => void;
  onDismissAllNotifications: () => void;
};

export const AppShell = ({
  user,
  onLogout,
  pendingReadyChecks,
  onConfirmReady,
  onRescheduleReady,
  onDismissAllNotifications
}: AppShellProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Título del encabezado según la pantalla actual (solo visual).
  const pageTitle = useMemo(() => {
    const path = location.pathname;
    if (path === '/') return 'Inicio';
    if (path === '/ordenes/nueva') return 'Nueva orden';
    if (path.startsWith('/ordenes/')) return 'Detalle de orden';
    if (path.startsWith('/facturas/')) return 'Factura';
    if (path.startsWith('/arqueo')) return 'Arqueo de caja';
    const match = menu.find((item) => item.to !== '/' && (path === item.to || path.startsWith(`${item.to}/`)));
    return match?.label ?? '';
  }, [location.pathname]);

  const [now, setNow] = useState(() => new Date());
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState('');
  const [actingId, setActingId] = useState<number | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const isAdmin = Number(user.roleId) === 1;
  const visibleMenu = useMemo(() => {
    if (isAdmin) return menu;
    const adminOnly = new Set(['/', '/inventario', '/reportes', '/configuracion', '/auditoria', '/usuarios']);
    return menu.filter((item) => !adminOnly.has(item.to));
  }, [isAdmin]);

  const { data: company } = useQuery({
    queryKey: ['company-settings'],
    queryFn: api.companySettings
  });

  // Info de versión y diagnóstico. Visible en el sidebar para que el
  // cliente pueda confirmar cuál EXE está corriendo sin abrir DevTools.
  const { data: versionInfo } = useQuery({
    queryKey: ['app-version-info'],
    queryFn: api.getVersionInfo,
    staleTime: 60 * 1000
  });

  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchText.trim());
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const { data: globalSearch, isFetching: searchingGlobal } = useQuery<GlobalSearchResult>({
    queryKey: ['global-search', debouncedSearch],
    queryFn: async () => {
      const term = debouncedSearch.trim();
      if (!term) return { clients: [], orders: [], invoices: [] };
      const [clients, orders, invoices] = await Promise.all([
        api.searchClientsByName(term, 6),
        api.searchOrders(term, 6),
        api.searchInvoices(term, 6)
      ]);
      return { clients, orders, invoices };
    },
    enabled: debouncedSearch.length >= 2
  });

  const hasSearchResults = useMemo(() => {
    return Boolean(
      globalSearch &&
        (globalSearch.clients.length > 0 || globalSearch.orders.length > 0 || globalSearch.invoices.length > 0)
    );
  }, [globalSearch]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Open drawer automatically when new notifications arrive
  useEffect(() => {
    if (pendingReadyChecks.length > 0) setNotifOpen(true);
  }, [pendingReadyChecks.length]);

  // Close drawer on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const filteredChecks = useMemo(() => {
    const term = notifFilter.trim().toLowerCase();
    if (!term) return pendingReadyChecks;
    return pendingReadyChecks.filter(
      (c) =>
        c.orderNumber.toLowerCase().includes(term) ||
        c.clientName.toLowerCase().includes(term)
    );
  }, [pendingReadyChecks, notifFilter]);

  const badgeCount = pendingReadyChecks.length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-panel">
          {company?.logoBase64 ? (
            <img src={company.logoBase64} alt={company.companyName || 'Logo'} className="brand-logo" />
          ) : (
            <div className="brand-logo brand-logo-fallback">
              {(company?.companyName || 'LS').slice(0, 2).toUpperCase()}
            </div>
          )}
          <strong>{company?.companyName || 'LavaSuite'}</strong>
          {company?.legalName ? <span>{company.legalName}</span> : null}
        </div>

        <nav className="sidebar-nav">
          {visibleMenu.map((item) => {
            const Icon = navIcons[item.to];
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
                {Icon ? <Icon className="nav-icon" /> : null}
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <strong>{user.displayName}</strong>
          <span>{user.roleName}</span>
          <button
            className="button button-secondary"
            type="button"
            onClick={async () => {
              try { await api.logout(); } catch { } finally { onLogout(); }
            }}
          >
            <IconLogout width={18} height={18} />
            Cerrar sesión
          </button>
          <button
            type="button"
            className="sidebar-version"
            onClick={() => setDiagnosticsOpen(true)}
            title="Ver versión y diagnóstico de la app"
          >
            {versionInfo ? (
              <>
                <strong>v{versionInfo.version}</strong>
                <div>
                  {versionInfo.isPackaged ? 'Build instalado' : 'Modo desarrollo'} · Ver diagnóstico
                </div>
              </>
            ) : (
              <div>Versión: cargando…</div>
            )}
          </button>
        </div>
      </aside>

      {diagnosticsOpen && versionInfo ? (
        <div className="no-print modal-backdrop diag-backdrop" onClick={() => setDiagnosticsOpen(false)}>
          <div className="modal-card diag-card" role="dialog" aria-modal="true" aria-labelledby="diag-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 id="diag-title">Diagnóstico de la app</h3>
                <p className="diag-subtitle">
                  Información útil para soporte. Comparta una captura si reporta un problema.
                </p>
              </div>
              <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setDiagnosticsOpen(false)}>
                <IconClose />
              </button>
            </div>

            <dl className="diag-list">
              <dt>Versión</dt>
              <dd><strong>v{versionInfo.version}</strong></dd>

              <dt>Modo</dt>
              <dd>{versionInfo.isPackaged ? 'EXE instalado' : 'Desarrollo'}</dd>

              <dt>Observaciones en factura</dt>
              <dd className={versionInfo.snapshotHasObservations ? 'diag-ok' : 'diag-bad'}>
                {versionInfo.snapshotHasObservations
                  ? 'OK – columnas presentes'
                  : 'FALTAN – snapshot no tiene customer/internal_observations'}
              </dd>

              <dt>Migraciones aplicadas</dt>
              <dd>{versionInfo.appliedMigrations.length}</dd>

              <dt>Última migración</dt>
              <dd className="diag-mono">
                {versionInfo.appliedMigrations[versionInfo.appliedMigrations.length - 1] ?? '—'}
              </dd>

              <dt>Log del día</dt>
              <dd className="diag-mono diag-small">
                {versionInfo.logPath ?? 'No disponible'}
              </dd>

              <dt>Carpeta de logs</dt>
              <dd className="diag-mono diag-small">
                {versionInfo.logDir ?? 'No disponible'}
              </dd>
            </dl>

            <details className="diag-details">
              <summary>Ver lista completa de migraciones aplicadas</summary>
              <pre>
                {versionInfo.appliedMigrations.length > 0
                  ? versionInfo.appliedMigrations.join('\n')
                  : 'Aún no se han registrado migraciones.'}
              </pre>
            </details>
          </div>
        </div>
      ) : null}

      <div className="content-shell">
        <header className="topbar">
          <div>
            <h1>{pageTitle}</h1>
          </div>

          <div className="topbar-tools">
            <div className="topbar-search">
              <IconSearch className="topbar-search-icon" />
              <input
                aria-label="Buscar cliente, orden o factura"
                className="field compact-field"
                placeholder="Buscar cliente, orden o factura"
                value={searchText}
                onChange={(e) => { setSearchText(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => { window.setTimeout(() => setSearchOpen(false), 130); }}
              />

              {searchOpen && debouncedSearch.length >= 2 ? (
                <div className="topbar-search-results card-panel">
                  {searchingGlobal ? <p className="topbar-search-empty">Buscando...</p> : null}
                  {!searchingGlobal && !hasSearchResults ? <p className="topbar-search-empty">Sin resultados.</p> : null}

                  {globalSearch?.clients?.length ? (
                    <div className="topbar-search-group">
                      <strong>Clientes</strong>
                      {globalSearch.clients.map((client) => (
                        <button key={`c-${client.id}`} type="button" className="topbar-search-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setSearchOpen(false); setSearchText(''); navigate('/clientes'); }}>
                          <span>{client.firstName} {client.lastName}</span>
                          <small>{client.phone}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {globalSearch?.orders?.length ? (
                    <div className="topbar-search-group">
                      <strong>Órdenes</strong>
                      {globalSearch.orders.map((order) => (
                        <button key={`o-${order.id}`} type="button" className="topbar-search-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setSearchOpen(false); setSearchText(''); navigate(`/ordenes/${order.id}`); }}>
                          <span>{order.orderNumber} · {order.clientName}</span>
                          <small>{order.statusName} · Saldo {order.balanceDue.toLocaleString('es-CO')}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {globalSearch?.invoices?.length ? (
                    <div className="topbar-search-group">
                      <strong>Facturas</strong>
                      {globalSearch.invoices.map((invoice) => (
                        <button key={`i-${invoice.id}`} type="button" className="topbar-search-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setSearchOpen(false); setSearchText(''); navigate(`/facturas/${invoice.orderId}`); }}>
                          <span>{invoice.invoiceNumber} · {invoice.clientName}</span>
                          <small>Orden #{invoice.orderId} · Saldo {invoice.balanceDue.toLocaleString('es-CO')}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* CAMPANITA DE NOTIFICACIONES */}
            <button
              type="button"
              className={`topbar-bell${badgeCount > 0 ? ' has-items' : ''}`}
              onClick={() => setNotifOpen((v) => !v)}
              title={badgeCount > 0 ? `${badgeCount} notificación${badgeCount !== 1 ? 'es' : ''} pendiente${badgeCount !== 1 ? 's' : ''}` : 'Sin notificaciones'}
              aria-label={badgeCount > 0 ? `${badgeCount} notificación${badgeCount !== 1 ? 'es' : ''} pendiente${badgeCount !== 1 ? 's' : ''}` : 'Sin notificaciones'}
            >
              <IconBell key={badgeCount} />
              {badgeCount > 0 && (
                <span className="topbar-bell-badge">
                  {badgeCount > 99 ? '+99' : badgeCount}
                </span>
              )}
            </button>

            <div className="topbar-user">
              <strong>{now.toLocaleDateString('es-CO')}</strong>
              <span className="topbar-clock">
                {now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </span>
              <small>{user.displayName}</small>
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      {/* CAJÓN DE NOTIFICACIONES */}
      {notifOpen && (
        <div ref={drawerRef} className="no-print notif-drawer" role="dialog" aria-label="Notificaciones">
          {/* Header del cajón */}
          <div className="notif-header">
            <div>
              <h3>Notificaciones</h3>
              {badgeCount > 0 && (
                <p>
                  {badgeCount} orden{badgeCount !== 1 ? 'es' : ''} esperando verificación · se procesan solos en 5 min
                </p>
              )}
            </div>
            <button type="button" className="icon-button" aria-label="Cerrar notificaciones" onClick={() => setNotifOpen(false)}>
              <IconClose />
            </button>
          </div>

          {/* Buscador */}
          <div className="notif-search">
            <input
              className="field"
              placeholder="Buscar por N° de orden o cliente..."
              aria-label="Buscar por N° de orden o cliente"
              value={notifFilter}
              onChange={(e) => setNotifFilter(e.target.value)}
            />
          </div>

          {/* Lista de notificaciones */}
          <div className="notif-list">
            {filteredChecks.length === 0 ? (
              <div className="notif-empty">
                <IconBell className="notif-empty-icon" />
                <p>
                  {pendingReadyChecks.length === 0 ? 'Sin notificaciones pendientes' : 'Sin resultados para ese filtro'}
                </p>
              </div>
            ) : (
              filteredChecks.map((check) => {
                const isDueTomorrow = check.type === 'DUE_TOMORROW';
                const itemKey = isDueTomorrow ? `dt-${check.orderId}` : `rq-${check.queueId}`;
                return (
                <div key={itemKey} className={`notif-item ${isDueTomorrow ? 'is-due' : 'is-ready-check'}`}>
                  <div>
                    <div className="notif-item-title">
                      <p>
                        {check.orderNumber} — {check.clientName}
                      </p>
                      {isDueTomorrow && (
                        <span className="notif-tag">Vence mañana</span>
                      )}
                    </div>
                    {check.dueDate && (
                      <p className="notif-item-meta">
                        Fecha promesa:{' '}
                        {new Date(check.dueDate + 'T12:00:00').toLocaleDateString('es-CO', {
                          weekday: 'short', day: 'numeric', month: 'short'
                        })}
                      </p>
                    )}
                  </div>
                  <div className="notif-item-actions">
                    <button
                      className="button button-primary"
                      disabled={actingId === check.orderId}
                      onClick={async () => {
                        setActingId(check.orderId);
                        try {
                          await onConfirmReady(check);
                        } finally {
                          setActingId(null);
                        }
                      }}
                    >
                      {actingId === check.orderId ? 'Procesando...' : (<><IconCheck width={18} height={18} /> Sí, está lista</>)}
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={actingId === check.orderId}
                      onClick={() => {
                        setNotifOpen(false);
                        if (isDueTomorrow) {
                          navigate(`/ordenes/${check.orderId}`);
                        } else {
                          onRescheduleReady(check.queueId);
                        }
                      }}
                    >
                      {isDueTomorrow ? 'Ver orden' : 'Editar fecha'}
                    </button>
                  </div>
                </div>
                );
              })
            )}
          </div>

          {/* Footer del cajón */}
          {pendingReadyChecks.length > 0 && (
            <div className="notif-footer">
              <button
                className="button button-secondary"
                onClick={() => {
                  onDismissAllNotifications();
                  setNotifOpen(false);
                }}
              >
                Descartar todas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
