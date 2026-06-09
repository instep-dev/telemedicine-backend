import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePatientDto {
  @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @MinLength(5) @MaxLength(20) phone: string;
  @IsDateString() @IsOptional() bornDate?: string;
  @IsIn(['MALE', 'FEMALE']) @IsOptional() gender?: string;
  @IsString() @MinLength(1) mrn: string;
  @IsString() @IsOptional() @MaxLength(500) address?: string;
}

export class UpdatePatientDto {
  @IsString() @MinLength(2) @MaxLength(100) @IsOptional() fullName?: string;
  @IsString() @MinLength(5) @MaxLength(20) @IsOptional() phone?: string;
  @IsDateString() @IsOptional() bornDate?: string;
  @IsIn(['MALE', 'FEMALE']) @IsOptional() gender?: string;
  @IsString() @IsOptional() @MaxLength(500) address?: string;
}

export class ListPatientsQueryDto {
  @IsString() @IsOptional() cursor?: string;
  @IsString() @IsOptional() search?: string;
}
