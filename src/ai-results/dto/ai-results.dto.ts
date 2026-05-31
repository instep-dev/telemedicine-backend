import { IsIn, IsOptional, IsString } from 'class-validator';

export class GetAiResultsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';

  @IsOptional()
  @IsIn(['success', 'failed', 'in-progress'])
  statusBucket?: 'success' | 'failed' | 'in-progress';
}