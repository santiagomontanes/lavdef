import type { PropsWithChildren } from 'react';

export const Modal = ({ open, title, onClose, children }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void }>) => {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
};
