import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestPrisma } from './helpers/database.js';

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  collation_name: string | null;
}

describe('esquema de la base de datos', () => {
  let prisma: PrismaClient;
  let columns: ColumnRow[];

  beforeAll(async () => {
    prisma = createTestPrisma();
    columns = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name, column_name, data_type, collation_name
      FROM information_schema.columns
      WHERE table_schema = 'public'`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const column = (table: string, name: string) => columns.find((c) => c.table_name === table && c.column_name === name);

  it('guarda el flujo como texto, no como jsonb (jsonb reordena y deduplica claves)', () => {
    expect(column('flows', 'draft')?.data_type).toBe('text');
    expect(column('flows', 'name_json')?.data_type).toBe('text');
    expect(column('flow_versions', 'definition')?.data_type).toBe('text');
    expect(column('flow_versions', 'name_json')?.data_type).toBe('text');
    expect(columns.some((c) => c.data_type === 'jsonb' || c.data_type === 'json')).toBe(false);
  });

  it('flows.id y flow_versions.flow_id usan la colación C (Prisma no la modela)', () => {
    expect(column('flows', 'id')?.collation_name).toBe('C');
    expect(column('flow_versions', 'flow_id')?.collation_name).toBe('C');
  });

  it('ordena los id por código de carácter, no por la colación de la base', async () => {
    await prisma.$executeRaw`TRUNCATE flow_versions, flows`;
    const now = new Date();
    for (const id of ['a-c', 'ab', 'a_b']) {
      await prisma.flow.create({
        data: { id, nameJson: '"x"', draft: '{}', revision: 1, unpublishedChanges: true, createdAt: now, updatedAt: now },
      });
    }
    const ordered = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM flows ORDER BY id ASC`;
    expect(ordered.map((row) => row.id)).toEqual(['a-c', 'a_b', 'ab']);
    await prisma.$executeRaw`TRUNCATE flow_versions, flows`;
  });
});
