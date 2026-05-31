import { UserRole } from "@prisma/client";

export type JwtPayload = {
  id: string;
  sub: string;        // userId
  email: string;
  role: UserRole;
  tenantId: string;   // UUID v4
  tenantSlug: string; // "dharmanugraha"
  twilioIdentity?: string;
};
