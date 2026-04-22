import { useState } from 'react';

export const useModal = <T,>(initialValue: T | null = null) => {
  const [payload, setPayload] = useState<T | null>(initialValue);
  return {
    isOpen: payload !== null,
    payload,
    open: (value: T) => setPayload(value),
    close: () => setPayload(null)
  };
};
