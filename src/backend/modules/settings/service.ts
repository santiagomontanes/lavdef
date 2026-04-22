import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { CompanySettings } from '../../../shared/types.js';

export const createSettingsService = (db: Kysely<Database>) => ({
  async getCompanySettings(): Promise<CompanySettings | null> {
    const row = await db
      .selectFrom('company_settings')
      .selectAll()
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      companyName: row.company_name,
      legalName: row.legal_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      nit: row.nit ?? null,
      logoBase64: row.logo_base64 ?? null,
      currencyCode: row.currency_code,
      invoicePolicies: row.invoice_policies ?? null
    };
  },

  async updateCompanySettings(input: {
    companyName: string;
    legalName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    nit?: string | null;
    logoBase64?: string | null;
    invoicePolicies?: string | null;
  }): Promise<CompanySettings | null> {
    await db
      .updateTable('company_settings')
      .set({
        company_name: input.companyName,
        legal_name: input.legalName ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        nit: input.nit ?? null,
        logo_base64: input.logoBase64 ?? null,
        invoice_policies: input.invoicePolicies ?? null
      })
      .where('id', '=', 1)
      .execute();

    const row = await db
      .selectFrom('company_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      companyName: row.company_name,
      legalName: row.legal_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      nit: row.nit ?? null,
      logoBase64: row.logo_base64 ?? null,
      currencyCode: row.currency_code,
      invoicePolicies: row.invoice_policies ?? null
    };
  },

  async getOrderProtectionPassword(): Promise<string | null> {
    const setting = await db
      .selectFrom('app_settings')
      .select(['setting_value'])
      .where('setting_key', '=', 'order_protection_password')
      .orderBy('id desc')
      .executeTakeFirst();

    return setting ? String(setting.setting_value ?? '').trim() : null;
  },

  async updateOrderProtectionPassword(input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: true }> {
    const currentPassword = String(input.currentPassword ?? '').trim();
    const newPassword = String(input.newPassword ?? '').trim();
    const confirmPassword = String(input.confirmPassword ?? '').trim();

    if (!currentPassword) {
      throw new Error('Debes ingresar la contraseña actual.');
    }

    if (!newPassword || newPassword.length < 4) {
      throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
    }

    if (newPassword !== confirmPassword) {
      throw new Error('La confirmación de la nueva contraseña no coincide.');
    }

    const existing = await db
      .selectFrom('app_settings')
      .select(['id', 'setting_value'])
      .where('setting_key', '=', 'order_protection_password')
      .orderBy('id desc')
      .executeTakeFirst();

    if (!existing) {
      await db
        .insertInto('app_settings')
        .values({
          setting_key: 'order_protection_password',
          setting_value: String(newPassword)
        })
        .execute();

      return { success: true };
    }

    if (String(existing.setting_value ?? '').trim() !== currentPassword) {
      throw new Error('La contraseña actual es incorrecta.');
    }

    if (currentPassword === newPassword) {
      throw new Error('La nueva contraseña no puede ser igual a la actual.');
    }

    await db
      .updateTable('app_settings')
      .set({
        setting_value: String(newPassword)
      })
      .where('id', '=', existing.id)
      .execute();

    return { success: true };
  },

  async getPdfOutputDir(): Promise<string | null> {
    const setting = await db
      .selectFrom('app_settings')
      .select(['setting_value'])
      .where('setting_key', '=', 'pdf_output_dir')
      .orderBy('id desc')
      .executeTakeFirst();

    return setting ? String(setting.setting_value ?? '').trim() || null : null;
  },

  async updatePdfOutputDir(value: string | null): Promise<{ success: true; value: string | null }> {
    const normalized = String(value ?? '').trim() || null;
    const existing = await db
      .selectFrom('app_settings')
      .select(['id'])
      .where('setting_key', '=', 'pdf_output_dir')
      .orderBy('id desc')
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable('app_settings')
        .set({ setting_value: normalized ?? '' })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db
        .insertInto('app_settings')
        .values({
          setting_key: 'pdf_output_dir',
          setting_value: normalized ?? ''
        })
        .execute();
    }

    return { success: true, value: normalized };
  }
});
