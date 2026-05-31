import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import type {
  AddAdminIdDto,
  AddLicenseDto,
  AddMrnDto,
  AddNurseIdDto,
} from './dto/super-admin-whitelist.dto';

@Injectable()
export class SuperAdminWhitelistService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTenantSchema(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenantRegistry.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    return tenant.schemaName;
  }

  // ── License ────────────────────────────────────────────────────────────────

  async listLicenses(tenantId: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, (tx) =>
      tx.licenseWhitelist.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async addLicense(tenantId: string, dto: AddLicenseDto) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const exists = await tx.licenseWhitelist.findFirst({
        where: { license: dto.license, tenantId },
      });
      if (exists) throw new ConflictException('License sudah terdaftar');
      return tx.licenseWhitelist.create({
        data: { id: randomUUID(), tenantId, license: dto.license },
      });
    });
  }

  async removeLicense(tenantId: string, id: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const item = await tx.licenseWhitelist.findFirst({ where: { id, tenantId } });
      if (!item) throw new NotFoundException('License tidak ditemukan');
      return tx.licenseWhitelist.delete({ where: { id } });
    });
  }

  // ── Admin ID ───────────────────────────────────────────────────────────────

  async listAdminIds(tenantId: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, (tx) =>
      tx.adminIdWhitelist.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async addAdminId(tenantId: string, dto: AddAdminIdDto) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const exists = await tx.adminIdWhitelist.findFirst({
        where: { adminId: dto.adminId, tenantId },
      });
      if (exists) throw new ConflictException('Admin ID sudah terdaftar');
      return tx.adminIdWhitelist.create({
        data: { id: randomUUID(), tenantId, adminId: dto.adminId },
      });
    });
  }

  async removeAdminId(tenantId: string, id: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const item = await tx.adminIdWhitelist.findFirst({ where: { id, tenantId } });
      if (!item) throw new NotFoundException('Admin ID tidak ditemukan');
      return tx.adminIdWhitelist.delete({ where: { id } });
    });
  }

  // ── Nurse ID ───────────────────────────────────────────────────────────────

  async listNurseIds(tenantId: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, (tx) =>
      tx.nurseIdWhitelist.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async addNurseId(tenantId: string, dto: AddNurseIdDto) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const exists = await tx.nurseIdWhitelist.findFirst({
        where: { nurseId: dto.nurseId, tenantId },
      });
      if (exists) throw new ConflictException('Nurse ID sudah terdaftar');
      return tx.nurseIdWhitelist.create({
        data: { id: randomUUID(), tenantId, nurseId: dto.nurseId },
      });
    });
  }

  async removeNurseId(tenantId: string, id: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const item = await tx.nurseIdWhitelist.findFirst({ where: { id, tenantId } });
      if (!item) throw new NotFoundException('Nurse ID tidak ditemukan');
      return tx.nurseIdWhitelist.delete({ where: { id } });
    });
  }

  // ── MRN ────────────────────────────────────────────────────────────────────

  async listMrns(tenantId: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, (tx) =>
      tx.mrnWhitelist.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async addMrn(tenantId: string, dto: AddMrnDto) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const exists = await tx.mrnWhitelist.findFirst({
        where: { mrn: dto.mrn, tenantId },
      });
      if (exists) throw new ConflictException('MRN sudah terdaftar');
      return tx.mrnWhitelist.create({
        data: { id: randomUUID(), tenantId, mrn: dto.mrn },
      });
    });
  }

  async removeMrn(tenantId: string, id: string) {
    const schemaName = await this.getTenantSchema(tenantId);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const item = await tx.mrnWhitelist.findFirst({ where: { id, tenantId } });
      if (!item) throw new NotFoundException('MRN tidak ditemukan');
      return tx.mrnWhitelist.delete({ where: { id } });
    });
  }
}
