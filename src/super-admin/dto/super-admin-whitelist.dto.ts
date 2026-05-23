import { IsString, MinLength } from 'class-validator';

export class AddLicenseDto {
  @IsString()
  @MinLength(1)
  license: string;
}

export class AddAdminIdDto {
  @IsString()
  @MinLength(1)
  adminId: string;
}

export class AddNurseIdDto {
  @IsString()
  @MinLength(1)
  nurseId: string;
}

export class AddMrnDto {
  @IsString()
  @MinLength(1)
  mrn: string;
}
