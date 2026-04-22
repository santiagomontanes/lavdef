import type { InputHTMLAttributes } from 'react';

const formatPrice = (v: number | undefined | null): string => {
  const n = Number(v);
  if (!n || !Number.isFinite(n)) return '';
  return Math.trunc(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value?: number | null;
  onChange?: (v: number) => void;
};

export const PriceInput = ({ value, onChange, className, ...props }: Props) => (
  <input
    {...props}
    type="text"
    inputMode="numeric"
    className={`field${className ? ` ${className}` : ''}`}
    value={formatPrice(value)}
    onChange={(e) => {
      const digits = e.target.value.replace(/[^\d]/g, '');
      onChange?.(digits ? parseInt(digits, 10) : 0);
    }}
  />
);
