import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { SuperAdminPromptSettingsService, PromptTemplateType } from './super-admin-prompt-settings.service';
import { UpdatePromptSettingDto } from './dto/update-prompt-setting.dto';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/prompt-settings')
export class SuperAdminPromptSettingsController {
  constructor(private readonly service: SuperAdminPromptSettingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':type')
  findOne(@Param('type') type: string) {
    return this.service.findByType(type.toUpperCase() as PromptTemplateType);
  }

  @Patch(':type')
  upsert(@Param('type') type: string, @Body() dto: UpdatePromptSettingDto) {
    return this.service.upsert(type.toUpperCase() as PromptTemplateType, dto);
  }

  @Post(':type/reset')
  resetToDefault(@Param('type') type: string) {
    return this.service.resetToDefault(type.toUpperCase() as PromptTemplateType);
  }
}
