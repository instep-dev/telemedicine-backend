import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdatePromptSettingDto {
  @IsString()
  @IsNotEmpty()
  subjective: string;

  @IsString()
  @IsOptional()
  objective?: string;

  @IsString()
  @IsNotEmpty()
  assessment: string;

  @IsString()
  @IsNotEmpty()
  plan: string;
}
