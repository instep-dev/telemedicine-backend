import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SERVICE_TYPES, SUBSCRIPTION_PLANS } from './create-tenant.dto';

export class UpdateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsIn(SERVICE_TYPES)
  @IsOptional()
  serviceType?: string;

  @IsIn(SUBSCRIPTION_PLANS)
  @IsOptional()
  subscriptionPlan?: string;

  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: string;

  @IsEmail()
  @IsOptional()
  adminEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsOptional()
  address?: string;
}
