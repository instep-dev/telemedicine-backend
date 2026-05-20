import { Module } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { PrismaModule } from 'prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController],
  providers: [TenantMiddleware, TenantService],
  exports: [TenantMiddleware, TenantService],
})
export class TenantModule {}
