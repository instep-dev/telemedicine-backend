import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminPatientsService } from './admin-patients.service';
import { CreatePatientDto, ListPatientsQueryDto, UpdatePatientDto } from './dto/admin-patients.dto';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/patients')
export class AdminPatientsController {
  constructor(private readonly service: AdminPatientsService) {}

  @Get()
  findAll(@CurrentTenant() tenant: TenantContext, @Query() query: ListPatientsQueryDto) {
    return this.service.findAll(tenant.id, tenant.schemaName, query);
  }

  @Post()
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreatePatientDto, @Req() req: any) {
    return this.service.create(tenant.id, tenant.schemaName, dto, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }

  @Patch(':userId')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Body() dto: UpdatePatientDto,
    @Req() req: any,
  ) {
    return this.service.update(tenant.id, tenant.schemaName, userId, dto, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }

  @Patch(':userId/toggle-active')
  toggleActive(@CurrentTenant() tenant: TenantContext, @Param('userId') userId: string, @Req() req: any) {
    return this.service.toggleActive(tenant.id, tenant.schemaName, userId, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }
}
