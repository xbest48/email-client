import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { PgpService } from './pgp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsEmail, IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

class SaveKeyPairDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  publicKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  privateKey!: string;

  @IsString()
  @Length(16, 128)
  fingerprint!: string;
}

class SaveContactKeyDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  publicKey!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/pgp')
export class PgpController {
  constructor(private readonly pgpService: PgpService) {}

  @Get('keys')
  async getKeyPair(@Request() req: any) {
    const key = await this.pgpService.getKeyPair(req.user.id);
    if (!key) return null;
    return { publicKey: key.publicKey, privateKey: key.privateKey, fingerprint: key.fingerprint };
  }

  @Post('keys')
  async saveKeyPair(@Request() req: any, @Body() body: SaveKeyPairDto) {
    await this.pgpService.saveKeyPair(req.user.id, body.publicKey, body.privateKey, body.fingerprint);
    return { success: true };
  }

  @Delete('keys')
  async deleteKeyPair(@Request() req: any) {
    await this.pgpService.deleteKeyPair(req.user.id);
    return { success: true };
  }

  @Get('contacts')
  async getContactKeys(@Request() req: any) {
    return this.pgpService.getContactKeys(req.user.id);
  }

  @Post('contacts')
  async saveContactKey(@Request() req: any, @Body() body: SaveContactKeyDto) {
    await this.pgpService.saveContactKey(req.user.id, body.email, body.publicKey);
    return { success: true };
  }

  @Delete('contacts/:email')
  async removeContactKey(@Request() req: any, @Param('email') email: string) {
    await this.pgpService.removeContactKey(req.user.id, decodeURIComponent(email));
    return { success: true };
  }
}
