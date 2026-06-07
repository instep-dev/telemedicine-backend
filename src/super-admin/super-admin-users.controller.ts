import { Body, Controller, Delete, Get, MessageEvent, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { SuperAdminUsersService, USER_LIST_CHANGED_EVENT } from './super-admin-users.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { CreateTenantAdminDto } from './dto/create-tenant-admin.dto';
import { PlatformUsersQueryDto } from './dto/platform-users-query.dto';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin')
export class SuperAdminUsersController {
  private readonly listChanged$ = new Subject<void>();

  constructor(private readonly usersService: SuperAdminUsersService) {}

  // SSE: notify clients when user list changes
  @Sse('users/stream')
  usersStream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());

    return new Observable<MessageEvent>((subscriber) => {
      // Send initial connected event
      subscriber.next({ data: JSON.stringify({ type: 'CONNECTED' }) } as MessageEvent);

      const sub = this.listChanged$
        .pipe(takeUntil(disconnect$))
        .subscribe(() => {
          subscriber.next({ data: JSON.stringify({ type: 'USER_LIST_CHANGED' }) } as MessageEvent);
        });

      return () => {
        sub.unsubscribe();
        disconnect$.next();
      };
    });
  }

  @OnEvent(USER_LIST_CHANGED_EVENT)
  handleUserListChanged() {
    this.listChanged$.next();
  }

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

  @Post('tenants/:tenantId/admin')
  createAdmin(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateTenantAdminDto,
  ) {
    return this.usersService.createAdminForTenant(tenantId, dto);
  }

  @Delete('tenants/:tenantId/users/:userId')
  deleteUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.deleteUser(tenantId, userId);
  }
}
