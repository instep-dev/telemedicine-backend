import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { POLI_OPTIONS } from './admin-doctors.dto';

export class CreateNurseDto {
  @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @IsEmail() email: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @MinLength(3) @MaxLength(50) nurseId: string;
  @IsIn(POLI_OPTIONS) @IsOptional() poli?: string;
}

export class UpdateNurseDto {
  @IsString() @MinLength(2) @MaxLength(100) @IsOptional() fullName?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @MinLength(3) @MaxLength(50) @IsOptional() nurseId?: string;
  @IsIn(POLI_OPTIONS) @IsOptional() poli?: string;
}

export class ListNursesQueryDto {
  @IsString() @IsOptional() cursor?: string;
  @IsString() @IsOptional() search?: string;
}
