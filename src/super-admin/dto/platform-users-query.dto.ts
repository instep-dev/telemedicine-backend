import { IsIn, IsOptional, IsString } from 'class-validator';

export class PlatformUsersQueryDto {
  @IsString()
  @IsOptional()
  cursor?: string; // base64 encoded {createdAt, userId}

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsIn(['ADMIN', 'DOCTOR', 'PATIENT', 'NURSE'])
  @IsOptional()
  role?: string;
}
