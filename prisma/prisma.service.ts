import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from '@prisma/client';

const VALID_SCHEMA_RE = /^[a-z][a-z0-9_]*$/;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly tenantClients = new Map<string, PrismaClient>();

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    for (const client of this.tenantClients.values()) {
      await client.$disconnect();
    }
    await this.$disconnect();
  }

  /**
   * Returns (or creates) a PrismaClient scoped to a specific tenant schema.
   * Uses PrismaPg's official `schema` option so all queries target the correct schema.
   */
  private getTenantClient(schemaName: string): PrismaClient {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }
    if (!this.tenantClients.has(schemaName)) {
      const adapter = new PrismaPg(
        { connectionString: process.env.DATABASE_URL! },
        { schema: schemaName },
      );
      this.tenantClients.set(schemaName, new PrismaClient({ adapter }));
    }
    return this.tenantClients.get(schemaName)!;
  }

  /**
   * Run all Prisma queries inside `fn` against a specific tenant schema.
   */
  async withTenantSchema<T>(
    schemaName: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.getTenantClient(schemaName).$transaction(fn);
  }
}
