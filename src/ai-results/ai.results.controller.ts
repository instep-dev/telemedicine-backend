import {
  Controller,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AI_STATUS_UPDATED_EVENT } from '../ai-summary/ai.service';
import type { AiStatusUpdatedPayload } from '../ai-summary/ai.service';
import { AiResultsService } from './ai-results.service';
import { GetAiResultsQueryDto } from './dto/ai-results.dto';

@Controller('ai-results')
export class AiResultsController {
  private readonly sseSubject = new Subject<AiStatusUpdatedPayload>();

  constructor(private readonly aiResultsService: AiResultsService) {}

  @UseGuards(JwtGuard)
  @Get()
  async findAll(@Req() req: any, @Query() query: GetAiResultsQueryDto) {
    if (req.user.role === UserRole.DOCTOR) {
      return this.aiResultsService.findAllByDoctor(req.user.id, query);
    }
    if (req.user.role === UserRole.NURSE) {
      return this.aiResultsService.findAllByNurse(req.user.id, query);
    }
    throw new ForbiddenException('Hanya dokter atau nurse yang dapat melihat AI summary');
  }

  // SSE must be declared before @Get(':id') to avoid route conflict
  @UseGuards(JwtGuard)
  @Sse('stream')
  stream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    if (req.user.role !== UserRole.DOCTOR && req.user.role !== UserRole.NURSE) {
      throw new ForbiddenException('Hanya dokter atau nurse yang dapat mengakses stream');
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const userId: string = req.user.id;
    const role = req.user.role as UserRole;

    return this.sseSubject.pipe(
      filter((event) =>
        role === UserRole.DOCTOR
          ? event.doctorId === userId
          : event.nurseId === userId,
      ),
      map((event) => ({
        data: {
          type: 'AI_STATUS_UPDATED',
          noteId: event.noteId,
          sessionId: event.sessionId,
          aiStatus: event.aiStatus,
          aiError: event.aiError ?? null,
          summary: event.summary ?? null,
          subjective: event.subjective ?? null,
          objective: event.objective ?? null,
          assessment: event.assessment ?? null,
          plan: event.plan ?? null,
          summarizedAt: event.summarizedAt ?? null,
          transcribedAt: event.transcribedAt ?? null,
        },
      }) as MessageEvent),
    );
  }

  @OnEvent(AI_STATUS_UPDATED_EVENT)
  handleAiStatusUpdated(payload: AiStatusUpdatedPayload) {
    this.sseSubject.next(payload);
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    if (req.user.role === UserRole.DOCTOR) {
      return this.aiResultsService.findById(req.user.id, id);
    }
    if (req.user.role === UserRole.NURSE) {
      return this.aiResultsService.findByIdForNurse(req.user.id, id);
    }
    throw new ForbiddenException('Hanya dokter atau nurse yang dapat melihat AI summary');
  }
}
