import os from 'node:os';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ElectronStore = require('electron-store').default;

type LicenseCache = {
  licenseKey: string;
  expiresAt: string;
  daysLeft: number;
  lastValidatedAt: string;
  planType: 'monthly' | 'yearly';
  businessName?: string | null;
  phone?: string | null;
};

const store = new ElectronStore({
  name: 'license-store'
}) as any;

const SUPABASE_URL = 'https://wswuifmfauepefrtaonf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aun5sv8y2isZI_ISPRfeDg_3rBQP6Rp';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const getMachineId = () => {
  const raw = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

class LicenseService {
  getCached(): LicenseCache | null {
    return (store.get('license') as LicenseCache | undefined) ?? null;
  }

  saveCached(data: LicenseCache) {
    store.set('license', data);
  }

  clearCached() {
    store.delete('license');
  }

  async activate(licenseKey: string, appVersion: string) {
    const machineId = getMachineId();

    const { data, error } = await supabase.functions.invoke('validate-license', {
      body: { licenseKey, machineId, appVersion }
    });

    if (error) {
      throw new Error(error.message || 'No se pudo validar la licencia.');
    }

    if (!data?.valid) {
      throw new Error(data?.message || 'Licencia inválida.');
    }

    this.saveCached({
      licenseKey,
      expiresAt: data.expiresAt,
      daysLeft: data.daysLeft,
      lastValidatedAt: new Date().toISOString(),
      planType: data.planType,
      businessName: data.businessName ?? null,
      phone: data.phone ?? null
    });

    return data;
  }

  async status(appVersion: string) {
    const cached = this.getCached();

    if (!cached?.licenseKey) {
      return {
        valid: false,
        requiresActivation: true,
        message: 'Debes activar la licencia.'
      };
    }

    try {
      const fresh = await this.activate(cached.licenseKey, appVersion);

      return {
        valid: true,
        requiresActivation: false,
        warning: Boolean(fresh.warning),
        daysLeft: Number(fresh.daysLeft ?? 0),
        expiresAt: fresh.expiresAt,
        message: fresh.message,
        businessName: fresh.businessName ?? null,
        phone: fresh.phone ?? null
      };
    } catch (error) {
      const lastValidated = cached.lastValidatedAt
        ? new Date(cached.lastValidatedAt)
        : null;

      const hoursSinceLastValidation = lastValidated
        ? (Date.now() - lastValidated.getTime()) / (1000 * 60 * 60)
        : Number.POSITIVE_INFINITY;

      if (hoursSinceLastValidation <= 72) {
        return {
          valid: true,
          offlineGrace: true,
          requiresActivation: false,
          warning: Number(cached.daysLeft ?? 0) <= 5,
          daysLeft: Number(cached.daysLeft ?? 0),
          expiresAt: cached.expiresAt,
          message: 'Modo sin conexión temporal.',
          businessName: cached.businessName ?? null,
          phone: cached.phone ?? null
        };
      }

      return {
        valid: false,
        requiresActivation: true,
        message: error instanceof Error ? error.message : 'Licencia inválida.'
      };
    }
  }
}

export const licenseService = new LicenseService();