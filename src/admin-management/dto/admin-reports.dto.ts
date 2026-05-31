import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ReportsQueryDto {
  @IsDateString() @IsOptional() dateFrom?: string;
  @IsDateString() @IsOptional() dateTo?: string;
  @IsString() @IsOptional() preset?: 'today' | '7days' | '30days' | 'thisMonth';
  @IsString() @IsOptional() doctorId?: string;
}
