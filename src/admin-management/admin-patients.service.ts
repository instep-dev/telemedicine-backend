import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { writeAuditLog } from './audit.helper';
import type { CreatePatientDto, ListPatientsQueryDto, UpdatePatientDto } from './dto/admin-patients.dto';

export const PATIENT_LIST_CHANGED = 'patient.list.changed';

const PAGE_SIZE = 30;
const DEFAULT_PASSWORD = 'Password123!';

@Injectable()
export class AdminPatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const nameConflict = await tx.patientProfile.findFirst({
        where: { fullName: { equals: dto.fullName.trim(), mode: 'insensitive' }, tenantId },
      });
      if (nameConflict) throw new ConflictException(`Nama "${dto.fullName.trim()}" sudah terdaftar`);

      if (dto.email) {
        const conflict = await tx.patientProfile.findFirst({ where: { email: dto.email.toLowerCase().trim(), tenantId } });
        if (conflict) throw new ConflictException(`Email "${dto.email}" sudah digunakan`);
      }

      const phoneConflict = await tx.patientProfile.findFirst({ where: { phone: dto.phone.trim(), tenantId } });
      if (phoneConflict) throw new ConflictException(`Nomor telepon "${dto.phone.trim()}" sudah digunakan`);

      const mrn = dto.mrn.trim();
      const mrnConflict = await tx.patientProfile.findFirst({ where: { mrn, tenantId } });
      if (mrnConflict) throw new ConflictException('MRN sudah digunakan');

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
    this.eventEmitter.emit(PATIENT_LIST_CHANGED);
    return result;
  }

  async update(
    tenantId: string,
    schemaName: string,
    userId: string,
    dto: UpdatePatientDto,
    actor: { id: string; name: string; role: string },
  ) {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const profile = await tx.patientProfile.findFirst({ where: { userId, tenantId } });
      if (!profile) throw new NotFoundException('Pasien tidak ditemukan');

      if (dto.fullName && dto.fullName.trim().toLowerCase() !== profile.fullName.toLowerCase()) {
        const conflict = await tx.patientProfile.findFirst({
          where: { fullName: { equals: dto.fullName.trim(), mode: 'insensitive' }, tenantId },
        });
        if (conflict) throw new ConflictException(`Nama "${dto.fullName.trim()}" sudah terdaftar`);
      }

      if (dto.phone && dto.phone.trim() !== profile.phone) {
        const conflict = await tx.patientProfile.findFirst({ where: { phone: dto.phone.trim(), tenantId } });
        if (conflict) throw new ConflictException(`Nomor telepon "${dto.phone.trim()}" sudah digunakan`);
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
    this.eventEmitter.emit(PATIENT_LIST_CHANGED);
    return result;
  }

  async toggleActive(
    tenantId: string,
    schemaName: string,
    userId: string,
    actor: { id: string; name: string; role: string },
  ) {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
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
    this.eventEmitter.emit(PATIENT_LIST_CHANGED);
    return result;
  }
}
