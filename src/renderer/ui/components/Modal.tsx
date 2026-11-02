import { useId, type PropsWithChildren } from 'react';
import { IconClose } from './icons';

export const Modal = ({ open, title, onClose, children }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void }>) => {
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><IconClose /></button>
        </div>
        {children}
      </div>
    </div>
  );
};
