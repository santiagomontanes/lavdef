import { machineIdSync } from 'node-machine-id';
import crypto from 'crypto';

export const getDeviceFingerprint = (): string => {
  const id = machineIdSync(true); // true = hashed
  return crypto.createHash('sha256').update(id).digest('hex').substring(0, 32);
};