const normalize = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase();

const sets = {
  cancelled: new Set(['CANCELLED', 'CANCELED', 'CANCELADO']),
  delivered: new Set(['DELIVERED', 'ENTREGADO'])
};

export const checkOrderStatus = (statusCode: string | null | undefined, action: string) => {
  const code = normalize(statusCode);

  if (sets.cancelled.has(code)) {
    throw new Error(`No se permite ${action}: la orden está cancelada.`);
  }

  if (sets.delivered.has(code)) {
    throw new Error(`No se permite ${action}: la orden ya fue entregada.`);
  }
};

export const canReceiveDelivery = (statusCode: string | null | undefined) => {
  const code = normalize(statusCode);
  return code === 'READY' || code === 'READY_FOR_DELIVERY';
};
