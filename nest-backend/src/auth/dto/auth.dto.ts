import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  IsNotEmpty,
} from 'class-validator';

// Minimum policy: >= 10 chars, at least one letter, one digit. Upper bound
// guards against resource-exhaustion attacks on bcrypt (bcrypt truncates at
// 72 bytes anyway, but we refuse obvious abuse beforehand).
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(10, 128)
  @Matches(PASSWORD_REGEX, {
    message: 'Password must contain at least one letter and one digit.',
  })
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class TwoFactorAuthenticateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  tempToken!: string;

  @IsString()
  @Length(6, 10)
  @Matches(/^[0-9]{6,10}$/, { message: '2FA code must be numeric.' })
  code!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 10)
  @Matches(/^[0-9]{6,10}$/, { message: '2FA code must be numeric.' })
  code!: string;
}

export class WebAuthnLoginOptionsDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class WebAuthnLoginVerifyDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  // The raw `response` payload is validated downstream by @simplewebauthn/server.
  response!: unknown;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
