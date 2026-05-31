import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminDashboardService } from './super-admin-dashboard.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/dashboard')
export class SuperAdminDashboardController {
  constructor(private readonly dashboardService: SuperAdminDashboardService) {}

  @Get('stats')
  getStats() {
    return this.dashboardService.getStats();
  }

  @Get('recent-jobs')
  getRecentJobs() {
    return this.dashboardService.getRecentJobs(5);
  }
}
