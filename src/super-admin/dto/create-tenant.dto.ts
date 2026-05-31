import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const SERVICE_TYPES = ['HOSPITAL', 'CLINIC', 'COUNSELING_CENTER', 'MEDICAL_PROVIDER', 'OTHER'] as const;
export const SUBSCRIPTION_PLANS = ['TRIAL', 'PROFESSIONAL', 'ENTERPRISE'] as const;

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,29}$/, {
    message: 'slug harus lowercase, hanya huruf, angka, dan tanda hubung, minimal 2 karakter',
  })
  slug: string;

  @IsIn(SERVICE_TYPES)
  @IsOptional()
  serviceType?: string;

  @IsIn(SUBSCRIPTION_PLANS)
  @IsOptional()
  subscriptionPlan?: string;

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
