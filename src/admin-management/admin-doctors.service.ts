import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { writeAuditLog } from './audit.helper';
import type { CreateDoctorDto, ListDoctorsQueryDto, UpdateDoctorDto } from './dto/admin-doctors.dto';

const PAGE_SIZE = 30;
const DEFAULT_PASSWORD = 'Password123!';

@Injectable()
export class AdminDoctorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, schemaName: string, query: ListDoctorsQueryDto) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const search = query.search?.trim().toLowerCase();
      const cursor = query.cursor ?? null;

      const where: any = {
        tenantId,
        ...(search && {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { license: { contains: search, mode: 'insensitive' } },
            { specialization: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const doctors = await tx.doctorProfile.findMany({
        where,
        take: PAGE_SIZE + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          fullName: true,
          email: true,
          phone: true,
          license: true,
          specialization: true,
          poli: true,
          serviceCapability: true,
          bio: true,
          createdAt: true,
          user: { select: { isActive: true } },
        },
      });

      const hasMore = doctors.length > PAGE_SIZE;
      const data = hasMore ? doctors.slice(0, PAGE_SIZE) : doctors;

      return {
        data: data.map((d) => ({ ...d, isActive: d.user.isActive })),
        nextCursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      };
    });
  }

  async create(
    tenantId: string,
    schemaName: string,
    dto: CreateDoctorDto,
    actor: { id: string; name: string; role: string },
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const existing = await tx.doctorProfile.findFirst({
        where: { OR: [{ email: dto.email, tenantId }, { license: dto.license, tenantId }] },
      });
      if (existing) {
        throw new ConflictException('Email atau nomor SIP sudah terdaftar di tenant ini');
      }

      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
      const userId = randomUUID();

      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          role: 'DOCTOR',
          name: dto.fullName.trim(),
          isActive: true,
          emailVerifiedAt: new Date(),
          doctorProfile: {
            create: {
              tenantId,
              fullName: dto.fullName.trim(),
              email: dto.email.toLowerCase().trim(),
              phone: dto.phone?.trim() ?? '',
              passwordHash,
              license: dto.license.trim(),
              specialization: dto.specialization ?? null,
              poli: dto.poli ?? null,
              serviceCapability: dto.serviceCapability ?? null,
              bio: dto.bio ?? null,
            },
          },
        },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'CREATE_DOCTOR', targetType: 'DOCTOR', targetId: userId,
        metadata: { email: dto.email, license: dto.license },
      });

      return { userId, message: 'Dokter berhasil didaftarkan' };
    });
  }

  async update(
    tenantId: string,
    schemaName: string,
    userId: string,
    dto: UpdateDoctorDto,
    actor: { id: string; name: string; role: string },
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const profile = await tx.doctorProfile.findFirst({ where: { userId, tenantId } });
      if (!profile) throw new NotFoundException('Dokter tidak ditemukan');

      if (dto.email && dto.email !== profile.email) {
        const conflict = await tx.doctorProfile.findFirst({ where: { email: dto.email, tenantId } });
        if (conflict) throw new ConflictException('Email sudah digunakan');
      }
      if (dto.license && dto.license !== profile.license) {
        const conflict = await tx.doctorProfile.findFirst({ where: { license: dto.license, tenantId } });
        if (conflict) throw new ConflictException('Nomor SIP sudah digunakan');
      }

      const updated = await tx.doctorProfile.update({
        where: { id: profile.id },
        data: {
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dto.email && { email: dto.email.toLowerCase().trim() }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.license && { license: dto.license.trim() }),
          ...(dto.specialization !== undefined && { specialization: dto.specialization }),
          ...(dto.poli !== undefined && { poli: dto.poli }),
          ...(dto.serviceCapability !== undefined && { serviceCapability: dto.serviceCapability }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
        },
      });

      if (dto.fullName) {
        await tx.user.update({ where: { id: userId }, data: { name: dto.fullName.trim() } });
      }

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'UPDATE_DOCTOR', targetType: 'DOCTOR', targetId: userId,
      });

      return updated;
    });
  }

  async toggleActive(
    tenantId: string,
    schemaName: string,
    userId: string,
    actor: { id: string; name: string; role: string },
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId, role: 'DOCTOR' } });
      if (!user) throw new NotFoundException('Dokter tidak ditemukan');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: !user.isActive },
        select: { id: true, isActive: true },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: updated.isActive ? 'ACTIVATE_DOCTOR' : 'DEACTIVATE_DOCTOR',
        targetType: 'DOCTOR', targetId: userId,
      });

      return updated;
    });
  }
}
