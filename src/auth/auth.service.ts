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
import { AuthAction, OAuthProvider, UserRole } from "@prisma/client";
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
const OAUTH_STATE_TTL_MINUTES = 10;

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

interface TenantRow {
  id: string;
  slug: string;
  schema_name: string;
  status: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private accessTtl = process.env.JWT_ACCESS_TTL || "60m";
  private refreshTtl = process.env.JWT_REFRESH_TTL || "30d";
  private frontendBaseUrl = process.env.APP_PUBLIC_BASE_URL || "http://localhost:3000";
  private backendBaseUrl = process.env.APP_BASE_URL || "http://localhost:4000";

  // ─── Internal tenant resolution (for OAuth callback) ──────────────────────

  private async resolveTenantBySlug(slug: string): Promise<TenantContext> {
    const rows = await this.prisma.$queryRaw<TenantRow[]>`
      SELECT id, slug, schema_name, status
      FROM public.tenant_registry
      WHERE slug = ${slug}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.status !== "active") {
      throw new BadRequestException("Tenant tidak valid");
    }
    return { id: row.id, slug: row.slug, schemaName: row.schema_name };
  }

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

  private parseProvider(raw: string): OAuthProvider {
    const v = String(raw || "").trim().toUpperCase();
    if (v === "GOOGLE") return OAuthProvider.GOOGLE;
    if (v === "MICROSOFT") return OAuthProvider.MICROSOFT;
    throw new BadRequestException("Provider OAuth tidak valid");
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

  private async purgeExpiredPendingRegistrations(tenantSlug: string) {
    await this.prisma.pendingRegistration.deleteMany({
      where: { tenantSlug, expiresAt: { lte: new Date() } },
    });
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

  // ─── OAuth provider helpers ────────────────────────────────────────────────

  private getProviderRedirectUri(provider: OAuthProvider) {
    if (provider === OAuthProvider.GOOGLE) {
      return (
        process.env.OAUTH_GOOGLE_REDIRECT_URI ||
        `${this.backendBaseUrl}/auth/oauth/google/callback`
      );
    }
    return (
      process.env.OAUTH_MICROSOFT_REDIRECT_URI ||
      `${this.backendBaseUrl}/auth/oauth/microsoft/callback`
    );
  }

  private async fetchGoogleProfile(code: string) {
    const redirectUri = this.getProviderRedirectUri(OAuthProvider.GOOGLE);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.OAUTH_GOOGLE_CLIENT_ID || "",
        client_secret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) throw new BadRequestException("OAuth Google gagal");

    const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const userJson = await userRes.json();

    return {
      email: userJson.email as string | undefined,
      name: userJson.name as string | undefined,
      providerUserId: userJson.sub as string,
    };
  }

  private async fetchMicrosoftProfile(code: string) {
    const redirectUri = this.getProviderRedirectUri(OAuthProvider.MICROSOFT);
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.OAUTH_MICROSOFT_CLIENT_ID || "",
          client_secret: process.env.OAUTH_MICROSOFT_CLIENT_SECRET || "",
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          scope: "openid email profile",
        }).toString(),
      },
    );

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) throw new BadRequestException("OAuth Microsoft gagal");

    const userRes = await fetch("https://graph.microsoft.com/oidc/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const userJson = await userRes.json();

    return {
      email: (userJson.email || userJson.preferred_username) as string | undefined,
      name: userJson.name as string | undefined,
      providerUserId: (userJson.sub || userJson.oid) as string,
    };
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
      throw new UnauthorizedException(
        "Akun ini menggunakan OAuth. Silakan login via Google/Microsoft",
      );
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

  async register(
    input: {
      role: UserRole;
      fullName: string;
      email: string;
      phone: string;
      password: string;
      confirmPassword: string;
      license?: string;
      adminId?: string;
      nurseId?: string;
      bornDate?: string;
    },
    tenant: TenantContext,
  ) {
    const role = input.role;
    const name = (input.fullName || "").trim();
    const email = normalizeEmail(input.email || "");
    const phone = normalizePhone(input.phone || "");

    if (!name) throw new BadRequestException("Nama lengkap wajib diisi");
    if (!email) throw new BadRequestException("Email wajib diisi");
    ensurePhoneDigits(input.phone || "", phone);
    ensurePasswordPolicy(input.password);

    if (input.password !== input.confirmPassword)
      throw new BadRequestException("Konfirmasi password tidak sama");

    await this.purgeExpiredPendingRegistrations(tenant.slug);

    const existingPending = await this.prisma.pendingRegistration.findFirst({
      where: { email, tenantSlug: tenant.slug, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    await this.ensureEmailPhoneAvailable(email, phone, tenant, {
      excludePendingId: existingPending?.id,
    });

    if (role === UserRole.DOCTOR) {
      if (!input.license?.trim()) throw new BadRequestException("License wajib diisi");
      await this.ensureLicenseValid(input.license.trim(), tenant, {
        excludePendingId: existingPending?.id,
      });
    }

    if (role === UserRole.ADMIN) {
      if (!input.adminId?.trim()) throw new BadRequestException("Admin ID wajib diisi");
      await this.ensureAdminIdValid(input.adminId.trim(), tenant, {
        excludePendingId: existingPending?.id,
      });
    }

    if (role === UserRole.NURSE) {
      if (!input.nurseId?.trim()) throw new BadRequestException("Nurse ID wajib diisi");
      await this.ensureNurseIdValid(input.nurseId.trim(), tenant, {
        excludePendingId: existingPending?.id,
      });
    }

    if (role === UserRole.PATIENT) {
      const bornDate = parseBornDate(input.bornDate);
      if (!bornDate) throw new BadRequestException("Tanggal lahir wajib diisi");
      ensureMinimumAge(bornDate, 17);
    }

    const verificationCode = randomVerificationCode(6);
    const codeHash = sha256(verificationCode);
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000);
    const passwordHash = await this.hashPassword(input.password);
    const parsedBornDate = role === UserRole.PATIENT ? parseBornDate(input.bornDate) : null;

    const pending = existingPending
      ? await this.prisma.pendingRegistration.update({
          where: { id: existingPending.id },
          data: {
            role, email, phone, name, passwordHash,
            license: input.license?.trim() || null,
            adminId: input.adminId?.trim() || null,
            nurseId: input.nurseId?.trim() || null,
            bornDate: parsedBornDate,
            tokenHash: codeHash,
            expiresAt,
          },
          select: { id: true },
        })
      : await this.prisma.pendingRegistration.create({
          data: {
            tenantSlug: tenant.slug,
            role, email, phone, name, passwordHash,
            license: input.license?.trim() || null,
            adminId: input.adminId?.trim() || null,
            nurseId: input.nurseId?.trim() || null,
            bornDate: parsedBornDate,
            tokenHash: codeHash,
            expiresAt,
          },
          select: { id: true },
        });

    try {
      await this.sendVerificationEmail(email, verificationCode);
    } catch {
      await this.prisma.pendingRegistration.delete({ where: { id: pending.id } });
      throw new BadRequestException("Gagal mengirim email verifikasi");
    }

    await this.audit({ tenant, email, action: AuthAction.REGISTER, success: true });

    return { ok: true, expiresInMinutes: VERIFY_TTL_MINUTES };
  }

  async verifyEmail(input: { email: string; code: string }, tenant: TenantContext) {
    const email = normalizeEmail(input.email || "");
    const rawCode = (input.code || "").trim();
    const codeHash = sha256(rawCode);

    if (!email) throw new BadRequestException("Email wajib diisi");
    if (!rawCode) throw new BadRequestException("Kode verifikasi wajib diisi");

    await this.purgeExpiredPendingRegistrations(tenant.slug);

    const pending = await this.prisma.pendingRegistration.findFirst({
      where: { email, tenantSlug: tenant.slug, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!pending) throw new BadRequestException("Kode verifikasi tidak valid atau expired");
    if (pending.tokenHash !== codeHash)
      throw new BadRequestException("Kode verifikasi tidak valid atau expired");

    await this.ensureEmailPhoneAvailable(pending.email, pending.phone, tenant, {
      excludePendingId: pending.id,
    });

    if (pending.role === UserRole.DOCTOR && pending.license)
      await this.ensureLicenseValid(pending.license, tenant, { excludePendingId: pending.id });
    if (pending.role === UserRole.ADMIN && pending.adminId)
      await this.ensureAdminIdValid(pending.adminId, tenant, { excludePendingId: pending.id });
    if (pending.role === UserRole.NURSE && pending.nurseId)
      await this.ensureNurseIdValid(pending.nurseId, tenant, { excludePendingId: pending.id });
    if (pending.role === UserRole.PATIENT && pending.bornDate)
      ensureMinimumAge(pending.bornDate, 17);

    // Create user + profile in tenant schema
    const newUser = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const twilioIdentity =
        pending.role === UserRole.DOCTOR
          ? await this.generateUniqueTwilioIdentity(tx)
          : null;

      const u = await tx.user.create({
        data: {
          tenantId: tenant.id,
          role: pending.role,
          name: pending.name,
          emailVerifiedAt: new Date(),
          isActive: true,
          twilioIdentity,
        },
      });

      if (pending.role === UserRole.DOCTOR) {
        await tx.doctorProfile.create({
          data: {
            tenantId: tenant.id,
            userId: u.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            license: pending.license!,
          },
        });
      }
      if (pending.role === UserRole.ADMIN) {
        await tx.adminProfile.create({
          data: {
            tenantId: tenant.id,
            userId: u.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            adminId: pending.adminId!,
          },
        });
      }
      if (pending.role === UserRole.PATIENT) {
        await tx.patientProfile.create({
          data: {
            tenantId: tenant.id,
            userId: u.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            bornDate: pending.bornDate!,
          },
        });
      }
      if (pending.role === UserRole.NURSE) {
        await tx.nurseProfile.create({
          data: {
            tenantId: tenant.id,
            userId: u.id,
            fullName: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            nurseId: pending.nurseId!,
          },
        });
      }

      return u;
    });

    // Delete pending (public schema) — separate from tenant transaction
    await this.prisma.pendingRegistration.delete({ where: { id: pending.id } });

    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.getProfileByUserIdInTx(tx, newUser.id, newUser.role),
    );

    const tokens = await this.issueTokens({
      userId: newUser.id,
      email: profile!.email,
      role: newUser.role,
      tenant,
      twilioIdentity: newUser.twilioIdentity,
    });

    return {
      ok: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: newUser.id,
        email: profile!.email,
        name: newUser.name,
        role: newUser.role,
        phone: profile!.phone,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        twilioIdentity: newUser.twilioIdentity,
      },
    };
  }

  async getOAuthStartUrl(
    input: { provider: string; role: string; redirectUrl?: string },
    tenant: TenantContext,
  ) {
    const provider = this.parseProvider(input.provider);
    const role = this.parseRole(input.role);

    const state = await this.prisma.oauthState.create({
      data: {
        tenantSlug: tenant.slug,
        provider,
        role,
        redirectUrl: input.redirectUrl || null,
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60_000),
      },
    });

    const redirectUri = this.getProviderRedirectUri(provider);
    if (provider === OAuthProvider.GOOGLE) {
      const params = new URLSearchParams({
        client_id: process.env.OAUTH_GOOGLE_CLIENT_ID || "",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: state.id,
        access_type: "offline",
        prompt: "consent",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const params = new URLSearchParams({
      client_id: process.env.OAUTH_MICROSOFT_CLIENT_ID || "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: state.id,
      prompt: "select_account",
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  // No tenant param — resolved internally from OauthState (OAuth callback has no X-Tenant-Slug)
  async handleOAuthCallback(input: {
    provider: string;
    query: Record<string, string | undefined>;
    ip?: string;
    userAgent?: string;
  }) {
    const provider = this.parseProvider(input.provider);

    if (input.query.error) {
      return {
        redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=${encodeURIComponent(input.query.error)}`,
      };
    }

    const code = input.query.code;
    const state = input.query.state;

    if (!code || !state) {
      return { redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=missing_code` };
    }

    const oauthState = await this.prisma.oauthState.findUnique({ where: { id: state } });
    if (!oauthState || oauthState.expiresAt.getTime() <= Date.now()) {
      return { redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=invalid_state` };
    }

    await this.prisma.oauthState.delete({ where: { id: oauthState.id } });

    // Resolve tenant from state
    let tenant: TenantContext;
    try {
      tenant = await this.resolveTenantBySlug(oauthState.tenantSlug);
    } catch {
      return { redirectUrl: `${this.frontendBaseUrl}/auth/oauth/success?error=invalid_tenant` };
    }

    // Build tenant-specific frontend URL
    const tenantFrontendUrl = this.frontendBaseUrl.includes("localhost")
      ? this.frontendBaseUrl
      : `https://${tenant.slug}.${this.frontendBaseUrl.replace(/^https?:\/\//, "")}`;

    let oauthProfile: { email?: string; name?: string; providerUserId: string };
    try {
      oauthProfile =
        provider === OAuthProvider.GOOGLE
          ? await this.fetchGoogleProfile(code)
          : await this.fetchMicrosoftProfile(code);
    } catch {
      return { redirectUrl: `${tenantFrontendUrl}/auth/oauth/success?error=oauth_failed` };
    }

    const email = normalizeEmail(oauthProfile.email || "");
    if (!email)
      return { redirectUrl: `${tenantFrontendUrl}/auth/oauth/success?error=missing_email` };
    if (!oauthProfile.providerUserId)
      return { redirectUrl: `${tenantFrontendUrl}/auth/oauth/success?error=missing_account` };

    const existingProfile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.findProfileByIdentifierInTx(tx, { email }),
    );
    const existingUser = existingProfile?.user;

    if (existingUser && existingUser.role !== oauthState.role) {
      return { redirectUrl: `${tenantFrontendUrl}/auth/oauth/success?error=email_used` };
    }

    if (existingUser) {
      if (!existingUser.isActive) {
        return { redirectUrl: `${tenantFrontendUrl}/auth/oauth/success?error=inactive` };
      }

      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.oauthAccount.upsert({
          where: {
            provider_providerUserId_tenantId: {
              provider,
              providerUserId: oauthProfile.providerUserId,
              tenantId: tenant.id,
            },
          },
          update: { userId: existingUser.id, email },
          create: {
            tenantId: tenant.id,
            userId: existingUser.id,
            provider,
            providerUserId: oauthProfile.providerUserId,
            email,
          },
        });
      });

      const tokens = await this.issueTokens({
        userId: existingUser.id,
        email: existingProfile!.email,
        role: existingUser.role,
        tenant,
        twilioIdentity: existingUser.twilioIdentity,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      await this.audit({
        tenant,
        userId: existingUser.id,
        email: existingProfile!.email,
        action: AuthAction.LOGIN,
        success: true,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return {
        redirectUrl: `${tenantFrontendUrl}/auth/oauth/success?accessToken=${encodeURIComponent(tokens.accessToken)}`,
        refreshToken: tokens.refreshToken,
      };
    }

    // New user — create OauthPending (public schema)
    const pending = await this.prisma.oauthPending.upsert({
      where: {
        provider_providerUserId_tenantSlug: {
          provider,
          providerUserId: oauthProfile.providerUserId,
          tenantSlug: tenant.slug,
        },
      },
      update: {
        role: oauthState.role,
        email,
        name: oauthProfile.name || null,
        expiresAt: new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000),
      },
      create: {
        tenantSlug: tenant.slug,
        provider,
        role: oauthState.role,
        providerUserId: oauthProfile.providerUserId,
        email,
        name: oauthProfile.name || null,
        expiresAt: new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000),
      },
    });

    return {
      redirectUrl: `${tenantFrontendUrl}/auth/oauth/complete?token=${pending.id}&role=${pending.role}`,
    };
  }

  async completeOAuth(
    input: {
      token: string;
      phone: string;
      name?: string;
      license?: string;
      adminId?: string;
      nurseId?: string;
      bornDate?: string;
      ip?: string;
      userAgent?: string;
    },
    tenant: TenantContext,
  ) {
    const pending = await this.prisma.oauthPending.findUnique({ where: { id: input.token } });

    if (!pending) throw new BadRequestException("Token OAuth tidak valid");
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.prisma.oauthPending.delete({ where: { id: pending.id } });
      throw new BadRequestException("Token OAuth sudah expired");
    }

    // Verify pending belongs to same tenant
    if (pending.tenantSlug !== tenant.slug)
      throw new BadRequestException("Token OAuth tidak valid untuk tenant ini");

    const email = normalizeEmail(pending.email);
    const phone = normalizePhone(input.phone || "");
    ensurePhoneDigits(input.phone || "", phone);

    const name = (input.name || pending.name || "").trim();
    if (!name) throw new BadRequestException("Nama lengkap wajib diisi");

    await this.ensureEmailPhoneAvailable(email, phone, tenant);

    if (pending.role === UserRole.DOCTOR) {
      const license = (input.license || "").trim();
      if (!license) throw new BadRequestException("License wajib diisi");
      await this.ensureLicenseValid(license, tenant);
    }
    if (pending.role === UserRole.ADMIN) {
      const adminId = (input.adminId || "").trim();
      if (!adminId) throw new BadRequestException("Admin ID wajib diisi");
      await this.ensureAdminIdValid(adminId, tenant);
    }
    if (pending.role === UserRole.NURSE) {
      const nurseId = (input.nurseId || "").trim();
      if (!nurseId) throw new BadRequestException("Nurse ID wajib diisi");
      await this.ensureNurseIdValid(nurseId, tenant);
    }
    if (pending.role === UserRole.PATIENT) {
      const bornDate = parseBornDate(input.bornDate);
      if (!bornDate) throw new BadRequestException("Tanggal lahir wajib diisi");
      ensureMinimumAge(bornDate, 17);
    }

    const created = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const twilioIdentity =
        pending.role === UserRole.DOCTOR
          ? await this.generateUniqueTwilioIdentity(tx)
          : null;

      const u = await tx.user.create({
        data: {
          tenantId: tenant.id,
          role: pending.role,
          name,
          emailVerifiedAt: new Date(),
          isActive: true,
          twilioIdentity,
        },
      });

      if (pending.role === UserRole.DOCTOR)
        await tx.doctorProfile.create({
          data: { tenantId: tenant.id, userId: u.id, fullName: name, email, phone, passwordHash: null, license: input.license!.trim() },
        });
      if (pending.role === UserRole.ADMIN)
        await tx.adminProfile.create({
          data: { tenantId: tenant.id, userId: u.id, fullName: name, email, phone, passwordHash: null, adminId: input.adminId!.trim() },
        });
      if (pending.role === UserRole.NURSE)
        await tx.nurseProfile.create({
          data: { tenantId: tenant.id, userId: u.id, fullName: name, email, phone, passwordHash: null, nurseId: input.nurseId!.trim() },
        });
      if (pending.role === UserRole.PATIENT)
        await tx.patientProfile.create({
          data: { tenantId: tenant.id, userId: u.id, fullName: name, email, phone, passwordHash: null, bornDate: parseBornDate(input.bornDate)! },
        });

      await tx.oauthAccount.create({
        data: { tenantId: tenant.id, userId: u.id, provider: pending.provider, providerUserId: pending.providerUserId, email },
      });

      return u;
    });

    await this.prisma.oauthPending.delete({ where: { id: pending.id } });

    const tokens = await this.issueTokens({
      userId: created.id,
      email,
      role: created.role,
      tenant,
      twilioIdentity: created.twilioIdentity,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: created.id,
        email,
        name: created.name,
        role: created.role,
        phone,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        twilioIdentity: created.twilioIdentity,
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

  async oauthSession(
    input: { accessToken: string; ip?: string; userAgent?: string },
    tenant: TenantContext,
  ) {
    if (!input.accessToken) throw new UnauthorizedException("Access token wajib diisi");

    let payload: JwtPayload | null = null;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(input.accessToken, {
        secret: process.env.JWT_ACCESS_SECRET!,
      });
    } catch {
      throw new UnauthorizedException("Access token invalid");
    }

    if (!payload?.sub) throw new UnauthorizedException("Access token invalid");
    if (payload.tenantSlug !== tenant.slug) throw new UnauthorizedException("Token tenant mismatch");

    const user = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      tx.user.findUnique({ where: { id: payload!.sub } }),
    );
    if (!user || !user.isActive) throw new UnauthorizedException("Invalid token");

    const profile = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) =>
      this.getProfileByUserIdInTx(tx, user.id, user.role),
    );
    if (!profile) throw new UnauthorizedException("Profil user tidak ditemukan");

    const tokens = await this.issueTokens({
      userId: user.id,
      email: profile.email,
      role: user.role,
      tenant,
      twilioIdentity: user.twilioIdentity,
      ip: input.ip,
      userAgent: input.userAgent,
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
      throw new BadRequestException("Akun OAuth tidak bisa mengganti email dengan cara ini");

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
    if (!profile.passwordHash) throw new BadRequestException("Akun OAuth tidak bisa menggunakan fitur ini");

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
