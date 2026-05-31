import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SuperAdminWhitelistService } from './super-admin-whitelist.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import {
  AddAdminIdDto,
  AddLicenseDto,
  AddMrnDto,
  AddNurseIdDto,
} from './dto/super-admin-whitelist.dto';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/tenants/:tenantId/whitelist')
export class SuperAdminWhitelistController {
  constructor(private readonly whitelistService: SuperAdminWhitelistService) {}

  // ── License ────────────────────────────────────────────────────────────────

  @Get('licenses')
  listLicenses(@Param('tenantId') tenantId: string) {
    return this.whitelistService.listLicenses(tenantId);
  }

  @Post('licenses')
  addLicense(@Param('tenantId') tenantId: string, @Body() dto: AddLicenseDto) {
    return this.whitelistService.addLicense(tenantId, dto);
  }

  @Delete('licenses/:id')
  removeLicense(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.whitelistService.removeLicense(tenantId, id);
  }

  // ── Admin ID ───────────────────────────────────────────────────────────────

  @Get('admin-ids')
  listAdminIds(@Param('tenantId') tenantId: string) {
    return this.whitelistService.listAdminIds(tenantId);
  }

  @Post('admin-ids')
  addAdminId(@Param('tenantId') tenantId: string, @Body() dto: AddAdminIdDto) {
    return this.whitelistService.addAdminId(tenantId, dto);
  }

  @Delete('admin-ids/:id')
  removeAdminId(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.whitelistService.removeAdminId(tenantId, id);
  }

  // ── Nurse ID ───────────────────────────────────────────────────────────────

  @Get('nurse-ids')
  listNurseIds(@Param('tenantId') tenantId: string) {
    return this.whitelistService.listNurseIds(tenantId);
  }

  @Post('nurse-ids')
  addNurseId(@Param('tenantId') tenantId: string, @Body() dto: AddNurseIdDto) {
    return this.whitelistService.addNurseId(tenantId, dto);
  }

  @Delete('nurse-ids/:id')
  removeNurseId(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.whitelistService.removeNurseId(tenantId, id);
  }

  // ── MRN ────────────────────────────────────────────────────────────────────

  @Get('mrns')
  listMrns(@Param('tenantId') tenantId: string) {
    return this.whitelistService.listMrns(tenantId);
  }

  @Post('mrns')
  addMrn(@Param('tenantId') tenantId: string, @Body() dto: AddMrnDto) {
    return this.whitelistService.addMrn(tenantId, dto);
  }

  @Delete('mrns/:id')
  removeMrn(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.whitelistService.removeMrn(tenantId, id);
  }
}
