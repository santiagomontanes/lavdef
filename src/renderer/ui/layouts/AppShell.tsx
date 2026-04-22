import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@renderer/services/api';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { GlobalSearchResult, PendingReadyCheck, SessionUser } from '@shared/types';

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
          {visibleMenu.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
              {item.label}
            </NavLink>
          ))}
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
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div>
            <h1>Inicio</h1>
          </div>

          <div className="topbar-tools">
            <div className="topbar-search">
              <input
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
              onClick={() => setNotifOpen((v) => !v)}
              style={{
                position: 'relative',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 6,
                fontSize: 20,
                lineHeight: 1,
                color: badgeCount > 0 ? 'var(--color-primary, #5a7cff)' : 'var(--color-muted, #888)',
                animation: badgeCount > 0 ? 'bell-ring 1.2s ease infinite' : 'none'
              }}
              title={badgeCount > 0 ? `${badgeCount} notificación${badgeCount !== 1 ? 'es' : ''} pendiente${badgeCount !== 1 ? 's' : ''}` : 'Sin notificaciones'}
            >
              🔔
              {badgeCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  background: '#ef4444',
                  color: '#fff',
                  borderRadius: '50%',
                  fontSize: 10,
                  fontWeight: 700,
                  minWidth: 16,
                  height: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  padding: '0 3px'
                }}>
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
        <div
          ref={drawerRef}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: 380,
            height: '100vh',
            background: 'var(--color-surface, #fff)',
            borderLeft: '1px solid var(--color-border, #e2e8f0)',
            boxShadow: '-8px 0 32px rgba(0,0,0,0.14)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Header del cajón */}
          <div style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--color-border, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--color-surface, #fff)'
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>Notificaciones</h3>
              {badgeCount > 0 && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-muted, #666)' }}>
                  {badgeCount} orden{badgeCount !== 1 ? 'es' : ''} esperando verificación · se procesan solos en 5 min
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNotifOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-muted, #888)', padding: 4 }}
            >
              ×
            </button>
          </div>

          {/* Buscador */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
            <input
              className="field"
              placeholder="Buscar por N° de orden o cliente..."
              value={notifFilter}
              onChange={(e) => setNotifFilter(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Lista de notificaciones */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredChecks.length === 0 ? (
              <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--color-muted, #888)' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🔔</div>
                <p style={{ margin: 0, fontSize: 13 }}>
                  {pendingReadyChecks.length === 0 ? 'Sin notificaciones pendientes' : 'Sin resultados para ese filtro'}
                </p>
              </div>
            ) : (
              filteredChecks.map((check) => {
                const isDueTomorrow = check.type === 'DUE_TOMORROW';
                const itemKey = isDueTomorrow ? `dt-${check.orderId}` : `rq-${check.queueId}`;
                return (
                <div
                  key={itemKey}
                  style={{
                    padding: '12px 14px',
                    background: isDueTomorrow ? '#eff6ff' : 'var(--color-warning-bg, #fffbeb)',
                    border: `1px solid ${isDueTomorrow ? '#93c5fd' : 'var(--color-warning-border, #fcd34d)'}`,
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                        {check.orderNumber} — {check.clientName}
                      </p>
                      {isDueTomorrow && (
                        <span style={{ fontSize: 10, background: '#3b82f6', color: '#fff', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                          Vence mañana
                        </span>
                      )}
                    </div>
                    {check.dueDate && (
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-muted, #666)' }}>
                        Fecha promesa:{' '}
                        {new Date(check.dueDate + 'T12:00:00').toLocaleDateString('es-CO', {
                          weekday: 'short', day: 'numeric', month: 'short'
                        })}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="button button-primary"
                      style={{ fontSize: 12, padding: '5px 10px', flex: 1 }}
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
                      {actingId === check.orderId ? 'Procesando...' : 'Sí, está lista ✓'}
                    </button>
                    <button
                      className="button button-secondary"
                      style={{ fontSize: 12, padding: '5px 10px' }}
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
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--color-border, #e2e8f0)',
              display: 'flex',
              justifyContent: 'flex-end'
            }}>
              <button
                className="button button-secondary"
                style={{ fontSize: 12 }}
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

      <style>{`
        @keyframes bell-ring {
          0%, 100% { transform: rotate(0deg); }
          10%, 30% { transform: rotate(-12deg); }
          20%, 40% { transform: rotate(12deg); }
          50% { transform: rotate(0deg); }
        }
      `}</style>
    </div>
  );
};
