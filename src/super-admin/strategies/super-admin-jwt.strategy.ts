import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'prisma/prisma.service';
import type { SuperAdminJwtPayload } from '../types/super-admin-jwt-payload';

@Injectable()
export class SuperAdminJwtStrategy extends PassportStrategy(Strategy, 'super-admin-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Fallback: query param ?token= untuk SSE (EventSource tidak support custom headers)
        (req: any) => req?.query?.token ?? null,
      ]),
      secretOrKey: process.env.JWT_SUPER_ADMIN_ACCESS_SECRET!,
    });
  }

  async validate(payload: SuperAdminJwtPayload) {
    if (payload.type !== 'super_admin') {
      throw new UnauthorizedException('Invalid token type');
    }

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true },
    });

    if (!superAdmin) {
      throw new UnauthorizedException('Super admin not found');
    }

    return { id: superAdmin.id, email: superAdmin.email, name: superAdmin.name };
  }
}
