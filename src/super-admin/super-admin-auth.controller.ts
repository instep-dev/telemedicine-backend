import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminLoginDto } from './dto/super-admin-auth.dto';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';

const SA_COOKIE = 'sa_refresh_token';

@Controller('super-admin/auth')
export class SuperAdminAuthController {
  constructor(private readonly authService: SuperAdminAuthService) {}

  private cookieOptions(maxAgeDays: number): CookieOptions {
    const isProd = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * maxAgeDays,
    };
  }

  private clearOptions(): CookieOptions {
    return { path: '/' };
  }

  @Post('login')
  async login(
    @Body() dto: SuperAdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req);

    res.clearCookie(SA_COOKIE, this.clearOptions());
    res.cookie(SA_COOKIE, result.refreshToken, this.cookieOptions(7));

    return { accessToken: result.accessToken, superAdmin: result.superAdmin };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies?.[SA_COOKIE] as string | undefined;
    const result = await this.authService.refresh(rawToken);

    res.clearCookie(SA_COOKIE, this.clearOptions());
    res.cookie(SA_COOKIE, result.refreshToken, this.cookieOptions(7));

    return { accessToken: result.accessToken, superAdmin: result.superAdmin };
  }

  @UseGuards(SuperAdminJwtGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies?.[SA_COOKIE] as string | undefined;
    await this.authService.logout(rawToken);

    res.clearCookie(SA_COOKIE, this.clearOptions());
    return { ok: true };
  }
}
