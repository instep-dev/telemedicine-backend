import { IsOptional, IsString } from 'class-validator';

export class AuditLogQueryDto {
  @IsString() @IsOptional() cursor?: string;
  @IsString() @IsOptional() action?: string;
}
