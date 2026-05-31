import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SuperAdminUsersService } from './super-admin-users.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { CreateTenantAdminDto } from './dto/create-tenant-admin.dto';
import { PlatformUsersQueryDto } from './dto/platform-users-query.dto';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin')
export class SuperAdminUsersController {
  constructor(private readonly usersService: SuperAdminUsersService) {}

  // Platform-wide users (cross-tenant)
  @Get('users')
  findPlatformUsers(@Query() query: PlatformUsersQueryDto) {
    return this.usersService.findPlatformUsers(query);
  }

  // Per-tenant user list
  @Get('tenants/:tenantId/users')
  findAll(@Param('tenantId') tenantId: string) {
    return this.usersService.findAll(tenantId);
  }

  @Get('tenants/:tenantId/users/:userId')
  findOne(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.findOne(tenantId, userId);
  }

  @Patch('tenants/:tenantId/users/:userId/activate')
  activate(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.activate(tenantId, userId);
  }

  @Patch('tenants/:tenantId/users/:userId/deactivate')
  deactivate(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.deactivate(tenantId, userId);
  }

  // Create admin account for a tenant
  @Post('tenants/:tenantId/admin')
  createAdmin(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateTenantAdminDto,
  ) {
    return this.usersService.createAdminForTenant(tenantId, dto);
  }

  // Hard delete user from a tenant
  @Delete('tenants/:tenantId/users/:userId')
  deleteUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.deleteUser(tenantId, userId);
  }
}
