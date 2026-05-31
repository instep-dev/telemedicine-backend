import {
  Controller,
  ForbiddenException,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AiService } from './ai.service';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.interface';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @UseGuards(JwtGuard)
  @Post('process/:sessionId')
  async process(
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    await this.aiService.processConsultationFromTranscript(sessionId, undefined, tenant);
    return { success: true };
  }

  @UseGuards(JwtGuard)
  @Post('retry/:sessionId')
  async retry(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat retry AI summary');
    }

    void this.aiService
      .processConsultationFromTranscript(sessionId, req.user.id, tenant)
      .catch((err) => {
        this.logger.error(
          `Manual retry failed sessionId=${sessionId} message=${err?.message || err}`,
        );
      });

    return { success: true, queued: true };
  }
}
