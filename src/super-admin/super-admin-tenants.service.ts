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

  async findAll() {
    return this.prisma.tenantRegistry.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenantRegistry.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    const slug = dto.slug.toLowerCase().trim();

    const existing = await this.prisma.tenantRegistry.findUnique({ where: { slug } });
    if (existing) throw new ConflictException(`Slug "${slug}" sudah digunakan`);

    const tenantId = randomUUID();
    const schemaName = `tenant_${slug.replace(/-/g, '_')}`;

    // Provision PostgreSQL schema + all tables
    await this.provisionSchema(schemaName);

    const tenant = await this.prisma.tenantRegistry.create({
      data: {
        id: tenantId,
        slug,
        name: dto.name.trim(),
        schemaName,
        status: 'active',
        adminEmail: dto.adminEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
      },
    });

    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findOne(id);

    return this.prisma.tenantRegistry.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.adminEmail !== undefined && { adminEmail: dto.adminEmail }),
        ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
      },
    });
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
