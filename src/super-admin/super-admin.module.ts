import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'prisma/prisma.module';
import { SuperAdminAuthController } from './super-admin-auth.controller';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminJwtStrategy } from './strategies/super-admin-jwt.strategy';
import { SuperAdminTenantsController } from './super-admin-tenants.controller';
import { SuperAdminTenantsService } from './super-admin-tenants.service';
import { SuperAdminUsersController } from './super-admin-users.controller';
import { SuperAdminUsersService } from './super-admin-users.service';
import { SuperAdminWhitelistController } from './super-admin-whitelist.controller';
import { SuperAdminWhitelistService } from './super-admin-whitelist.service';

@Module({
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [
    SuperAdminAuthController,
    SuperAdminTenantsController,
    SuperAdminUsersController,
    SuperAdminWhitelistController,
  ],
  providers: [
    SuperAdminAuthService,
    SuperAdminTenantsService,
    SuperAdminUsersService,
    SuperAdminWhitelistService,
    SuperAdminJwtStrategy,
  ],
})
export class SuperAdminModule {}
