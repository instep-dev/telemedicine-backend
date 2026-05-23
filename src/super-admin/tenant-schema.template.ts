/**
 * Returns ordered array of DDL statements to provision a new tenant schema.
 * All names are schema-qualified so no SET search_path is required.
 * schemaName example: "tenant_alfamedika"
 */
export function getTenantSchemaDDL(schemaName: string): string[] {
  const s = schemaName;
  return [
    // ── Schema ────────────────────────────────────────────────────────────────
    `CREATE SCHEMA "${s}"`,

    // ── Enums ─────────────────────────────────────────────────────────────────
    `CREATE TYPE "${s}"."UserRole" AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE')`,
    `CREATE TYPE "${s}"."OAuthProvider" AS ENUM ('GOOGLE', 'MICROSOFT')`,
    `CREATE TYPE "${s}"."SessionType" AS ENUM ('SCHEDULED', 'INSTANT')`,
    `CREATE TYPE "${s}"."ConsultationMode" AS ENUM ('VIDEO', 'VOICE')`,
    `CREATE TYPE "${s}"."SessionStatus" AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED')`,
    `CREATE TYPE "${s}"."AuthAction" AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE')`,

    // ── User ──────────────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."User" (
      "id"              TEXT         PRIMARY KEY,
      "tenantId"        TEXT         NOT NULL,
      "role"            "${s}"."UserRole" NOT NULL,
      "name"            TEXT         NOT NULL,
      "twilioIdentity"  TEXT,
      "isActive"        BOOLEAN      NOT NULL DEFAULT true,
      "emailVerifiedAt" TIMESTAMP(3),
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"       TIMESTAMP(3) NOT NULL
    )`,
    `CREATE UNIQUE INDEX "User_twilioIdentity_tenantId_key" ON "${s}"."User"("twilioIdentity","tenantId")`,
    `CREATE INDEX "User_tenantId_idx"      ON "${s}"."User"("tenantId")`,
    `CREATE INDEX "User_tenantId_role_idx" ON "${s}"."User"("tenantId","role")`,
    `CREATE INDEX "User_role_idx"          ON "${s}"."User"("role")`,
    `CREATE INDEX "User_isActive_idx"      ON "${s}"."User"("isActive")`,

    // ── DoctorProfile ─────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."DoctorProfile" (
      "id"             TEXT         PRIMARY KEY,
      "tenantId"       TEXT         NOT NULL,
      "userId"         TEXT         NOT NULL UNIQUE,
      "fullName"       TEXT         NOT NULL,
      "email"          TEXT         NOT NULL,
      "phone"          TEXT         NOT NULL,
      "passwordHash"   TEXT,
      "license"        TEXT         NOT NULL,
      "profilePicture" TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL,
      CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX "DoctorProfile_email_tenantId_key"   ON "${s}"."DoctorProfile"("email","tenantId")`,
    `CREATE UNIQUE INDEX "DoctorProfile_phone_tenantId_key"   ON "${s}"."DoctorProfile"("phone","tenantId")`,
    `CREATE UNIQUE INDEX "DoctorProfile_license_tenantId_key" ON "${s}"."DoctorProfile"("license","tenantId")`,
    `CREATE INDEX "DoctorProfile_tenantId_idx" ON "${s}"."DoctorProfile"("tenantId")`,
    `CREATE INDEX "DoctorProfile_license_idx"  ON "${s}"."DoctorProfile"("license")`,

    // ── AdminProfile ──────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."AdminProfile" (
      "id"             TEXT         PRIMARY KEY,
      "tenantId"       TEXT         NOT NULL,
      "userId"         TEXT         NOT NULL UNIQUE,
      "fullName"       TEXT         NOT NULL,
      "email"          TEXT         NOT NULL,
      "phone"          TEXT         NOT NULL,
      "passwordHash"   TEXT,
      "adminId"        TEXT         NOT NULL,
      "profilePicture" TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL,
      CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX "AdminProfile_email_tenantId_key"   ON "${s}"."AdminProfile"("email","tenantId")`,
    `CREATE UNIQUE INDEX "AdminProfile_phone_tenantId_key"   ON "${s}"."AdminProfile"("phone","tenantId")`,
    `CREATE UNIQUE INDEX "AdminProfile_adminId_tenantId_key" ON "${s}"."AdminProfile"("adminId","tenantId")`,
    `CREATE INDEX "AdminProfile_tenantId_idx" ON "${s}"."AdminProfile"("tenantId")`,
    `CREATE INDEX "AdminProfile_adminId_idx"  ON "${s}"."AdminProfile"("adminId")`,

    // ── PatientProfile ────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."PatientProfile" (
      "id"             TEXT         PRIMARY KEY,
      "tenantId"       TEXT         NOT NULL,
      "userId"         TEXT         NOT NULL UNIQUE,
      "fullName"       TEXT         NOT NULL,
      "email"          TEXT         NOT NULL,
      "phone"          TEXT         NOT NULL,
      "passwordHash"   TEXT,
      "bornDate"       TIMESTAMP(3) NOT NULL,
      "profilePicture" TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL,
      CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX "PatientProfile_email_tenantId_key" ON "${s}"."PatientProfile"("email","tenantId")`,
    `CREATE UNIQUE INDEX "PatientProfile_phone_tenantId_key" ON "${s}"."PatientProfile"("phone","tenantId")`,
    `CREATE INDEX "PatientProfile_tenantId_idx" ON "${s}"."PatientProfile"("tenantId")`,

    // ── NurseProfile ──────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."NurseProfile" (
      "id"             TEXT         PRIMARY KEY,
      "tenantId"       TEXT         NOT NULL,
      "userId"         TEXT         NOT NULL UNIQUE,
      "fullName"       TEXT         NOT NULL,
      "email"          TEXT         NOT NULL,
      "phone"          TEXT         NOT NULL,
      "passwordHash"   TEXT,
      "nurseId"        TEXT         NOT NULL,
      "profilePicture" TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL,
      CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX "NurseProfile_email_tenantId_key"   ON "${s}"."NurseProfile"("email","tenantId")`,
    `CREATE UNIQUE INDEX "NurseProfile_phone_tenantId_key"   ON "${s}"."NurseProfile"("phone","tenantId")`,
    `CREATE UNIQUE INDEX "NurseProfile_nurseId_tenantId_key" ON "${s}"."NurseProfile"("nurseId","tenantId")`,
    `CREATE INDEX "NurseProfile_tenantId_idx" ON "${s}"."NurseProfile"("tenantId")`,
    `CREATE INDEX "NurseProfile_nurseId_idx"  ON "${s}"."NurseProfile"("nurseId")`,

    // ── OAuthAccount ──────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."OAuthAccount" (
      "id"             TEXT         PRIMARY KEY,
      "tenantId"       TEXT         NOT NULL,
      "userId"         TEXT         NOT NULL,
      "provider"       "${s}"."OAuthProvider" NOT NULL,
      "providerUserId" TEXT         NOT NULL,
      "email"          TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_tenantId_key" ON "${s}"."OAuthAccount"("provider","providerUserId","tenantId")`,
    `CREATE INDEX "OAuthAccount_tenantId_idx" ON "${s}"."OAuthAccount"("tenantId")`,
    `CREATE INDEX "OAuthAccount_userId_idx"   ON "${s}"."OAuthAccount"("userId")`,

    // ── RefreshToken ──────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."RefreshToken" (
      "id"                TEXT         PRIMARY KEY,
      "tenantId"          TEXT         NOT NULL,
      "userId"            TEXT         NOT NULL,
      "tokenHash"         TEXT         NOT NULL UNIQUE,
      "userAgent"         TEXT,
      "ip"                TEXT,
      "revokedAt"         TIMESTAMP(3),
      "replacedByTokenId" TEXT         UNIQUE,
      "expiresAt"         TIMESTAMP(3) NOT NULL,
      "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RefreshToken_userId_fkey"            FOREIGN KEY ("userId")            REFERENCES "${s}"."User"("id")         ON DELETE CASCADE,
      CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "${s}"."RefreshToken"("id")
    )`,
    `CREATE INDEX "RefreshToken_tenantId_idx"  ON "${s}"."RefreshToken"("tenantId")`,
    `CREATE INDEX "RefreshToken_userId_idx"    ON "${s}"."RefreshToken"("userId")`,
    `CREATE INDEX "RefreshToken_expiresAt_idx" ON "${s}"."RefreshToken"("expiresAt")`,
    `CREATE INDEX "RefreshToken_revokedAt_idx" ON "${s}"."RefreshToken"("revokedAt")`,

    // ── PendingEmailChange ────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."PendingEmailChange" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "userId"    TEXT         NOT NULL,
      "newEmail"  TEXT         NOT NULL,
      "tokenHash" TEXT         NOT NULL UNIQUE,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX "PendingEmailChange_tenantId_idx"  ON "${s}"."PendingEmailChange"("tenantId")`,
    `CREATE INDEX "PendingEmailChange_userId_idx"    ON "${s}"."PendingEmailChange"("userId")`,
    `CREATE INDEX "PendingEmailChange_expiresAt_idx" ON "${s}"."PendingEmailChange"("expiresAt")`,
    `CREATE INDEX "PendingEmailChange_newEmail_idx"  ON "${s}"."PendingEmailChange"("newEmail")`,

    // ── PendingPasswordReset ──────────────────────────────────────────────────
    `CREATE TABLE "${s}"."PendingPasswordReset" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "userId"    TEXT         NOT NULL,
      "tokenHash" TEXT         NOT NULL UNIQUE,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PendingPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX "PendingPasswordReset_tenantId_idx"  ON "${s}"."PendingPasswordReset"("tenantId")`,
    `CREATE INDEX "PendingPasswordReset_userId_idx"    ON "${s}"."PendingPasswordReset"("userId")`,
    `CREATE INDEX "PendingPasswordReset_expiresAt_idx" ON "${s}"."PendingPasswordReset"("expiresAt")`,

    // ── Whitelist tables ──────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."LicenseWhitelist" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "license"   TEXT         NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX "LicenseWhitelist_license_tenantId_key" ON "${s}"."LicenseWhitelist"("license","tenantId")`,
    `CREATE INDEX "LicenseWhitelist_tenantId_idx" ON "${s}"."LicenseWhitelist"("tenantId")`,

    `CREATE TABLE "${s}"."AdminIdWhitelist" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "adminId"   TEXT         NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX "AdminIdWhitelist_adminId_tenantId_key" ON "${s}"."AdminIdWhitelist"("adminId","tenantId")`,
    `CREATE INDEX "AdminIdWhitelist_tenantId_idx" ON "${s}"."AdminIdWhitelist"("tenantId")`,

    `CREATE TABLE "${s}"."NurseIdWhitelist" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "nurseId"   TEXT         NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX "NurseIdWhitelist_nurseId_tenantId_key" ON "${s}"."NurseIdWhitelist"("nurseId","tenantId")`,
    `CREATE INDEX "NurseIdWhitelist_tenantId_idx" ON "${s}"."NurseIdWhitelist"("tenantId")`,

    `CREATE TABLE "${s}"."MrnWhitelist" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "mrn"       TEXT         NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX "MrnWhitelist_mrn_tenantId_key" ON "${s}"."MrnWhitelist"("mrn","tenantId")`,
    `CREATE INDEX "MrnWhitelist_tenantId_idx" ON "${s}"."MrnWhitelist"("tenantId")`,

    // ── AuthAuditLog ──────────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."AuthAuditLog" (
      "id"        TEXT         PRIMARY KEY,
      "tenantId"  TEXT         NOT NULL,
      "userId"    TEXT,
      "email"     TEXT,
      "action"    "${s}"."AuthAction" NOT NULL,
      "success"   BOOLEAN      NOT NULL DEFAULT false,
      "ip"        TEXT,
      "userAgent" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "${s}"."User"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX "AuthAuditLog_tenantId_idx"           ON "${s}"."AuthAuditLog"("tenantId")`,
    `CREATE INDEX "AuthAuditLog_tenantId_createdAt_idx" ON "${s}"."AuthAuditLog"("tenantId","createdAt")`,
    `CREATE INDEX "AuthAuditLog_userId_idx"             ON "${s}"."AuthAuditLog"("userId")`,
    `CREATE INDEX "AuthAuditLog_action_idx"             ON "${s}"."AuthAuditLog"("action")`,
    `CREATE INDEX "AuthAuditLog_createdAt_idx"          ON "${s}"."AuthAuditLog"("createdAt")`,

    // ── ConsultationSession ───────────────────────────────────────────────────
    `CREATE TABLE "${s}"."ConsultationSession" (
      "session_id"              TEXT         PRIMARY KEY,
      "tenantId"                TEXT         NOT NULL,
      "patient_id"              TEXT         NOT NULL,
      "doctor_id"               TEXT         NOT NULL,
      "session_type"            "${s}"."SessionType"      NOT NULL,
      "consultation_mode"       "${s}"."ConsultationMode" NOT NULL,
      "scheduled_date"          DATE         NOT NULL,
      "scheduled_start_time"    TIMESTAMP(3) NOT NULL,
      "duration_minutes"        INTEGER,
      "scheduled_end_time"      TIMESTAMP(3),
      "session_status"          "${s}"."SessionStatus" NOT NULL DEFAULT 'CREATED',
      "created_by"              TEXT         NOT NULL,
      "nurse_id"                TEXT,
      "room_name"               TEXT         NOT NULL,
      "twilio_room_sid"         TEXT,
      "doctor_identity"         TEXT,
      "patient_identity"        TEXT,
      "patient_name"            TEXT,
      "patient_country_code"    TEXT,
      "patient_country"         TEXT,
      "patient_province"        TEXT,
      "patient_city"            TEXT,
      "patient_latitude"        DOUBLE PRECISION,
      "patient_longitude"       DOUBLE PRECISION,
      "nurse_joined_at"         TIMESTAMP(3),
      "nurse_identity"          TEXT,
      "doctor_joined_at"        TIMESTAMP(3),
      "patient_joined_at"       TIMESTAMP(3),
      "started_at"              TIMESTAMP(3),
      "ended_at"                TIMESTAMP(3),
      "recording_enabled"       BOOLEAN      NOT NULL DEFAULT false,
      "recording_status"        TEXT,
      "recording_started_at"    TIMESTAMP(3),
      "recording_completed_at"  TIMESTAMP(3),
      "composition_sid"         TEXT,
      "composition_status"      TEXT,
      "composition_started_at"  TIMESTAMP(3),
      "composition_ready_at"    TIMESTAMP(3),
      "media_url"               TEXT,
      "media_format"            TEXT,
      "duration_sec"            INTEGER,
      "error_message"           TEXT,
      "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at"              TIMESTAMP(3) NOT NULL,
      CONSTRAINT "CS_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "${s}"."User"("id") ON DELETE RESTRICT,
      CONSTRAINT "CS_doctor_fkey"  FOREIGN KEY ("doctor_id")  REFERENCES "${s}"."User"("id") ON DELETE RESTRICT,
      CONSTRAINT "CS_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "${s}"."User"("id") ON DELETE RESTRICT,
      CONSTRAINT "CS_nurse_fkey"   FOREIGN KEY ("nurse_id")   REFERENCES "${s}"."User"("id") ON DELETE SET NULL
    )`,
    `CREATE UNIQUE INDEX "CS_room_name_tenantId_key"       ON "${s}"."ConsultationSession"("room_name","tenantId")`,
    `CREATE UNIQUE INDEX "CS_twilio_room_sid_tenantId_key" ON "${s}"."ConsultationSession"("twilio_room_sid","tenantId")`,
    `CREATE UNIQUE INDEX "CS_composition_sid_tenantId_key" ON "${s}"."ConsultationSession"("composition_sid","tenantId")`,
    `CREATE INDEX "CS_tenantId_idx"    ON "${s}"."ConsultationSession"("tenantId")`,
    `CREATE INDEX "CS_tid_did_sst_idx" ON "${s}"."ConsultationSession"("tenantId","doctor_id","scheduled_start_time")`,
    `CREATE INDEX "CS_tid_pid_sst_idx" ON "${s}"."ConsultationSession"("tenantId","patient_id","scheduled_start_time")`,
    `CREATE INDEX "CS_doctor_id_idx"   ON "${s}"."ConsultationSession"("doctor_id")`,
    `CREATE INDEX "CS_patient_id_idx"  ON "${s}"."ConsultationSession"("patient_id")`,
    `CREATE INDEX "CS_nurse_id_idx"    ON "${s}"."ConsultationSession"("nurse_id")`,
    `CREATE INDEX "CS_created_by_idx"  ON "${s}"."ConsultationSession"("created_by")`,
    `CREATE INDEX "CS_status_idx"      ON "${s}"."ConsultationSession"("session_status")`,
    `CREATE INDEX "CS_sst_idx"         ON "${s}"."ConsultationSession"("scheduled_start_time")`,
    `CREATE INDEX "CS_set_idx"         ON "${s}"."ConsultationSession"("scheduled_end_time")`,
    `CREATE INDEX "CS_did_sst_idx"     ON "${s}"."ConsultationSession"("doctor_id","scheduled_start_time")`,
    `CREATE INDEX "CS_pid_sst_idx"     ON "${s}"."ConsultationSession"("patient_id","scheduled_start_time")`,
    `CREATE INDEX "CS_nid_sst_idx"     ON "${s}"."ConsultationSession"("nurse_id","scheduled_start_time")`,

    // ── ConsultationNote ──────────────────────────────────────────────────────
    `CREATE TABLE "${s}"."ConsultationNote" (
      "id"                      TEXT         PRIMARY KEY,
      "tenantId"                TEXT         NOT NULL,
      "consultation_session_id" TEXT         NOT NULL UNIQUE,
      "doctorId"                TEXT         NOT NULL,
      "patient_id"              TEXT         NOT NULL,
      "nurse_id"                TEXT,
      "transcriptRaw"           TEXT,
      "summary"                 TEXT,
      "subjective"              TEXT,
      "objective"               TEXT,
      "assessment"              TEXT,
      "plan"                    TEXT,
      "aiStatus"                TEXT,
      "aiError"                 TEXT,
      "is_finalized"            BOOLEAN      NOT NULL DEFAULT false,
      "finalized_at"            TIMESTAMP(3),
      "transcribedAt"           TIMESTAMP(3),
      "summarizedAt"            TIMESTAMP(3),
      "aiModel"                 TEXT,
      "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"               TIMESTAMP(3) NOT NULL,
      CONSTRAINT "CN_session_fkey"  FOREIGN KEY ("consultation_session_id") REFERENCES "${s}"."ConsultationSession"("session_id") ON DELETE CASCADE,
      CONSTRAINT "CN_doctor_fkey"   FOREIGN KEY ("doctorId")   REFERENCES "${s}"."User"("id") ON DELETE RESTRICT,
      CONSTRAINT "CN_patient_fkey"  FOREIGN KEY ("patient_id") REFERENCES "${s}"."User"("id") ON DELETE RESTRICT,
      CONSTRAINT "CN_nurse_fkey"    FOREIGN KEY ("nurse_id")   REFERENCES "${s}"."User"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX "CN_tenantId_idx"   ON "${s}"."ConsultationNote"("tenantId")`,
    `CREATE INDEX "CN_doctorId_idx"   ON "${s}"."ConsultationNote"("doctorId")`,
    `CREATE INDEX "CN_patient_id_idx" ON "${s}"."ConsultationNote"("patient_id")`,
    `CREATE INDEX "CN_nurse_id_idx"   ON "${s}"."ConsultationNote"("nurse_id")`,
    `CREATE INDEX "CN_did_cat_idx"    ON "${s}"."ConsultationNote"("doctorId","createdAt" DESC)`,
    `CREATE INDEX "CN_pid_cat_idx"    ON "${s}"."ConsultationNote"("patient_id","createdAt" DESC)`,
    `CREATE INDEX "CN_session_idx"    ON "${s}"."ConsultationNote"("consultation_session_id")`,

    // ── ConsultationSessionAudit ──────────────────────────────────────────────
    `CREATE TABLE "${s}"."ConsultationSessionAudit" (
      "id"                      TEXT         PRIMARY KEY,
      "tenantId"                TEXT         NOT NULL,
      "consultation_session_id" TEXT         NOT NULL,
      "actor_user_id"           TEXT,
      "actor_role"              "${s}"."UserRole",
      "action"                  TEXT         NOT NULL,
      "previous_status"         "${s}"."SessionStatus",
      "new_status"              "${s}"."SessionStatus",
      "metadata"                JSONB,
      "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CSA_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "${s}"."ConsultationSession"("session_id") ON DELETE CASCADE,
      CONSTRAINT "CSA_actor_fkey"   FOREIGN KEY ("actor_user_id") REFERENCES "${s}"."User"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX "CSA_tenantId_idx" ON "${s}"."ConsultationSessionAudit"("tenantId")`,
    `CREATE INDEX "CSA_session_idx"  ON "${s}"."ConsultationSessionAudit"("consultation_session_id")`,
    `CREATE INDEX "CSA_actor_idx"    ON "${s}"."ConsultationSessionAudit"("actor_user_id")`,
    `CREATE INDEX "CSA_created_idx"  ON "${s}"."ConsultationSessionAudit"("created_at")`,
  ];
}
