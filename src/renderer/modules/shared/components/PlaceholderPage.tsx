import { PageHeader } from '@renderer/ui/components';

export const PlaceholderPage = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <section className="stack-gap">
    <PageHeader title={title} subtitle={subtitle} />
    <div className="card-panel">Módulo preparado para siguientes fases.</div>
  </section>
);
