import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { writeAuditLog } from './audit.helper';
import type { CreateNurseDto, ListNursesQueryDto, UpdateNurseDto } from './dto/admin-nurses.dto';

export const NURSE_LIST_CHANGED = 'nurse.list.changed';

const PAGE_SIZE = 30;
const DEFAULT_PASSWORD = 'Password123!';

@Injectable()
export class AdminNursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(tenantId: string, schemaName: string, query: ListNursesQueryDto) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const search = query.search?.trim().toLowerCase();
      const cursor = query.cursor ?? null;

      const where: any = {
        tenantId,
        ...(search && {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { nurseId: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const nurses = await tx.nurseProfile.findMany({
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
          nurseId: true,
          poli: true,
          createdAt: true,
          user: { select: { isActive: true } },
        },
      });

      const hasMore = nurses.length > PAGE_SIZE;
      const data = hasMore ? nurses.slice(0, PAGE_SIZE) : nurses;

      return {
        data: data.map((n) => ({ ...n, isActive: n.user.isActive })),
        nextCursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      };
    });
  }

  async create(
    tenantId: string,
    schemaName: string,
    dto: CreateNurseDto,
    actor: { id: string; name: string; role: string },
  ) {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const nameConflict = await tx.nurseProfile.findFirst({
        where: { fullName: { equals: dto.fullName.trim(), mode: 'insensitive' }, tenantId },
      });
      if (nameConflict) throw new ConflictException(`Nama "${dto.fullName.trim()}" sudah terdaftar`);

      const emailConflict = await tx.nurseProfile.findFirst({
        where: { email: dto.email.toLowerCase().trim(), tenantId },
      });
      if (emailConflict) throw new ConflictException(`Email "${dto.email}" sudah digunakan`);

      if (dto.phone?.trim()) {
        const phoneConflict = await tx.nurseProfile.findFirst({
          where: { phone: dto.phone.trim(), tenantId },
        });
        if (phoneConflict) throw new ConflictException(`Nomor telepon "${dto.phone.trim()}" sudah digunakan`);
      }

      const sippConflict = await tx.nurseProfile.findFirst({
        where: { nurseId: dto.nurseId.trim(), tenantId },
      });
      if (sippConflict) throw new ConflictException(`Nomor SIPP "${dto.nurseId.trim()}" sudah terdaftar`);

      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
      const userId = randomUUID();

      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          role: 'NURSE',
          name: dto.fullName.trim(),
          isActive: true,
          emailVerifiedAt: new Date(),
          nurseProfile: {
            create: {
              tenantId,
              fullName: dto.fullName.trim(),
              email: dto.email.toLowerCase().trim(),
              phone: dto.phone?.trim() ?? '',
              passwordHash,
              nurseId: dto.nurseId.trim(),
              poli: dto.poli ?? null,
            },
          },
        },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'CREATE_NURSE', targetType: 'NURSE', targetId: userId,
        metadata: { email: dto.email, nurseId: dto.nurseId },
      });

      return { userId, message: 'Perawat berhasil didaftarkan' };
    });
    this.eventEmitter.emit(NURSE_LIST_CHANGED);
    return result;
  }

  async update(
    tenantId: string,
    schemaName: string,
    userId: string,
    dto: UpdateNurseDto,
    actor: { id: string; name: string; role: string },
  ) {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const profile = await tx.nurseProfile.findFirst({ where: { userId, tenantId } });
      if (!profile) throw new NotFoundException('Perawat tidak ditemukan');

      if (dto.fullName && dto.fullName.trim().toLowerCase() !== profile.fullName.toLowerCase()) {
        const conflict = await tx.nurseProfile.findFirst({
          where: { fullName: { equals: dto.fullName.trim(), mode: 'insensitive' }, tenantId },
        });
        if (conflict) throw new ConflictException(`Nama "${dto.fullName.trim()}" sudah terdaftar`);
      }
      if (dto.email && dto.email !== profile.email) {
        const conflict = await tx.nurseProfile.findFirst({ where: { email: dto.email, tenantId } });
        if (conflict) throw new ConflictException(`Email "${dto.email}" sudah digunakan`);
      }
      if (dto.phone?.trim() && dto.phone.trim() !== profile.phone) {
        const conflict = await tx.nurseProfile.findFirst({ where: { phone: dto.phone.trim(), tenantId } });
        if (conflict) throw new ConflictException(`Nomor telepon "${dto.phone.trim()}" sudah digunakan`);
      }
      if (dto.nurseId && dto.nurseId !== profile.nurseId) {
        const conflict = await tx.nurseProfile.findFirst({ where: { nurseId: dto.nurseId, tenantId } });
        if (conflict) throw new ConflictException(`Nomor SIPP "${dto.nurseId.trim()}" sudah terdaftar`);
      }

      const updated = await tx.nurseProfile.update({
        where: { id: profile.id },
        data: {
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dto.email && { email: dto.email.toLowerCase().trim() }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.nurseId && { nurseId: dto.nurseId.trim() }),
          ...(dto.poli !== undefined && { poli: dto.poli }),
        },
      });

      if (dto.fullName) {
        await tx.user.update({ where: { id: userId }, data: { name: dto.fullName.trim() } });
      }

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'UPDATE_NURSE', targetType: 'NURSE', targetId: userId,
      });

      return updated;
    });
    this.eventEmitter.emit(NURSE_LIST_CHANGED);
    return result;
  }

  async toggleActive(
    tenantId: string,
    schemaName: string,
    userId: string,
    actor: { id: string; name: string; role: string },
  ) {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId, role: 'NURSE' } });
      if (!user) throw new NotFoundException('Perawat tidak ditemukan');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: !user.isActive },
        select: { id: true, isActive: true },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: updated.isActive ? 'ACTIVATE_NURSE' : 'DEACTIVATE_NURSE',
        targetType: 'NURSE', targetId: userId,
      });

      return updated;
    });
    this.eventEmitter.emit(NURSE_LIST_CHANGED);
    return result;
  }
}
