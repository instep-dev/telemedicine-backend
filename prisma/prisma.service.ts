import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from '@prisma/client';

const VALID_SCHEMA_RE = /^[a-z][a-z0-9_]*$/;

// Public schema: 5 connections (auth, tenant registry, pending registrations)
// Tenant schema: 3 connections each × up to 20 tenants = 60 max
// Total ceiling: ~65 connections — safe for Neon free (100 limit) and paid tiers
const PUBLIC_POOL_CONFIG = {
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
} as const;

const TENANT_POOL_CONFIG = {
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
} as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly tenantClients = new Map<string, PrismaClient>();

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
      ...PUBLIC_POOL_CONFIG,
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

  private getTenantClient(schemaName: string): PrismaClient {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }
    if (!this.tenantClients.has(schemaName)) {
      const adapter = new PrismaPg(
        {
          connectionString: process.env.DATABASE_URL!,
          ...TENANT_POOL_CONFIG,
        },
        { schema: schemaName },
      );
      this.tenantClients.set(schemaName, new PrismaClient({ adapter }));
    }
    return this.tenantClients.get(schemaName)!;
  }

  async withTenantSchema<T>(
    schemaName: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.getTenantClient(schemaName).$transaction(fn);
  }
}
