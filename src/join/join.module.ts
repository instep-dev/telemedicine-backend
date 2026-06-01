import { Module } from '@nestjs/common';
import { JoinController } from './join.controller';
import { JoinService } from './join.service';
import { TwilioModule } from '../twilio/twilio.module';
import { PrismaService } from 'prisma/prisma.service';

@Module({
  imports: [TwilioModule],
  controllers: [JoinController],
  providers: [JoinService, PrismaService],
  exports: [JoinService],
})
export class JoinModule {}
