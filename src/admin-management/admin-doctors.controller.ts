import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminDoctorsService } from './admin-doctors.service';
import { CreateDoctorDto, ListDoctorsQueryDto, UpdateDoctorDto } from './dto/admin-doctors.dto';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/doctors')
export class AdminDoctorsController {
  constructor(private readonly service: AdminDoctorsService) {}

  @Get()
  findAll(@CurrentTenant() tenant: TenantContext, @Query() query: ListDoctorsQueryDto) {
    return this.service.findAll(tenant.id, tenant.schemaName, query);
  }

  @Post()
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateDoctorDto, @Req() req: any) {
    return this.service.create(tenant.id, tenant.schemaName, dto, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }

  @Patch(':userId')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Body() dto: UpdateDoctorDto,
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
