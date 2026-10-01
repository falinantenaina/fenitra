import { z } from 'zod';
import { listQuerySchema } from '../../lib/pagination';

export { idParamSchema } from '../../lib/zod';

const name = z.string().trim().min(2, 'Nom requis').max(120);
const phone = z.string().trim().max(40).nullish();
const address = z.string().trim().max(200).nullish();
const notes = z.string().trim().max(1000).nullish();

export const partyListQuery = listQuerySchema.extend({
  sort: z.enum(['name', '-name', 'createdAt', '-createdAt']).default('name'),
});

export const createSupplierSchema = z.object({ name, phone, address, notes });
export const createCustomerSchema = z.object({ name, phone, address, notes });
export const createOnlineSellerSchema = z.object({ name, phone, address, notes, status: z.string().trim().max(30).optional() });

const updateShape = {
  name: name.optional(),
  phone,
  address,
  notes,
  active: z.boolean().optional(),
};

export const updateSupplierSchema = z
  .object(updateShape)
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

export const updateCustomerSchema = z
  .object(updateShape)
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

export const updateOnlineSellerSchema = z
  .object({ ...updateShape, status: z.string().trim().max(30).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });
