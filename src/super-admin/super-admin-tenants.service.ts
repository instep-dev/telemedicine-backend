import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import { getTenantSchemaDDL } from './tenant-schema.template';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { UpdateTenantDto } from './dto/update-tenant.dto';

export const TENANT_STATUS_CHANGED_EVENT = 'tenant.status.changed';
export const TENANT_LIST_UPDATED_EVENT   = 'tenant.list.updated';

export interface TenantStatusChangedPayload {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'inactive';
}

@Injectable()
export class SuperAdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(filters?: { status?: string; subscriptionPlan?: string }) {
    return this.prisma.tenantRegistry.findMany({
      where: {
        ...(filters?.status        && { status: filters.status }),
        ...(filters?.subscriptionPlan && { subscriptionPlan: filters.subscriptionPlan as any }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findRecent(limit = 3) {
    return this.prisma.tenantRegistry.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenantRegistry.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    const slug = dto.slug.toLowerCase().trim();
    const name = dto.name.trim();

    const existingSlug = await this.prisma.tenantRegistry.findUnique({ where: { slug } });
    if (existingSlug) throw new ConflictException(`Slug "${slug}" sudah digunakan`);

    const existingName = await this.prisma.tenantRegistry.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existingName) throw new ConflictException(`Nama rumah sakit "${name}" sudah digunakan`);

    const tenantId = randomUUID();
    const schemaName = `tenant_${slug.replace(/-/g, '_')}`;

    await this.provisionSchema(schemaName);

    const tenant = await this.prisma.tenantRegistry.create({
      data: {
        id: tenantId,
        slug,
        name,
        schemaName,
        status: 'active',
        serviceType: dto.serviceType ?? null,
        subscriptionPlan: dto.subscriptionPlan ?? null,
        adminEmail: dto.adminEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        address: dto.address ?? null,
      },
    });

    this.eventEmitter.emit(TENANT_LIST_UPDATED_EVENT);
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findOne(id);

    const tenant = await this.prisma.tenantRegistry.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.serviceType !== undefined && { serviceType: dto.serviceType }),
        ...(dto.subscriptionPlan !== undefined && { subscriptionPlan: dto.subscriptionPlan }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.adminEmail !== undefined && { adminEmail: dto.adminEmail }),
        ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });

    this.eventEmitter.emit(TENANT_LIST_UPDATED_EVENT);
    return tenant;
  }

  async activate(id: string) {
    await this.findOne(id);
    const tenant = await this.prisma.tenantRegistry.update({
      where: { id },
      data: { status: 'active' },
    });
    this.eventEmitter.emit(TENANT_STATUS_CHANGED_EVENT, {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: 'active',
    } satisfies TenantStatusChangedPayload);
    return tenant;
  }

  async deactivate(id: string) {
    await this.findOne(id);
    const tenant = await this.prisma.tenantRegistry.update({
      where: { id },
      data: { status: 'inactive' },
    });
    this.eventEmitter.emit(TENANT_STATUS_CHANGED_EVENT, {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: 'inactive',
    } satisfies TenantStatusChangedPayload);
    return tenant;
  }

  async runMigrationOnAllSchemas(statements: string[]): Promise<{ schema: string; ok: boolean; error?: string }[]> {
    const tenants = await this.prisma.tenantRegistry.findMany({ select: { schemaName: true } });
    const results: { schema: string; ok: boolean; error?: string }[] = [];

    for (const tenant of tenants) {
      const s = tenant.schemaName;
      if (!/^[a-z][a-z0-9_]*$/.test(s)) {
        results.push({ schema: s, ok: false, error: 'Invalid schema name' });
        continue;
      }

      try {
        for (const tpl of statements) {
          const sql = tpl.replace(/\{\{schema\}\}/g, s);
          await this.prisma.$executeRawUnsafe(sql);
        }
        results.push({ schema: s, ok: true });
      } catch (err: any) {
        results.push({ schema: s, ok: false, error: err?.message ?? String(err) });
      }
    }

    return results;
  }

  private async provisionSchema(schemaName: string): Promise<void> {
    // Validate schema name — VALID_SCHEMA_RE from PrismaService
    if (!/^[a-z][a-z0-9_]*$/.test(schemaName)) {
      throw new BadRequestException(`Invalid schema name: ${schemaName}`);
    }

    const statements = getTenantSchemaDDL(schemaName);

    for (const sql of statements) {
      await this.prisma.$executeRawUnsafe(sql);
    }
  }
}
