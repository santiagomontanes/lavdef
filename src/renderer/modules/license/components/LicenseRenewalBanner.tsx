import { Button } from '@renderer/ui/components';
import { api } from '@renderer/services/api';

type Props = {
  daysLeft: number;
  businessName?: string | null;
};

export const LicenseRenewalBanner = ({ daysLeft, businessName }: Props) => {
  const whatsappUrl = `https://wa.me/573043547758?text=${encodeURIComponent(
    `Hola, quiero renovar el plan de ${businessName || 'mi sistema'}. Faltan ${daysLeft} día(s) para el vencimiento de la licencia.`
  )}`;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        width: '100%',
        background: 'linear-gradient(90deg, #fff4d6 0%, #ffe8b3 100%)',
        borderBottom: '1px solid #f2cf6d',
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong style={{ fontSize: 15, color: '#6b4f00' }}>
            Tu licencia vence en {daysLeft} día{daysLeft === 1 ? '' : 's'}
          </strong>
          <span style={{ fontSize: 13, color: '#7a5b00' }}>
            Para evitar interrupciones, te recomendamos renovar el plan con anticipación.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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