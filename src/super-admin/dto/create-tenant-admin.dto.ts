import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class CreateTenantAdminDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(5)
  @MaxLength(20)
  phone: string;
}
