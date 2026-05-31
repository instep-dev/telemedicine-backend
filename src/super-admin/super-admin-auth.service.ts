import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma.service';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request } from 'express';
import type { SuperAdminLoginDto } from './dto/super-admin-auth.dto';
import type { SuperAdminJwtPayload } from './types/super-admin-jwt-payload';

function sha256(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseTtlToMs(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid TTL format: ${ttl}`);
  const n = Number(m[1]);
  const unit = m[2];
  const mult =
    unit === 's' ? 1_000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

@Injectable()
export class SuperAdminAuthService {
  private readonly accessSecret = process.env.JWT_SUPER_ADMIN_ACCESS_SECRET!;
  private readonly accessTtl = process.env.JWT_SUPER_ADMIN_ACCESS_TTL ?? '60m';
  private readonly refreshTtl = process.env.JWT_SUPER_ADMIN_REFRESH_TTL ?? '30d';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: SuperAdminLoginDto, req: Request) {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    if (!superAdmin) throw new UnauthorizedException('Email atau password salah');

    const valid = await bcrypt.compare(dto.password, superAdmin.passwordHash);
    if (!valid) throw new UnauthorizedException('Email atau password salah');

    const { accessToken, refreshToken } = await this.issueTokens(
      superAdmin.id,
      req.ip,
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    );

    return {
      accessToken,
      refreshToken,
      superAdmin: { id: superAdmin.id, email: superAdmin.email, name: superAdmin.name },
    };
  }

  async refresh(rawToken: string | undefined) {
    if (!rawToken) throw new UnauthorizedException('Refresh token tidak ada');

    const tokenHash = sha256(rawToken);

    const stored = await this.prisma.superAdminRefreshToken.findUnique({
      where: { tokenHash },
      include: { superAdmin: { select: { id: true, email: true, name: true } } },
    });

    if (
      !stored ||
      stored.revokedAt !== null ||
      stored.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Refresh token tidak valid atau sudah expired');
    }

    // Rotate: revoke old, issue new pair
    const newAccessToken = this.signAccess(stored.superAdminId, stored.superAdmin.email);
    const newRefreshRaw = randomToken();
    const newRefreshHash = sha256(newRefreshRaw);
    const expiresAt = new Date(Date.now() + parseTtlToMs(this.refreshTtl));

    const newRow = await this.prisma.superAdminRefreshToken.create({
      data: {
        id: crypto.randomUUID(),
        superAdminId: stored.superAdminId,
        tokenHash: newRefreshHash,
        userAgent: stored.userAgent,
        ip: stored.ip,
        expiresAt,
      },
      select: { id: true },
    });

    await this.prisma.superAdminRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedByTokenId: newRow.id },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshRaw,
      superAdmin: stored.superAdmin,
    };
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    const tokenHash = sha256(rawToken);
    await this.prisma.superAdminRefreshToken
      .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => {/* already gone */});
  }

  private signAccess(superAdminId: string, email: string): string {
    const payload: SuperAdminJwtPayload = { sub: superAdminId, email, type: 'super_admin' };
    return this.jwt.sign(payload, { secret: this.accessSecret, expiresIn: this.accessTtl as any });
  }

  private async issueTokens(superAdminId: string, ip?: string, userAgent?: string) {
    const superAdmin = await this.prisma.superAdmin.findUniqueOrThrow({
      where: { id: superAdminId },
      select: { email: true },
    });

    const accessToken = this.signAccess(superAdminId, superAdmin.email);
    const refreshRaw = randomToken();
    const refreshHash = sha256(refreshRaw);
    const expiresAt = new Date(Date.now() + parseTtlToMs(this.refreshTtl));

    await this.prisma.superAdminRefreshToken.create({
      data: {
        id: crypto.randomUUID(),
        superAdminId,
        tokenHash: refreshHash,
        userAgent,
        ip,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: refreshRaw };
  }
}
