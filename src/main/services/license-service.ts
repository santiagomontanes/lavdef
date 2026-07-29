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

const SUPABASE_URL = 'https://awutehzbhhklcgodmluq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3dXRlaHpiaGhrbGNnb2RtbHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjU1NDcsImV4cCI6MjA4ODMwMTU0N30.Rtzda_lwrYxSjLSRORZ8ow2k4y7lZC5XjUMnN3qOIqs';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 5;
const FALLBACK_GRACE_HOURS = 72;

/** El servidor rechazó la licencia (vencida, revocada, otra máquina): no aplica gracia offline. */
class LicenseRejectedError extends Error {}

const getMachineId = () => {
  const raw = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

/**
 * Reloj que nunca retrocede: guarda la marca de tiempo más alta vista.
 * Atrasar la fecha del equipo no alarga la licencia.
 */
const effectiveNow = (): number => {
  const anchor = Number(store.get('clockAnchor') ?? 0);
  const value = Math.max(Date.now(), anchor);
  if (value > anchor) store.set('clockAnchor', value);
  return value;
};

/** Vencimiento al final del día indicado: la licencia sirve durante toda esa fecha. */
const expiryTime = (expiresAt?: string | null): number | null => {
  const day = String(expiresAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = new Date(`${day}T23:59:59`).getTime();
  return Number.isNaN(time) ? null : time;
};

const daysUntil = (expiry: number, now: number) =>
  Math.max(0, Math.ceil((expiry - now) / DAY_MS));

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
      throw new LicenseRejectedError(data?.message || 'Licencia inválida.');
    }

    // Hubo contacto con el servidor: se reancla el reloj por si la fecha del equipo estuvo adelantada.
    store.set('clockAnchor', Date.now());

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
      // Si el servidor respondió y rechazó la licencia, no hay gracia offline.
      if (error instanceof LicenseRejectedError) {
        return {
          valid: false,
          requiresActivation: true,
          message: error.message
        };
      }

      const now = effectiveNow();
      const expiry = expiryTime(cached.expiresAt);

      // Sin fecha de vencimiento en caché no hay a qué anclarse: ventana corta como antes.
      if (expiry === null) {
        const lastValidated = cached.lastValidatedAt
          ? new Date(cached.lastValidatedAt).getTime()
          : null;

        const hoursSinceLastValidation = lastValidated
          ? (now - lastValidated) / (1000 * 60 * 60)
          : Number.POSITIVE_INFINITY;

        if (hoursSinceLastValidation <= FALLBACK_GRACE_HOURS) {
          return {
            valid: true,
            offlineGrace: true,
            requiresActivation: false,
            warning: Number(cached.daysLeft ?? 0) <= WARNING_DAYS,
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
          message: 'No se pudo validar la licencia. Conéctate a internet.'
        };
      }

      // Sin conexión: la licencia sigue viva hasta su fecha de vencimiento.
      if (now <= expiry) {
        const daysLeft = daysUntil(expiry, now);
        const warning = daysLeft <= WARNING_DAYS;

        return {
          valid: true,
          offlineGrace: true,
          requiresActivation: false,
          warning,
          daysLeft,
          expiresAt: cached.expiresAt,
          message: warning
            ? `Sin conexión. Tu licencia vence en ${daysLeft} día(s): conéctate a internet para ponerte al día.`
            : 'Trabajando sin conexión. Tu licencia sigue vigente.',
          businessName: cached.businessName ?? null,
          phone: cached.phone ?? null
        };
      }

      return {
        valid: false,
        requiresActivation: true,
        expiresAt: cached.expiresAt,
        message: 'Tu licencia venció. Conéctate a internet y renueva para seguir usando el sistema.'
      };
    }
  }
}

export const licenseService = new LicenseService();