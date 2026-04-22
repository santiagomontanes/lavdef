import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Expense, ExpenseInput } from '../../../shared/types.js';
import {
  getCurrentSessionUserId,
  getCurrentSessionUserName
} from '../../../main/services/session-context.js';

const expenseSchema = z.object({
  categoryId: z.number().positive(),
  paymentMethodId: z.number().positive(),
  amount: z.number().positive(),
  description: z.string().trim().min(3),
  expenseDate: z.string().min(1)
});




const mapExpense = (row: any): Expense => ({
  id: row.id,
  cashSessionId: row.cash_session_id ?? null,
  categoryId: row.category_id,
  categoryName: row.category_name,
  paymentMethodId: row.payment_method_id ?? null,
  paymentMethodName: row.payment_method_name ?? null,
  amount: Number(row.amount),
  description: row.description,
  expenseDate:
    row.expense_date instanceof Date
      ? `${row.expense_date.getFullYear()}-${String(row.expense_date.getMonth() + 1).padStart(2, '0')}-${String(row.expense_date.getDate()).padStart(2, '0')}`
      : String(row.expense_date).slice(0, 10),
  createdBy: row.created_by ?? null,
  createdAt: new Date(row.created_at).toISOString()
});

export const createExpensesService = (db: Kysely<Database>) => {
  
  const listCategories = async () => {
  const rows = await db
    .selectFrom('expense_categories')
    .selectAll()
    .where('is_active', '=', 1)
    .orderBy('name')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    name: r.name
  }));
};  
  const list = async () => {
  const rows = await db
    .selectFrom('expenses as e')
    .innerJoin('expense_categories as c', 'c.id', 'e.category_id')
    .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
    .select([
      'e.id',
      'e.cash_session_id',
      'e.category_id',
      'e.payment_method_id',
      'e.amount',
      'e.description',
      'e.expense_date',
      'e.created_by',
      'e.created_at',
      sql<string>`c.name`.as('category_name'),
      sql<string | null>`pm.name`.as('payment_method_name')
    ])
    .orderBy('e.id desc')
    .execute();

  return rows.map(mapExpense);
};

  const create = async (input: ExpenseInput): Promise<Expense> => {
    const parsed = expenseSchema.parse(input);
    const actorId = getCurrentSessionUserId() ?? 1;
    const actorName = getCurrentSessionUserName();

    const activeCashSession = await db
      .selectFrom('cash_sessions')
      .select(['id', 'opened_at', 'opening_amount'])
      .where('status', '=', 'open')
      .orderBy('id desc')
      .executeTakeFirst();

    if (!activeCashSession) {
      throw new Error('Debes abrir caja para registrar gastos y descontarlos del sistema.');
    }

    const inserted = await db.transaction().execute(async (trx) => {
      const paymentMethod = await trx
        .selectFrom('payment_methods')
        .select(['id', 'name'])
        .where('id', '=', parsed.paymentMethodId)
        .executeTakeFirst();

      if (!paymentMethod) {
        throw new Error('Método de pago no encontrado para el gasto.');
      }

      if (activeCashSession) {
        const sessionStart = activeCashSession.opened_at;
        const methodName = String(paymentMethod.name ?? '').trim().toLowerCase();

        const incomeByMethodRow = await trx
          .selectFrom('payments')
          .select((eb) => eb.fn.sum<number>('amount').as('sum'))
          .where('payment_method_id', '=', parsed.paymentMethodId)
          .where('created_at', '>=', sessionStart)
          .executeTakeFirst();

        const spentByMethodRow = await trx
          .selectFrom('expenses')
          .select((eb) => eb.fn.sum<number>('amount').as('sum'))
          .where('cash_session_id', '=', activeCashSession.id)
          .where('payment_method_id', '=', parsed.paymentMethodId)
          .executeTakeFirst();

        // PAYMENT_OUT does not store method_id, so use note text fallback.
        const refundedByMethodRow = await trx
          .selectFrom('cash_movements')
          .select((eb) => eb.fn.sum<number>('amount').as('sum'))
          .where('cash_session_id', '=', activeCashSession.id)
          .where('movement_type', '=', 'PAYMENT_OUT')
          .where('notes', 'is not', null)
          .where(sql`LOWER(notes)`, 'like', `%${methodName}%`)
          .executeTakeFirst();

        const openingAmount =
          methodName === 'efectivo' || methodName === 'cash'
            ? Number(activeCashSession.opening_amount ?? 0)
            : 0;

        const availableByMethod =
          openingAmount +
          Number(incomeByMethodRow?.sum ?? 0) -
          Number(spentByMethodRow?.sum ?? 0) -
          Number(refundedByMethodRow?.sum ?? 0);

        if (parsed.amount > availableByMethod) {
          throw new Error(
            `Fondos insuficientes en ${paymentMethod.name}. Disponible: ${Number(
              availableByMethod
            ).toLocaleString('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0
            })}.`
          );
        }
      }

      const result = await trx
        .insertInto('expenses')
        .values({
          cash_session_id: activeCashSession?.id ?? null,
          category_id: parsed.categoryId,
          payment_method_id: parsed.paymentMethodId,
          amount: parsed.amount,
          description: parsed.description,
          expense_date: parsed.expenseDate as unknown as Date,
          created_by: actorId
        })
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('cash_movements')
        .values({
          cash_session_id: activeCashSession.id,
          movement_type: 'EXPENSE_OUT',
          amount: parsed.amount,
          notes: `Gasto (${paymentMethod.name}): ${parsed.description}`,
          created_by: actorId
        })
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          user_id: actorId,
          action: 'EXPENSE_CREATE',
          entity_type: 'expense',
          entity_id: String(result.insertId),
          details_json: JSON.stringify({
            categoryId: parsed.categoryId,
            paymentMethodId: parsed.paymentMethodId,
            paymentMethodName: paymentMethod.name,
            amount: parsed.amount,
            description: parsed.description,
            expenseDate: parsed.expenseDate,
            cashSessionId: activeCashSession?.id ?? null,
            actorName
          })
        })
        .execute();

      return result;
    });

    const row = await db
      .selectFrom('expenses as e')
      .innerJoin('expense_categories as c', 'c.id', 'e.category_id')
      .leftJoin('payment_methods as pm', 'pm.id', 'e.payment_method_id')
      .select([
        'e.id',
        'e.cash_session_id',
        'e.category_id',
        'e.payment_method_id',
        'e.amount',
        'e.description',
        'e.expense_date',
        'e.created_by',
        'e.created_at',
        sql<string>`c.name`.as('category_name'),
        sql<string | null>`pm.name`.as('payment_method_name')
      ])
      .where('e.id', '=', Number(inserted.insertId))
      .executeTakeFirstOrThrow();

    return mapExpense(row);
  };

  return {
    list,
    create,
    listCategories
  };
};
