import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { writeAuditLog } from './audit.helper';
import type { CreatePatientDto, ListPatientsQueryDto, UpdatePatientDto } from './dto/admin-patients.dto';

const PAGE_SIZE = 30;
const DEFAULT_PASSWORD = 'Password123!';

function generateMrn(year: number, sequence: number): string {
  return `MRN-${year}-${String(sequence).padStart(4, '0')}`;
}

@Injectable()
export class AdminPatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, schemaName: string, query: ListPatientsQueryDto) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const search = query.search?.trim().toLowerCase();
      const cursor = query.cursor ?? null;

      const where: any = {
        tenantId,
        ...(search && {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { mrn: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        }),
      };

      const patients = await tx.patientProfile.findMany({
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
          bornDate: true,
          gender: true,
          mrn: true,
          address: true,
          createdAt: true,
          user: { select: { isActive: true } },
        },
      });

      const hasMore = patients.length > PAGE_SIZE;
      const data = hasMore ? patients.slice(0, PAGE_SIZE) : patients;

      return {
        data: data.map((p) => ({ ...p, isActive: p.user.isActive })),
        nextCursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      };
    });
  }

  async create(
    tenantId: string,
    schemaName: string,
    dto: CreatePatientDto,
    actor: { id: string; name: string; role: string },
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      // Check email uniqueness only if provided
      if (dto.email) {
        const conflict = await tx.patientProfile.findFirst({ where: { email: dto.email, tenantId } });
        if (conflict) throw new ConflictException('Email sudah terdaftar di tenant ini');
      }

      // Check phone uniqueness
      const phoneConflict = await tx.patientProfile.findFirst({ where: { phone: dto.phone, tenantId } });
      if (phoneConflict) throw new ConflictException('Nomor telepon sudah terdaftar');

      // Handle MRN
      let mrn = dto.mrn?.trim() || null;
      if (!mrn) {
        const year = new Date().getFullYear();
        const count = await tx.patientProfile.count({ where: { tenantId } });
        mrn = generateMrn(year, count + 1);
        // Ensure uniqueness in case of collision
        const mrnConflict = await tx.patientProfile.findFirst({ where: { mrn, tenantId } });
        if (mrnConflict) mrn = generateMrn(year, count + 2);
      } else {
        const mrnConflict = await tx.patientProfile.findFirst({ where: { mrn, tenantId } });
        if (mrnConflict) throw new ConflictException('MRN sudah digunakan');
      }

      const userId = randomUUID();
      const hasAccount = !!dto.email;
      const passwordHash = hasAccount ? await bcrypt.hash(DEFAULT_PASSWORD, 12) : null;

      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          role: 'PATIENT',
          name: dto.fullName.trim(),
          isActive: true,
          emailVerifiedAt: hasAccount ? new Date() : null,
          patientProfile: {
            create: {
              tenantId,
              fullName: dto.fullName.trim(),
              email: dto.email?.toLowerCase().trim() ?? `guest_${userId}@noemail.internal`,
              phone: dto.phone.trim(),
              passwordHash,
              bornDate: dto.bornDate ? new Date(dto.bornDate) : null,
              gender: dto.gender ?? null,
              mrn,
              address: dto.address ?? null,
            },
          },
        },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'CREATE_PATIENT', targetType: 'PATIENT', targetId: userId,
        metadata: { mrn, hasAccount },
      });

      return { userId, mrn, message: 'Pasien berhasil didaftarkan' };
    });
  }

  async update(
    tenantId: string,
    schemaName: string,
    userId: string,
    dto: UpdatePatientDto,
    actor: { id: string; name: string; role: string },
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const profile = await tx.patientProfile.findFirst({ where: { userId, tenantId } });
      if (!profile) throw new NotFoundException('Pasien tidak ditemukan');

      if (dto.phone && dto.phone !== profile.phone) {
        const conflict = await tx.patientProfile.findFirst({ where: { phone: dto.phone, tenantId } });
        if (conflict) throw new ConflictException('Nomor telepon sudah digunakan');
      }

      const updated = await tx.patientProfile.update({
        where: { id: profile.id },
        data: {
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dto.phone && { phone: dto.phone.trim() }),
          ...(dto.bornDate !== undefined && { bornDate: dto.bornDate ? new Date(dto.bornDate) : null }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(dto.address !== undefined && { address: dto.address }),
        },
      });

      if (dto.fullName) {
        await tx.user.update({ where: { id: userId }, data: { name: dto.fullName.trim() } });
      }

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'UPDATE_PATIENT', targetType: 'PATIENT', targetId: userId,
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
      const user = await tx.user.findFirst({ where: { id: userId, tenantId, role: 'PATIENT' } });
      if (!user) throw new NotFoundException('Pasien tidak ditemukan');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: !user.isActive },
        select: { id: true, isActive: true },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: updated.isActive ? 'ACTIVATE_PATIENT' : 'DEACTIVATE_PATIENT',
        targetType: 'PATIENT', targetId: userId,
      });

      return updated;
    });
  }
}
