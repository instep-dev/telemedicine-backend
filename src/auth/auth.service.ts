import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import crypto from "crypto";
import { AuthAction, UserRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { DoctorProfile, PatientProfile, AdminProfile, NurseProfile, User } from "@prisma/client";
import type { JwtPayload } from "./types/jwt-payload";
import type { StringValue } from "ms";
import type { TenantContext } from "../tenant/tenant.interface";
import bcrypt from "bcryptjs";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function sha256(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function parseTtlToMs(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid TTL format: ${ttl}`);
  const n = Number(m[1]);
  const unit = m[2];
  const mult =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const VERIFY_TTL_MINUTES = 30;

function randomVerificationCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) code += crypto.randomInt(0, 10).toString();
  return code;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function ensurePhoneDigits(raw: string, normalized: string) {
  if (!normalized) throw new BadRequestException("Nomor telepon wajib diisi");
  if (!/^\d+$/.test(normalized))
    throw new BadRequestException("Nomor telepon harus angka");
}

function ensurePasswordPolicy(password: string) {
  if (!PASSWORD_REGEX.test(password)) {
    throw new BadRequestException(
      "Password minimal 8 karakter, harus ada 1 lowercase, 1 uppercase, dan 1 number",
    );
  }
}

function parseBornDate(raw?: string) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException("Tanggal lahir tidak valid");
  return d;
}

function ensureMinimumAge(bornDate: Date, minYears: number) {
  const now = new Date();
  const cutoff = new Date(now.getFullYear() - minYears, now.getMonth(), now.getDate());
  if (bornDate > cutoff)
    throw new BadRequestException(`Minimal umur ${minYears} tahun`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ProfileWithUser =
  | (DoctorProfile & { user: User })
  | (AdminProfile & { user: User })
  | (PatientProfile & { user: User })
  | (NurseProfile & { user: User });

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private accessTtl = process.env.JWT_ACCESS_TTL || "60m";
  private refreshTtl = process.env.JWT_REFRESH_TTL || "30d";

  // ─── Audit log (writes to tenant schema) ──────────────────────────────────

  private async audit(params: {
    tenant: TenantContext;
    userId?: string;
    email?: string;
    action: AuthAction;
    success: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    try {
      await this.prisma.withTenantSchema(params.tenant.schemaName, async (tx) => {
        await tx.authAuditLog.create({
          data: {
            tenantId: params.tenant.id,
            userId: params.userId,
            email: params.email,
            action: params.action,
            success: params.success,
            ip: params.ip,
            userAgent: params.userAgent,
          },
        });
      });
    } catch (err) {
      this.logger.error("Failed to write audit log", err);
    }
  }

  // ─── Password helpers ──────────────────────────────────────────────────────

  private async hashPassword(raw: string) {
    return bcrypt.hash(raw, 10);
  }

  private async verifyPassword(raw: string, hash: string) {
    return bcrypt.compare(raw, hash);
  }

  // ─── Role/provider parsers ─────────────────────────────────────────────────

  private parseRole(raw: string): UserRole {
    const v = String(raw || "").trim().toUpperCase();
    if (v === "DOCTOR") return UserRole.DOCTOR;
    if (v === "ADMIN") return UserRole.ADMIN;
    if (v === "PATIENT") return UserRole.PATIENT;
    if (v === "NURSE") return UserRole.NURSE;
    throw new BadRequestException("Role tidak valid");
  }

  // ─── Profile finders (called inside withTenantSchema) ─────────────────────

  private async findProfileByIdentifierInTx(
    tx: Prisma.TransactionClient,
    lookup: { email?: string; phone?: string },
  ): Promise<ProfileWithUser | null> {
    const [doctor, admin, patient, nurse] = await Promise.all([
      tx.doctorProfile.findFirst({ where: lookup, include: { user: true } }),
      tx.adminProfile.findFirst({ where: lookup, include: { user: true } }),
      tx.patientProfile.findFirst({ where: lookup, include: { user: true } }),
      tx.nurseProfile.findFirst({ where: lookup, include: { user: true } }),
    ]);

    const matches = [doctor, admin, patient, nurse].filter(Boolean) as ProfileWithUser[];
    if (matches.length === 0) return null;
    if (matches.length > 1) throw new BadRequestException("Data email/telepon duplikat di profile");
    return matches[0];
  }

  private async findProfileByUserIdInTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<ProfileWithUser | null> {
    const [doctor, admin, patient, nurse] = await Promise.all([
      tx.doctorProfile.findFirst({ where: { userId }, include: { user: true } }),
      tx.adminProfile.findFirst({ where: { userId }, include: { user: true } }),
      tx.patientProfile.findFirst({ where: { userId }, include: { user: true } }),
      tx.nurseProfile.findFirst({ where: { userId }, include: { user: true } }),
    ]);

    const matches = [doctor, admin, patient, nurse].filter(Boolean) as ProfileWithUser[];
    return matches[0] ?? null;
  }

  private async getProfileByUserIdInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    role: UserRole,
  ) {
    if (role === UserRole.DOCTOR)
      return tx.doctorProfile.findUnique({ where: { userId } });
    if (role === UserRole.ADMIN)
      return tx.adminProfile.findUnique({ where: { userId } });
    if (role === UserRole.NURSE)
      return tx.nurseProfile.findUnique({ where: { userId } });
    return tx.patientProfile.findUnique({ where: { userId } });
  }

  // ─── Validation helpers ────────────────────────────────────────────────────

  private async ensureEmailPhoneAvailable(
    email: string,
    phone: string,
    tenant: TenantContext,
    options?: { excludePendingId?: string },
  ) {
    // Check tenant profiles
    const taken = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const [d, a, p, n] = await Promise.all([
        tx.doctorProfile.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } }),
        tx.adminProfile.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } }),
        tx.patientProfile.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } }),
        tx.nurseProfile.findFirst({ where: { OR: [{ email }, { phone }] }, select: { id: true } }),
      ]);
      return !!(d || a || p || n);
    });

    if (taken) throw new BadRequestException("Email atau nomor telepon sudah terdaftar");

    // Check public pending registrations scoped to this tenant
    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        tenantSlug: tenant.slug,
        OR: [{ email }, { phone }],
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId ? { id: { not: options.excludePendingId } } : {}),
      },
      select: { id: true },
    });
    if (pending) throw new BadRequestException("Email atau nomor telepon sudah terdaftar");
  }

  private async ensureLicenseValid(
    license: string,
    tenant: TenantContext,
    options?: { excludePendingId?: string },
  ) {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const whitelist = await tx.licenseWhitelist.findUnique({
        where: { license_tenantId: { license, tenantId: tenant.id } },
        select: { id: true },
      });
      if (!whitelist) throw new BadRequestException("License tidak terdaftar");

      const used = await tx.doctorProfile.findUnique({
        where: { license_tenantId: { license, tenantId: tenant.id } },
        select: { id: true },
      });
      if (used) throw new BadRequestException("License sudah digunakan");
    });

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        license,
        tenantSlug: tenant.slug,
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId ? { id: { not: options.excludePendingId } } : {}),
      },
      select: { id: true },
    });
    if (pending) throw new BadRequestException("License sedang digunakan");
  }

  private async ensureAdminIdValid(
    adminId: string,
    tenant: TenantContext,
    options?: { excludePendingId?: string },
  ) {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const whitelist = await tx.adminIdWhitelist.findUnique({
        where: { adminId_tenantId: { adminId, tenantId: tenant.id } },
        select: { id: true },
      });
      if (!whitelist) throw new BadRequestException("Admin ID tidak terdaftar");

      const used = await tx.adminProfile.findUnique({
        where: { adminId_tenantId: { adminId, tenantId: tenant.id } },
        select: { id: true },
      });
      if (used) throw new BadRequestException("Admin ID sudah digunakan");
    });

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        adminId,
        tenantSlug: tenant.slug,
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId ? { id: { not: options.excludePendingId } } : {}),
      },
      select: { id: true },
    });
    if (pending) throw new BadRequestException("Admin ID sedang digunakan");
  }

  private async ensureNurseIdValid(
    nurseId: string,
    tenant: TenantContext,
    options?: { excludePendingId?: string },
  ) {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const whitelist = await tx.nurseIdWhitelist.findUnique({
        where: { nurseId_tenantId: { nurseId, tenantId: tenant.id } },
        select: { id: true },
      });
      if (!whitelist) throw new BadRequestException("Nurse ID tidak terdaftar");

      const used = await tx.nurseProfile.findUnique({
        where: { nurseId_tenantId: { nurseId, tenantId: tenant.id } },
        select: { id: true },
      });
      if (used) throw new BadRequestException("Nurse ID sudah digunakan");
    });

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: {
        nurseId,
        tenantSlug: tenant.slug,
        expiresAt: { gt: new Date() },
        ...(options?.excludePendingId ? { id: { not: options.excludePendingId } } : {}),
      },
      select: { id: true },
    });
    if (pending) throw new BadRequestException("Nurse ID sedang digunakan");
  }


  private async generateUniqueTwilioIdentity(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = `doc_${crypto.randomBytes(10).toString("hex")}`;
      const exists = await tx.user.findFirst({
        where: { twilioIdentity: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new Error("Failed to generate unique Twilio identity");
  }

  // ─── Token issuance ────────────────────────────────────────────────────────

  private async issueTokens(params: {
    userId: string;
    email: string;
    role: UserRole;
    tenant: TenantContext;
    twilioIdentity?: string | null;
    ip?: string;
    userAgent?: string;
    rememberMe?: boolean;
  }) {
    const payload: Omit<JwtPayload, "id"> & { id: string } = {
      id: params.userId,
      sub: params.userId,
      email: params.email,
      role: params.role,
      tenantId: params.tenant.id,
      tenantSlug: params.tenant.slug,
      twilioIdentity: params.twilioIdentity ?? undefined,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: this.accessTtl as StringValue,
    });

    const refreshRaw = randomToken();
    const refreshHash = sha256(refreshRaw);
    const refreshTtl = params.rememberMe ? "30d" : "1d";
    const refreshExpiresAt = new Date(Date.now() + parseTtlToMs(refreshTtl));

    const refreshRow = await this.prisma.withTenantSchema(
      params.tenant.schemaName,
      async (tx) => {
        return tx.refreshToken.create({
          data: {
            tenantId: params.tenant.id,
            userId: params.userId,
            tokenHash: refreshHash,
            userAgent: params.userAgent,
            ip: params.ip,
            expiresAt: refreshExpiresAt,
          },
          select: { id: true },
        });
      },
    );

    return { accessToken, refreshToken: refreshRaw, refreshTokenId: refreshRow.id };
  }

  // ─── Email sender ──────────────────────────────────────────────────────────

  private async sendVerificationEmail(email: string, code: string) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "Telemedicine <no-reply@notifications.instep.id>";

    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY not configured. Email to ${email} skipped.`);
      return;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Verifikasi Email - Telemedicine",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <p>Halo,</p>
            <p>Gunakan kode berikut untuk verifikasi email registrasi kamu:</p>
            <p style="font-size: 26px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${code}</p>
            <p>Kode berlaku selama ${VERIFY_TTL_MINUTES} menit.</p>
            <p>Jika kamu tidak merasa melakukan registrasi, abaikan email ini.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gagal mengirim email verifikasi: ${text}`);
    }
  }

  // ─── Public methods ────────────────────────────────────────────────────────

  async login(
    input: {
      identifier: string;
      password: string;
      ip?: string;
      userAgent?: string;
      rememberMe?: boolean;
    },
    tenant: TenantContext,
  ) {
    const rawIdentifier = (input.identifier || "").trim();
    if (!rawIdentifier) throw new BadRequestException("Email/phone wajib diisi");

    const isEmail = rawIdentifier.includes("@");
    const lookup = isEmail
      ? { email: normalizeEmail(rawIdentifier) }
      : { phone: normalizePhone(rawIdentifier) };

    if (!isEmail && !lookup.phone) throw new BadRequestException("Nomor telepon tidak valid");

    const profileResult = await this.prisma.withTenantSchema(
      tenant.schemaName,
      async (tx) => this.findProfileByIdentifierInTx(tx, lookup),
    );

    const profile = profileResult;
    const user = profile?.user;

    if (!profile || !user || !user.isActive) {
      await this.audit({
        tenant,
        email: isEmail ? lookup.email : undefined,
        action: AuthAction.LOGIN,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Email/phone atau password salah");
    }

    if (!profile.passwordHash) {
      throw new UnauthorizedException("Email/phone atau password salah");
    }

    const ok = await this.verifyPassword(input.password, profile.passwordHash);
    if (!ok) {
      await this.audit({
        tenant,
        userId: user.id,
        email: profile.email,
        action: AuthAction.LOGIN,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Email/phone atau password salah");
    }

    const tokens = await this.issueTokens({
      userId: user.id,
      email: profile.email,
      role: user.role,
      tenant,
      twilioIdentity: user.twilioIdentity,
      ip: input.ip,
      userAgent: input.userAgent,
      rememberMe: input.rememberMe,
    });

    await this.audit({
      tenant,
      userId: user.id,
      email: profile.email,
      action: AuthAction.LOGIN,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: profile.email,
        name: user.name,
        role: user.role,
        phone: profile.phone,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        twilioIdentity: user.twilioIdentity,
      },
    };
  }

  async refresh(input: { refreshToken: string; ip?: string; userAgent?: string }, tenant: TenantContext) {
    const tokenHash = sha256(input.refreshToken);

    const existing = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
    });

    if (!existing) {
      await this.audit({ tenant, action: AuthAction.REFRESH, success: false, ip: input.ip, userAgent: input.userAgent });
      throw new UnauthorizedException("Refresh token invalid");
    }

    if (existing.tenantId !== tenant.id) throw new UnauthorizedException("Refresh token tenant mismatch");
    if (existing.revokedAt) throw new UnauthorizedException("Refresh token revoked");
    if (existing.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Refresh token expired");
    if (!existing.user.isActive) throw new UnauthorizedException("User inactive");

    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.getProfileByUserIdInTx(tx, existing.user.id, existing.user.role),
    );
    if (!profile) throw new UnauthorizedException("Profil user tidak ditemukan");

    const newRefreshRaw = randomToken();
    const newRefreshHash = sha256(newRefreshRaw);
    const newExpiresAt = new Date(Date.now() + parseTtlToMs(this.refreshTtl));

    // Rotate token atomically in tenant schema
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const revokeResult = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (revokeResult.count === 0) throw new UnauthorizedException("Refresh token sudah dipakai");

      const newToken = await tx.refreshToken.create({
        data: {
          tenantId: tenant.id,
          userId: existing.userId,
          tokenHash: newRefreshHash,
          userAgent: input.userAgent,
          ip: input.ip,
          expiresAt: newExpiresAt,
          replacesToken: { connect: { id: existing.id } },
        },
        select: { id: true },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedByTokenId: newToken.id },
      });
    });

    const payload: Omit<JwtPayload, "id"> & { id: string } = {
      id: existing.user.id,
      sub: existing.user.id,
      email: profile.email,
      role: existing.user.role,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      twilioIdentity: existing.user.twilioIdentity ?? undefined,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: this.accessTtl as StringValue,
    });

    await this.audit({
      tenant,
      userId: existing.userId,
      email: profile.email,
      action: AuthAction.REFRESH,
      success: true,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken,
      refreshToken: newRefreshRaw,
      user: {
        id: existing.user.id,
        email: profile.email,
        name: existing.user.name,
        role: existing.user.role,
        phone: profile.phone,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        twilioIdentity: existing.user.twilioIdentity,
      },
    };
  }

  async logout(
    input: { refreshToken?: string; revokeAll?: boolean; userId?: string; ip?: string; userAgent?: string },
    tenant: TenantContext,
  ) {
    if (input.revokeAll) {
      if (!input.userId) throw new ForbiddenException("userId required");

      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.refreshToken.updateMany({
          where: { userId: input.userId, tenantId: tenant.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });

      await this.audit({ tenant, userId: input.userId, action: AuthAction.LOGOUT, success: true, ip: input.ip, userAgent: input.userAgent });
      return { ok: true, revokedAll: true };
    }

    if (!input.refreshToken) return { ok: true };

    const tokenHash = sha256(input.refreshToken);
    const row = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, revokedAt: true },
      });
    });

    if (!row) return { ok: true };

    if (!row.revokedAt) {
      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      });
    }

    await this.audit({ tenant, userId: row.userId, action: AuthAction.LOGOUT, success: true, ip: input.ip, userAgent: input.userAgent });
    return { ok: true };
  }

  // ─── Profile getters ───────────────────────────────────────────────────────

  async getDoctorProfile(userId: string, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.doctorProfile.findUnique({
        where: { userId },
        select: { id: true, fullName: true, email: true, phone: true, license: true, profilePicture: true },
      }),
    );
    if (!profile) throw new BadRequestException("Profil dokter tidak ditemukan");
    return profile;
  }

  async getAdminProfile(userId: string, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.adminProfile.findUnique({
        where: { userId },
        select: { id: true, fullName: true, email: true, phone: true, adminId: true, profilePicture: true },
      }),
    );
    if (!profile) throw new BadRequestException("Profil admin tidak ditemukan");
    return profile;
  }

  async getPatientProfile(userId: string, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.patientProfile.findUnique({
        where: { userId },
        select: { id: true, fullName: true, email: true, phone: true, bornDate: true, profilePicture: true },
      }),
    );
    if (!profile) throw new BadRequestException("Profil pasien tidak ditemukan");
    return profile;
  }

  async getNurseProfile(userId: string, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.nurseProfile.findUnique({
        where: { userId },
        select: { id: true, fullName: true, email: true, phone: true, nurseId: true, profilePicture: true },
      }),
    );
    if (!profile) throw new BadRequestException("Profil nurse tidak ditemukan");
    return profile;
  }

  // ─── Profile updaters ──────────────────────────────────────────────────────

  async updateDoctorProfile(userId: string, input: { fullName?: string; phone?: string; password?: string }, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.doctorProfile.findUnique({ where: { userId } }),
    );
    if (!profile) throw new BadRequestException("Profil dokter tidak ditemukan");

    const data: Record<string, any> = {};
    if (input.fullName?.trim()) data.fullName = input.fullName.trim();

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);
      const existing = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
        tx.doctorProfile.findFirst({ where: { phone, id: { not: profile.id } }, select: { id: true } }),
      );
      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const updated = await tx.doctorProfile.update({
        where: { userId },
        data,
        select: { id: true, fullName: true, email: true, phone: true, license: true },
      });
      if (data.fullName) await tx.user.update({ where: { id: userId }, data: { name: data.fullName } });
      return updated;
    });
  }

  async updateAdminProfile(userId: string, input: { fullName?: string; phone?: string; password?: string }, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.adminProfile.findUnique({ where: { userId } }),
    );
    if (!profile) throw new BadRequestException("Profil admin tidak ditemukan");

    const data: Record<string, any> = {};
    if (input.fullName?.trim()) data.fullName = input.fullName.trim();

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);
      const existing = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
        tx.adminProfile.findFirst({ where: { phone, id: { not: profile.id } }, select: { id: true } }),
      );
      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const updated = await tx.adminProfile.update({
        where: { userId },
        data,
        select: { id: true, fullName: true, email: true, phone: true, adminId: true },
      });
      if (data.fullName) await tx.user.update({ where: { id: userId }, data: { name: data.fullName } });
      return updated;
    });
  }

  async updatePatientProfile(userId: string, input: { fullName?: string; phone?: string; bornDate?: string; password?: string }, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.patientProfile.findUnique({ where: { userId } }),
    );
    if (!profile) throw new BadRequestException("Profil pasien tidak ditemukan");

    const data: Record<string, any> = {};
    if (input.fullName?.trim()) data.fullName = input.fullName.trim();

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);
      const existing = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
        tx.patientProfile.findFirst({ where: { phone, id: { not: profile.id } }, select: { id: true } }),
      );
      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.bornDate?.trim()) {
      const bornDate = parseBornDate(input.bornDate);
      ensureMinimumAge(bornDate!, 17);
      data.bornDate = bornDate;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const updated = await tx.patientProfile.update({
        where: { userId },
        data,
        select: { id: true, fullName: true, email: true, phone: true, bornDate: true },
      });
      if (data.fullName) await tx.user.update({ where: { id: userId }, data: { name: data.fullName } });
      return updated;
    });
  }

  async updateNurseProfile(userId: string, input: { fullName?: string; phone?: string; password?: string }, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.nurseProfile.findUnique({ where: { userId } }),
    );
    if (!profile) throw new BadRequestException("Profil nurse tidak ditemukan");

    const data: Record<string, any> = {};
    if (input.fullName?.trim()) data.fullName = input.fullName.trim();

    if (input.phone?.trim()) {
      const phone = normalizePhone(input.phone);
      ensurePhoneDigits(input.phone, phone);
      const existing = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
        tx.nurseProfile.findFirst({ where: { phone, id: { not: profile.id } }, select: { id: true } }),
      );
      if (existing) throw new BadRequestException("Nomor telepon sudah digunakan");
      data.phone = phone;
    }

    if (input.password?.trim()) {
      ensurePasswordPolicy(input.password);
      data.passwordHash = await this.hashPassword(input.password);
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const updated = await tx.nurseProfile.update({
        where: { userId },
        data,
        select: { id: true, fullName: true, email: true, phone: true, nurseId: true },
      });
      if (data.fullName) await tx.user.update({ where: { id: userId }, data: { name: data.fullName } });
      return updated;
    });
  }

  // ─── Email change flow ─────────────────────────────────────────────────────

  async requestEmailChange(userId: string, input: { newEmail: string; password: string }, tenant: TenantContext) {
    const newEmail = normalizeEmail(input.newEmail);

    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.findProfileByUserIdInTx(tx, userId),
    );
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");
    if (!profile.passwordHash)
      throw new BadRequestException("Akun tanpa password tidak bisa mengganti email dengan cara ini");

    const passwordOk = await this.verifyPassword(input.password, profile.passwordHash);
    if (!passwordOk) throw new UnauthorizedException("Password salah");

    const taken = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const [d, a, p, n] = await Promise.all([
        tx.doctorProfile.findFirst({ where: { email: newEmail, userId: { not: userId } }, select: { id: true } }),
        tx.adminProfile.findFirst({ where: { email: newEmail, userId: { not: userId } }, select: { id: true } }),
        tx.patientProfile.findFirst({ where: { email: newEmail, userId: { not: userId } }, select: { id: true } }),
        tx.nurseProfile.findFirst({ where: { email: newEmail, userId: { not: userId } }, select: { id: true } }),
      ]);
      return !!(d || a || p || n);
    });
    if (taken) throw new BadRequestException("Email sudah digunakan di akun lain");

    const verificationCode = randomVerificationCode(6);
    const codeHash = sha256(verificationCode);
    const expiresAt = new Date(Date.now() + 30 * 60_000);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.pendingEmailChange.deleteMany({ where: { userId } });
      await tx.pendingEmailChange.create({
        data: { tenantId: tenant.id, userId, newEmail, tokenHash: codeHash, expiresAt },
      });
    });

    try {
      await this.sendVerificationEmail(newEmail, verificationCode);
    } catch {
      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.pendingEmailChange.deleteMany({ where: { userId } });
      });
      throw new BadRequestException("Gagal mengirim email verifikasi");
    }

    return { ok: true, expiresInMinutes: 30 };
  }

  async confirmEmailChange(userId: string, input: { newEmail: string; code: string }, tenant: TenantContext) {
    const newEmail = normalizeEmail(input.newEmail);
    const codeHash = sha256((input.code || "").trim());

    const pending = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.pendingEmailChange.findFirst({ where: { userId, newEmail, expiresAt: { gt: new Date() } } }),
    );
    if (!pending || pending.tokenHash !== codeHash)
      throw new BadRequestException("Kode verifikasi tidak valid atau sudah expired");

    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.findProfileByUserIdInTx(tx, userId),
    );
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const role = profile.user.role;
      if (role === UserRole.DOCTOR) await tx.doctorProfile.update({ where: { userId }, data: { email: newEmail } });
      else if (role === UserRole.ADMIN) await tx.adminProfile.update({ where: { userId }, data: { email: newEmail } });
      else if (role === UserRole.NURSE) await tx.nurseProfile.update({ where: { userId }, data: { email: newEmail } });
      else await tx.patientProfile.update({ where: { userId }, data: { email: newEmail } });
      await tx.pendingEmailChange.delete({ where: { id: pending.id } });
    });

    return { ok: true };
  }

  // ─── Password reset flow ───────────────────────────────────────────────────

  async requestPasswordReset(userId: string, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.findProfileByUserIdInTx(tx, userId),
    );
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");
    if (!profile.passwordHash) throw new BadRequestException("Akun tanpa password tidak bisa menggunakan fitur ini");

    const verificationCode = randomVerificationCode(6);
    const codeHash = sha256(verificationCode);
    const expiresAt = new Date(Date.now() + 10 * 60_000);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.pendingPasswordReset.deleteMany({ where: { userId } });
      await tx.pendingPasswordReset.create({
        data: { tenantId: tenant.id, userId, tokenHash: codeHash, expiresAt },
      });
    });

    try {
      await this.sendVerificationEmail(profile.email, verificationCode);
    } catch {
      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.pendingPasswordReset.deleteMany({ where: { userId } });
      });
      throw new BadRequestException("Gagal mengirim kode verifikasi");
    }

    return { ok: true, expiresInMinutes: 10 };
  }

  async verifyResetCode(userId: string, code: string, tenant: TenantContext) {
    const codeHash = sha256((code || "").trim());
    const pending = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.pendingPasswordReset.findFirst({ where: { userId, expiresAt: { gt: new Date() } } }),
    );
    if (!pending || pending.tokenHash !== codeHash)
      throw new BadRequestException("Kode verifikasi tidak valid atau sudah expired");
    return { ok: true };
  }

  async setNewPassword(userId: string, input: { code: string; newPassword: string }, tenant: TenantContext) {
    const codeHash = sha256((input.code || "").trim());
    ensurePasswordPolicy(input.newPassword);

    const pending = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.pendingPasswordReset.findFirst({ where: { userId, expiresAt: { gt: new Date() } } }),
    );
    if (!pending || pending.tokenHash !== codeHash)
      throw new BadRequestException("Kode verifikasi tidak valid atau sudah expired");

    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.findProfileByUserIdInTx(tx, userId),
    );
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    const passwordHash = await this.hashPassword(input.newPassword);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const role = profile.user.role;
      if (role === UserRole.DOCTOR) await tx.doctorProfile.update({ where: { userId }, data: { passwordHash } });
      else if (role === UserRole.ADMIN) await tx.adminProfile.update({ where: { userId }, data: { passwordHash } });
      else if (role === UserRole.NURSE) await tx.nurseProfile.update({ where: { userId }, data: { passwordHash } });
      else await tx.patientProfile.update({ where: { userId }, data: { passwordHash } });
      await tx.pendingPasswordReset.delete({ where: { id: pending.id } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });

    return { ok: true };
  }

  // ─── Profile picture ───────────────────────────────────────────────────────

  async uploadProfilePicture(userId: string, filePath: string, tenant: TenantContext) {
    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.findProfileByUserIdInTx(tx, userId),
    );
    if (!profile) throw new BadRequestException("Profil tidak ditemukan");

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const role = profile.user.role;
      if (role === UserRole.DOCTOR) await tx.doctorProfile.update({ where: { userId }, data: { profilePicture: filePath } });
      else if (role === UserRole.ADMIN) await tx.adminProfile.update({ where: { userId }, data: { profilePicture: filePath } });
      else if (role === UserRole.NURSE) await tx.nurseProfile.update({ where: { userId }, data: { profilePicture: filePath } });
      else await tx.patientProfile.update({ where: { userId }, data: { profilePicture: filePath } });
    });

    return { ok: true, profilePicture: filePath };
  }
}
