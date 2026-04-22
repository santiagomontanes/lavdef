import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return <input ref={ref} {...props} className={`field ${className ?? ''}`.trim()} />;
  }
);

Input.displayName = 'Input';