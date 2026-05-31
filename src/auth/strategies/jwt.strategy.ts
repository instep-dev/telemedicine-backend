import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { PrismaService } from "prisma/prisma.service";
import { UserRole } from "@prisma/client";
import type { JwtPayload } from "../types/jwt-payload";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const tenant = (req as any).tenant;

    // Verify token belongs to the same tenant making the request
    if (!tenant || payload.tenantSlug !== tenant.slug) {
      throw new UnauthorizedException("Token tenant mismatch");
    }

    const result = await this.prisma.withTenantSchema(
      tenant.schemaName,
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, role: true, twilioIdentity: true, isActive: true, tenantId: true },
        });

        if (!user || !user.isActive) return null;
        if (user.tenantId !== tenant.id) return null;

        let email = "";
        if (user.role === UserRole.DOCTOR) {
          const p = await tx.doctorProfile.findUnique({ where: { userId: user.id }, select: { email: true } });
          if (!p) return null;
          email = p.email;
        } else if (user.role === UserRole.ADMIN) {
          const p = await tx.adminProfile.findUnique({ where: { userId: user.id }, select: { email: true } });
          if (!p) return null;
          email = p.email;
        } else if (user.role === UserRole.NURSE) {
          const p = await tx.nurseProfile.findUnique({ where: { userId: user.id }, select: { email: true } });
          if (!p) return null;
          email = p.email;
        } else {
          const p = await tx.patientProfile.findUnique({ where: { userId: user.id }, select: { email: true } });
          if (!p) return null;
          email = p.email;
        }

        return { id: user.id, sub: payload.sub, email, role: user.role, tenantId: tenant.id, tenantSlug: tenant.slug, twilioIdentity: user.twilioIdentity };
      },
    );

    if (!result) throw new UnauthorizedException("Invalid token");

    return result;
  }
}
