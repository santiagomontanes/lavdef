export const StatusChip = ({ label, color }: { label: string; color?: string }) => (
  <span className="status-chip" data-color={(color ?? 'slate').toLowerCase()}>
    {label}
  </span>
);