import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class SuperAdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTenantSchema(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenantRegistry.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    return tenant.schemaName;
  }

  async findAll(tenantId: string) {
    const schemaName = await this.getTenantSchema(tenantId);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          role: true,
          name: true,
          isActive: true,
          emailVerifiedAt: true,
          createdAt: true,
          doctorProfile: { select: { email: true, phone: true, license: true } },
          adminProfile: { select: { email: true, phone: true, adminId: true } },
          patientProfile: { select: { email: true, phone: true } },
          nurseProfile: { select: { email: true, phone: true, nurseId: true } },
        },
      });

      return users.map((u) => ({
        id: u.id,
        role: u.role,
        name: u.name,
        isActive: u.isActive,
        emailVerifiedAt: u.emailVerifiedAt,
        createdAt: u.createdAt,
        email:
          u.doctorProfile?.email ??
          u.adminProfile?.email ??
          u.patientProfile?.email ??
          u.nurseProfile?.email ??
          null,
        phone:
          u.doctorProfile?.phone ??
          u.adminProfile?.phone ??
          u.patientProfile?.phone ??
          u.nurseProfile?.phone ??
          null,
        identifier:
          u.doctorProfile?.license ??
          u.adminProfile?.adminId ??
          u.nurseProfile?.nurseId ??
          null,
      }));
    });
  }

  async findOne(tenantId: string, userId: string) {
    const schemaName = await this.getTenantSchema(tenantId);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId },
        include: {
          doctorProfile: true,
          adminProfile: true,
          patientProfile: true,
          nurseProfile: true,
        },
      });
      if (!user) throw new NotFoundException('User tidak ditemukan');
      return user;
    });
  }

  async activate(tenantId: string, userId: string) {
    const schemaName = await this.getTenantSchema(tenantId);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
      if (!user) throw new NotFoundException('User tidak ditemukan');

      return tx.user.update({
        where: { id: userId },
        data: { isActive: true },
        select: { id: true, role: true, name: true, isActive: true },
      });
    });
  }

  async deactivate(tenantId: string, userId: string) {
    const schemaName = await this.getTenantSchema(tenantId);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
      if (!user) throw new NotFoundException('User tidak ditemukan');

      return tx.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: { id: true, role: true, name: true, isActive: true },
      });
    });
  }
}
