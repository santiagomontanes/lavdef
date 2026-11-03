import { Button } from '@renderer/ui/components';
import { api } from '@renderer/services/api';

type Props = {
  daysLeft: number;
  businessName?: string | null;
  offline?: boolean;
};

export const LicenseRenewalBanner = ({ daysLeft, businessName, offline }: Props) => {
  const whatsappUrl = `https://wa.me/573043547758?text=${encodeURIComponent(
    `Hola, quiero renovar el plan de ${businessName || 'mi sistema'}. Faltan ${daysLeft} día(s) para el vencimiento de la licencia.`
  )}`;

  return (
    <div className="no-print license-banner" role="status">
      <div className="license-banner-inner">
        <div className="license-banner-text">
          <strong>
            Tu licencia vence en {daysLeft} día{daysLeft === 1 ? '' : 's'}
          </strong>
          <span>
            {offline
              ? 'El equipo lleva días sin conexión. Conéctalo a internet para ponerte al día; al vencer, el sistema se bloqueará.'
              : 'Para evitar interrupciones, te recomendamos renovar el plan con anticipación.'}
          </span>
        </div>

        <div className="inline-actions">
          <Button
            onClick={async () => {
              await api.openExternal(whatsappUrl);
            }}
          >
            Renovar por WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
};