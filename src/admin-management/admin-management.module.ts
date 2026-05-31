import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { AdminDoctorsController } from './admin-doctors.controller';
import { AdminDoctorsService } from './admin-doctors.service';
import { AdminNursesController } from './admin-nurses.controller';
import { AdminNursesService } from './admin-nurses.service';
import { AdminPatientsController } from './admin-patients.controller';
import { AdminPatientsService } from './admin-patients.service';
import { AdminLiveDashboardController } from './admin-live-dashboard.controller';
import { AdminLiveDashboardService } from './admin-live-dashboard.service';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminAuditLogController } from './admin-audit-log.controller';
import { AdminAuditLogService } from './admin-audit-log.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminDoctorsController,
    AdminNursesController,
    AdminPatientsController,
    AdminLiveDashboardController,
    AdminReportsController,
    AdminAuditLogController,
  ],
  providers: [
    AdminDoctorsService,
    AdminNursesService,
    AdminPatientsService,
    AdminLiveDashboardService,
    AdminReportsService,
    AdminAuditLogService,
  ],
})
export class AdminManagementModule {}
