import {
  Body,
  Controller,
  Put,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { join, extname } from "path";
import { existsSync, mkdirSync } from "fs";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { JwtPayload } from "../auth/types/jwt-payload";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CurrentTenant } from "../tenant/tenant.decorator";
import type { TenantContext } from "../tenant/tenant.interface";
import { AuthService } from "../auth/auth.service";
import {
  UpdateDoctorProfileDto,
  UpdateAdminProfileDto,
  UpdatePatientProfileDto,
  UpdateNurseProfileDto,
} from "../auth/dto/update-profile.dto";
import {
  ChangeEmailRequestDto,
  ConfirmEmailChangeDto,
  SetNewPasswordDto,
} from "../auth/dto/profile-management.dto";

// Per-tenant storage: uploads/profiles/{tenantSlug}/{filename}
const pictureStorage = diskStorage({
  destination: (req, _file, cb) => {
    const slug = (req as any).tenant?.slug || "unknown";
    const dir = join(process.cwd(), "uploads", "profiles", slug);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || "." + file.mimetype.split("/")[1];
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/svg+xml", "image/avif"];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

@Controller("profile")
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(private auth: AuthService) {}

  // ─── GET profile ─────────────────────────────────────────────────────────────

  @Get("doctor")
  getDoctorProfile(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.getDoctorProfile(user.sub, tenant);
  }

  @Get("admin")
  getAdminProfile(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.getAdminProfile(user.sub, tenant);
  }

  @Get("patient")
  getPatientProfile(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.getPatientProfile(user.sub, tenant);
  }

  @Get("nurse")
  getNurseProfile(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.getNurseProfile(user.sub, tenant);
  }

  // ─── UPDATE profile ───────────────────────────────────────────────────────────

  @Put("doctor")
  updateDoctorProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDoctorProfileDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.updateDoctorProfile(user.sub, dto, tenant);
  }

  @Put("admin")
  updateAdminProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAdminProfileDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.updateAdminProfile(user.sub, dto, tenant);
  }

  @Put("patient")
  updatePatientProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePatientProfileDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.updatePatientProfile(user.sub, dto, tenant);
  }

  @Put("nurse")
  updateNurseProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateNurseProfileDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.updateNurseProfile(user.sub, dto, tenant);
  }

  // ─── EMAIL CHANGE flow ────────────────────────────────────────────────────────

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("doctor/change-email")
  requestEmailChangeDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.requestEmailChange(user.sub, dto, tenant);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("admin/change-email")
  requestEmailChangeAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.requestEmailChange(user.sub, dto, tenant);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("patient/change-email")
  requestEmailChangePatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.requestEmailChange(user.sub, dto, tenant);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("nurse/change-email")
  requestEmailChangeNurse(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailRequestDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.requestEmailChange(user.sub, dto, tenant);
  }

  @Post("doctor/confirm-email-change")
  confirmEmailChangeDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto, tenant);
  }

  @Post("admin/confirm-email-change")
  confirmEmailChangeAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto, tenant);
  }

  @Post("patient/confirm-email-change")
  confirmEmailChangePatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto, tenant);
  }

  @Post("nurse/confirm-email-change")
  confirmEmailChangeNurse(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmEmailChangeDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.confirmEmailChange(user.sub, dto, tenant);
  }

  // ─── PASSWORD RESET flow ──────────────────────────────────────────────────────

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("doctor/forgot-password")
  requestPasswordResetDoctor(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.requestPasswordReset(user.sub, tenant);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("admin/forgot-password")
  requestPasswordResetAdmin(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.requestPasswordReset(user.sub, tenant);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("patient/forgot-password")
  requestPasswordResetPatient(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.requestPasswordReset(user.sub, tenant);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("nurse/forgot-password")
  requestPasswordResetNurse(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: TenantContext) {
    return this.auth.requestPasswordReset(user.sub, tenant);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("doctor/verify-reset-code")
  verifyResetCodeDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code, tenant);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("admin/verify-reset-code")
  verifyResetCodeAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code, tenant);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("patient/verify-reset-code")
  verifyResetCodePatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code, tenant);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("nurse/verify-reset-code")
  verifyResetCodeNurse(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { code: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.verifyResetCode(user.sub, dto.code, tenant);
  }

  @Post("doctor/set-new-password")
  setNewPasswordDoctor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.setNewPassword(user.sub, dto, tenant);
  }

  @Post("admin/set-new-password")
  setNewPasswordAdmin(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.setNewPassword(user.sub, dto, tenant);
  }

  @Post("patient/set-new-password")
  setNewPasswordPatient(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.setNewPassword(user.sub, dto, tenant);
  }

  @Post("nurse/set-new-password")
  setNewPasswordNurse(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetNewPasswordDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.auth.setNewPassword(user.sub, dto, tenant);
  }

  // ─── PROFILE PICTURE upload ───────────────────────────────────────────────────

  @Post("doctor/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  uploadPictureDoctor(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.handleUpload(user.sub, file, tenant);
  }

  @Post("admin/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  uploadPictureAdmin(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.handleUpload(user.sub, file, tenant);
  }

  @Post("patient/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  uploadPicturePatient(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.handleUpload(user.sub, file, tenant);
  }

  @Post("nurse/upload-picture")
  @UseInterceptors(FileInterceptor("file", { storage: pictureStorage }))
  uploadPictureNurse(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.handleUpload(user.sub, file, tenant);
  }

  private handleUpload(userId: string, file: Express.Multer.File, tenant: TenantContext) {
    if (!file) throw new BadRequestException("File harus disertakan");

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException("Format file hanya boleh JPG, JPEG, PNG, SVG, atau AVIF");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException("Ukuran file maksimal 2MB");
    }

    // Path: uploads/profiles/{tenantSlug}/{filename} — served by ServeStaticModule
    const relativePath = `uploads/profiles/${tenant.slug}/${file.filename}`;
    return this.auth.uploadProfilePicture(userId, relativePath, tenant);
  }
}
