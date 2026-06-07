import { IsIn, IsOptional, IsString } from 'class-validator';

export class PlatformUsersQueryDto {
  @IsString()
  @IsOptional()
  cursor?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsIn(['ADMIN', 'DOCTOR', 'PATIENT', 'NURSE'])
  @IsOptional()
  role?: string;

  @IsIn(['true', 'false'])
  @IsOptional()
  isActive?: string; // 'true' | 'false'
}
