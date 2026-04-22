import { useState } from 'react';
import { api } from '@renderer/services/api';

type Props = {
  onActivated: () => void;
};

export const LicensePage = ({ onActivated }: Props) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const whatsappUrl = `https://wa.me/573043547758?text=${encodeURIComponent(
    'Hola, quiero activar mi sistema LavaSuite 🚀'
  )}`;

  const handleActivate = async () => {
    try {
      setLoading(true);
      setError('');

      await api.activateLicense(licenseKey);
      onActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo activar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="license-screen">
      <div className="license-container">
        {/* PANEL IZQUIERDO (VENTA) */}
        <div className="license-left">
          <div className="badge">Sistema Profesional</div>

          <h1>
            Lleva tu negocio al siguiente nivel 🚀
          </h1>

          <p>
            Activa LavaSuite y controla tu lavandería o sastrería con una herramienta
            diseñada para crecer contigo.
          </p>

          <div className="benefits">
            <div>✔ Control total de órdenes y entregas</div>
            <div>✔ Facturación y caja organizada</div>
            <div>✔ Clientes fidelizados</div>
            <div>✔ Imagen profesional ante tus clientes</div>
          </div>

          <div className="urgency">
            ⚠️ No activar el sistema puede generar desorden, pérdidas y mala imagen.
          </div>

          <div className="social-proof">
            Más negocios ya están usando LavaSuite para crecer 🚀
          </div>
        </div>

        {/* PANEL DERECHO (FORMULARIO) */}
        <div className="license-card">
          <h2>Activar licencia</h2>
          <p>Ingresa tu clave para desbloquear el sistema</p>

          <input
            className="field"
            placeholder="Ej: LS-XXXX-XXXX"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
          />

          {error && <p className="error-text">{error}</p>}

          <button
            className="button button-primary"
            onClick={handleActivate}
            disabled={!licenseKey || loading}
          >
            {loading ? 'Activando...' : 'Activar sistema'}
          </button>

          <div className="divider">o</div>

          <button
            className="button button-secondary"
            onClick={() => api.openExternal(whatsappUrl)}
          >
            Comprar licencia por WhatsApp
          </button>

          <small className="note">
            ✔ Activación inmediata • ✔ Soporte incluido • ✔ Sin complicaciones
          </small>
        </div>
      </div>
    </section>
  );
};