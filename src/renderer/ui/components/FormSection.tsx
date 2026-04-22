import type { PropsWithChildren } from 'react';

export const FormSection = ({ title, children }: PropsWithChildren<{ title: string }>) => (
  <section className="form-section">
    <h3>{title}</h3>
    {children}
  </section>
);
