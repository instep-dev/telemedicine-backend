import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

  @IsEmail()
  @IsOptional()
  adminEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;
}
