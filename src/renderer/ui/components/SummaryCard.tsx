export const SummaryCard = ({ title, value, accent }: { title: string; value: string; accent: string }) => (
  <article className="summary-card">
    <span className="summary-card-accent" style={{ background: accent }} />
    <small>{title}</small>
    <strong>{value}</strong>
  </article>
);
