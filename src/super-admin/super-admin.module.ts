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
import { SuperAdminDashboardController } from './super-admin-dashboard.controller';
import { SuperAdminDashboardService } from './super-admin-dashboard.service';
import { SuperAdminPromptSettingsController } from './super-admin-prompt-settings.controller';
import { SuperAdminPromptSettingsService } from './super-admin-prompt-settings.service';

@Module({
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [
    SuperAdminAuthController,
    SuperAdminTenantsController,
    SuperAdminUsersController,
    SuperAdminDashboardController,
    SuperAdminPromptSettingsController,
  ],
  providers: [
    SuperAdminAuthService,
    SuperAdminTenantsService,
    SuperAdminUsersService,
    SuperAdminDashboardService,
    SuperAdminJwtStrategy,
    SuperAdminPromptSettingsService,
  ],
})
export class SuperAdminModule {}
