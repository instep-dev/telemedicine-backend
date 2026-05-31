import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminReportsService } from './admin-reports.service';
import { ReportsQueryDto } from './dto/admin-reports.dto';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly service: AdminReportsService) {}

  @Get()
  getReport(@CurrentTenant() tenant: TenantContext, @Query() query: ReportsQueryDto) {
    return this.service.getReport(tenant.id, tenant.schemaName, query);
  }

  @Get('doctors')
  getDoctorOptions(@CurrentTenant() tenant: TenantContext) {
    return this.service.getDoctorOptions(tenant.id, tenant.schemaName);
  }
}
