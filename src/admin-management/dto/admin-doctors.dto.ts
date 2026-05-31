import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const POLI_OPTIONS = ['Poli Anak', 'Poli Psikologi', 'Poli Umum'] as const;
export const SERVICE_CAPABILITY = ['TELEMEDICINE', 'TELECOUNSELING', 'BOTH'] as const;

export class CreateDoctorDto {
  @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @IsEmail() email: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @MinLength(3) @MaxLength(50) license: string;
  @IsString() @IsOptional() specialization?: string;
  @IsIn(POLI_OPTIONS) @IsOptional() poli?: string;
  @IsIn(SERVICE_CAPABILITY) @IsOptional() serviceCapability?: string;
  @IsString() @IsOptional() @MaxLength(500) bio?: string;
}

export class UpdateDoctorDto {
  @IsString() @MinLength(2) @MaxLength(100) @IsOptional() fullName?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @MinLength(3) @MaxLength(50) @IsOptional() license?: string;
  @IsString() @IsOptional() specialization?: string;
  @IsIn(POLI_OPTIONS) @IsOptional() poli?: string;
  @IsIn(SERVICE_CAPABILITY) @IsOptional() serviceCapability?: string;
  @IsString() @IsOptional() @MaxLength(500) bio?: string;
}

export class ListDoctorsQueryDto {
  @IsString() @IsOptional() cursor?: string;
  @IsString() @IsOptional() search?: string;
}
