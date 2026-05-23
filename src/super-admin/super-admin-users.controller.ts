import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SuperAdminUsersService } from './super-admin-users.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/tenants/:tenantId/users')
export class SuperAdminUsersController {
  constructor(private readonly usersService: SuperAdminUsersService) {}

  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.usersService.findAll(tenantId);
  }

  @Get(':userId')
  findOne(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.findOne(tenantId, userId);
  }

  @Patch(':userId/activate')
  activate(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.activate(tenantId, userId);
  }

  @Patch(':userId/deactivate')
  deactivate(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.deactivate(tenantId, userId);
  }
}
