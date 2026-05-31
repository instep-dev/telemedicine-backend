import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { CreateTenantAdminDto } from './dto/create-tenant-admin.dto';
import type { PlatformUsersQueryDto } from './dto/platform-users-query.dto';

const PAGE_SIZE = 30;

type CursorPayload = { createdAt: string; userId: string };

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    return null;
  }
}

@Injectable()
export class SuperAdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTenantByIdOrThrow(tenantId: string) {
    const tenant = await this.prisma.tenantRegistry.findUnique({
      where: { id: tenantId },
      select: { schemaName: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    return tenant;
  }

  // ─── Per-tenant user list (existing) ──────────────────────────────────────

  async findAll(tenantId: string) {
    const { schemaName } = await this.getTenantByIdOrThrow(tenantId);

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
    const { schemaName } = await this.getTenantByIdOrThrow(tenantId);

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
    const { schemaName } = await this.getTenantByIdOrThrow(tenantId);

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
    const { schemaName } = await this.getTenantByIdOrThrow(tenantId);

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

  // ─── Hard delete user ─────────────────────────────────────────────────────

  async deleteUser(tenantId: string, userId: string) {
    const { schemaName } = await this.getTenantByIdOrThrow(tenantId);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
      if (!user) throw new NotFoundException('User tidak ditemukan');

      await tx.user.delete({ where: { id: userId } });
      return { deleted: true, userId };
    });
  }

  // ─── Platform-wide users (cross-tenant) ───────────────────────────────────

  async findPlatformUsers(query: PlatformUsersQueryDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const search = query.search?.trim().toLowerCase();

    const tenantsFilter = query.tenantId
      ? await this.prisma.tenantRegistry.findMany({
          where: { id: query.tenantId },
          select: { id: true, schemaName: true, name: true },
        })
      : await this.prisma.tenantRegistry.findMany({
          select: { id: true, schemaName: true, name: true },
        });

    type FlatUser = {
      id: string;
      name: string;
      email: string | null;
      role: string;
      isActive: boolean;
      createdAt: Date;
      tenantId: string;
      tenantName: string;
    };

    const allUsers: FlatUser[] = [];

    await Promise.all(
      tenantsFilter.map(async ({ id: tenantId, schemaName, name: tenantName }) => {
        try {
          await this.prisma.withTenantSchema(schemaName, async (tx) => {
            const users = await tx.user.findMany({
              where: {
                tenantId,
                ...(query.role && { role: query.role as any }),
                ...(search && {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    {
                      adminProfile: { email: { contains: search, mode: 'insensitive' } },
                    },
                    {
                      doctorProfile: { email: { contains: search, mode: 'insensitive' } },
                    },
                    {
                      patientProfile: { email: { contains: search, mode: 'insensitive' } },
                    },
                    {
                      nurseProfile: { email: { contains: search, mode: 'insensitive' } },
                    },
                  ],
                }),
              },
              select: {
                id: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
                adminProfile: { select: { email: true } },
                doctorProfile: { select: { email: true } },
                patientProfile: { select: { email: true } },
                nurseProfile: { select: { email: true } },
              },
              orderBy: { createdAt: 'desc' },
            });

            for (const u of users) {
              allUsers.push({
                id: u.id,
                name: u.name,
                role: u.role,
                isActive: u.isActive,
                createdAt: u.createdAt,
                tenantId,
                tenantName,
                email:
                  u.adminProfile?.email ??
                  u.doctorProfile?.email ??
                  u.patientProfile?.email ??
                  u.nurseProfile?.email ??
                  null,
              });
            }
          });
        } catch {
          // skip broken schemas
        }
      }),
    );

    // Sort by createdAt desc, then by id for stable ordering
    allUsers.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    // Apply cursor
    let startIdx = 0;
    if (cursor) {
      const cursorDate = new Date(cursor.createdAt).getTime();
      const idx = allUsers.findIndex((u) => {
        const uDate = u.createdAt.getTime();
        return uDate < cursorDate || (uDate === cursorDate && u.id >= cursor.userId);
      });
      startIdx = idx === -1 ? allUsers.length : idx;
    }

    const page = allUsers.slice(startIdx, startIdx + PAGE_SIZE);
    const hasMore = startIdx + PAGE_SIZE < allUsers.length;

    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor({
            createdAt: page[page.length - 1].createdAt.toISOString(),
            userId: page[page.length - 1].id,
          })
        : null;

    return {
      data: page,
      nextCursor,
      hasMore,
      total: allUsers.length,
    };
  }

  // ─── Create admin account per tenant ──────────────────────────────────────

  async createAdminForTenant(tenantId: string, dto: CreateTenantAdminDto) {
    const { schemaName } = await this.getTenantByIdOrThrow(tenantId);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      // Check email uniqueness in this tenant
      const existingAdmin = await tx.adminProfile.findFirst({
        where: { email: dto.email, tenantId },
      });
      if (existingAdmin) {
        throw new ConflictException(`Email "${dto.email}" sudah digunakan di tenant ini`);
      }

      const passwordHash = await bcrypt.hash(dto.password, 12);
      const userId = randomUUID();
      const adminId = `ADM-${randomUUID().split('-')[0].toUpperCase()}`;

      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          role: 'ADMIN',
          name: dto.name.trim(),
          isActive: true,
          emailVerifiedAt: new Date(),
          adminProfile: {
            create: {
              tenantId,
              fullName: dto.name.trim(),
              email: dto.email.toLowerCase().trim(),
              phone: dto.phone.trim(),
              passwordHash,
              adminId,
            },
          },
        },
      });

      return {
        id: userId,
        name: dto.name.trim(),
        email: dto.email.toLowerCase().trim(),
        adminId,
        tenantId,
        role: 'ADMIN',
        createdAt: new Date(),
      };
    });
  }
}
