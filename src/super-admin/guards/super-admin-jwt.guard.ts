import { AuthGuard } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class SuperAdminJwtGuard extends AuthGuard('super-admin-jwt') {
  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw new UnauthorizedException('Super admin token tidak valid atau sudah expired');
    }
    return user;
  }
}
