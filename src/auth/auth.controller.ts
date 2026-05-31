import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { OAuthCompleteDto } from "./dto/oauth-complete.dto";
import type { Request, Response, CookieOptions } from "express";
import { JwtGuard } from "./guards/jwt.guard";
import { CurrentTenant } from "../tenant/tenant.decorator";
import type { TenantContext } from "../tenant/tenant.interface";
import { BadRequestException } from "@nestjs/common";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  private refreshCookieOptions(maxAgeDays: number): CookieOptions {
    const isProd = process.env.NODE_ENV === "production";
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      ...(isProd && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
      maxAge: 1000 * 60 * 60 * 24 * maxAgeDays,
    };
  }

  private clearRefreshCookieOptions(): CookieOptions {
    const isProd = process.env.NODE_ENV === "production";
    return {
      path: "/",
      ...(isProd && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");

    const result = await this.auth.login(
      {
        identifier: dto.identifier,
        password: dto.password,
        ip: req.ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        rememberMe: dto.rememberMe,
      },
      tenant,
    );

    res.clearCookie("refresh_token", this.clearRefreshCookieOptions());
    res.cookie("refresh_token", result.refreshToken, this.refreshCookieOptions(dto.rememberMe ? 30 : 1));

    return { accessToken: result.accessToken, user: result.user };
  }

  // OAuth start — needs tenant to store tenantSlug in OauthState
  @Get("oauth/:provider/start")
  async oauthStart(
    @Param("provider") provider: string,
    @Query("role") role: string,
    @Query("redirect") redirectUrl: string | undefined,
    @Res() res: Response,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");
    const url = await this.auth.getOAuthStartUrl({ provider, role, redirectUrl }, tenant);
    return res.redirect(url);
  }

  // OAuth callback — NO X-Tenant-Slug header (redirect from Google/Microsoft)
  // Tenant is resolved internally from OauthState.tenantSlug
  @Get("oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") provider: string,
    @Query() query: Record<string, string | undefined>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.handleOAuthCallback({
      provider,
      query,
      ip: req.ip,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });

    if (result.refreshToken) {
      res.clearCookie("refresh_token", this.clearRefreshCookieOptions());
      res.cookie("refresh_token", result.refreshToken, this.refreshCookieOptions(30));
    }

    return res.redirect(result.redirectUrl);
  }

  @Post("oauth/complete")
  async oauthComplete(
    @Body() dto: OAuthCompleteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");

    const result = await this.auth.completeOAuth(
      {
        ...dto,
        ip: req.ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      },
      tenant,
    );

    res.clearCookie("refresh_token", this.clearRefreshCookieOptions());
    res.cookie("refresh_token", result.refreshToken, this.refreshCookieOptions(30));

    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("refresh")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");

    const rawCookie = (req.headers.cookie as string) ?? "";
    const matches = [...rawCookie.matchAll(/(?:^|;\s*)refresh_token=([^;]+)/g)];
    const rt = matches.length > 0
      ? decodeURIComponent(matches[matches.length - 1][1].trim())
      : ((req.cookies?.["refresh_token"] as string | undefined) ?? "");

    const result = await this.auth.refresh(
      {
        refreshToken: rt,
        ip: req.ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      },
      tenant,
    );

    res.clearCookie("refresh_token", this.clearRefreshCookieOptions());
    res.cookie("refresh_token", result.refreshToken, this.refreshCookieOptions(30));

    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("oauth/session")
  async oauthSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");

    const auth = String(req.headers["authorization"] || "");
    const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    const result = await this.auth.oauthSession(
      {
        accessToken,
        ip: req.ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      },
      tenant,
    );

    res.cookie("refresh_token", result.refreshToken, this.refreshCookieOptions(30));

    return { accessToken: result.accessToken, user: result.user };
  }

  @UseGuards(JwtGuard)
  @Post("logout")
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");

    const rawCookie = (req.headers.cookie as string) ?? "";
    const matches = [...rawCookie.matchAll(/(?:^|;\s*)refresh_token=([^;]+)/g)];
    const rt = matches.length > 0
      ? decodeURIComponent(matches[matches.length - 1][1].trim())
      : ((req.cookies?.["refresh_token"] as string | undefined) ?? undefined);

    await this.auth.logout(
      {
        refreshToken: rt,
        userId: req.user?.id,
        ip: req.ip,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      },
      tenant,
    );

    res.clearCookie("refresh_token", this.clearRefreshCookieOptions());
    return { ok: true };
  }

  @UseGuards(JwtGuard)
  @Post("logout-all")
  async logoutAll(@Req() req: any, @CurrentTenant() tenant: TenantContext) {
    if (!tenant) throw new BadRequestException("Missing X-Tenant-Slug header");
    await this.auth.logout({ revokeAll: true, userId: req.user.id }, tenant);
    return { ok: true };
  }
}
