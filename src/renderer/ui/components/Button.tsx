import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

export const Button = ({ children, className = '', variant = 'primary', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }>) => (
  <button {...props} className={`button button-${variant} ${className}`.trim()}>{children}</button>
);
