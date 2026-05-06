import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { OAuthCompleteDto } from "./dto/oauth-complete.dto";
import type { Request, Response } from "express";
import { JwtGuard } from "./guards/jwt.guard";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];

    const result = await this.auth.login({
      identifier: dto.identifier,
      password: dto.password,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
      rememberMe: dto.rememberMe,
    });

    // Clear any stale duplicate refresh_token cookies before setting the new one
    res.clearCookie("refresh_token", { path: "/" });
    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * (dto.rememberMe ? 30 : 1),
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post("register")
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post("registration/verify-email")
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyEmail(dto);

    if (result.refreshToken) {
      res.clearCookie("refresh_token", { path: "/" });
      res.cookie("refresh_token", result.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 1000 * 60 * 60 * 24 * 30,
      });
    }

    return { accessToken: result.accessToken, user: result.user };
  }

  @Get("oauth/:provider/start")
  async oauthStart(
    @Param("provider") provider: string,
    @Query("role") role: string,
    @Query("redirect") redirectUrl: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.auth.getOAuthStartUrl({ provider, role, redirectUrl });
    return res.redirect(url);
  }

  @Get("oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") provider: string,
    @Query() query: Record<string, string | undefined>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];

    const result = await this.auth.handleOAuthCallback({
      provider,
      query,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    if (result.refreshToken) {
      res.clearCookie("refresh_token", { path: "/" });
      res.cookie("refresh_token", result.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 1000 * 60 * 60 * 24 * 30,
      });
    }

    return res.redirect(result.redirectUrl);
  }

  @Post("oauth/complete")
  async oauthComplete(
    @Body() dto: OAuthCompleteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];

    const result = await this.auth.completeOAuth({
      ...dto,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    res.clearCookie("refresh_token", { path: "/" });
    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];

    // When multiple refresh_token cookies exist (e.g. leftover from a previous
    // session on the same localhost), cookie-parser returns the first (oldest).
    // We always want the LAST one in the raw header because browsers append new
    // cookies after existing ones, so the last entry is always the newest.
    const rawCookie = (req.headers.cookie as string) ?? "";
    const matches = [...rawCookie.matchAll(/(?:^|;\s*)refresh_token=([^;]+)/g)];
    const rt = matches.length > 0
      ? decodeURIComponent(matches[matches.length - 1][1].trim())
      : ((req.cookies?.["refresh_token"] as string | undefined) ?? "");

    const result = await this.auth.refresh({
      refreshToken: rt,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    // Clear duplicates then set the single rotated cookie
    res.clearCookie("refresh_token", { path: "/" });
    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("oauth/session")
  async oauthSession(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];
    const auth = String(req.headers["authorization"] || "");
    const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    const result = await this.auth.oauthSession({
      accessToken,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    res.cookie("refresh_token", result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return { accessToken: result.accessToken, user: result.user };
  }

  @UseGuards(JwtGuard)
  @Post("logout")
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];
    const rawCookie2 = (req.headers.cookie as string) ?? "";
    const logoutMatches = [...rawCookie2.matchAll(/(?:^|;\s*)refresh_token=([^;]+)/g)];
    const rt = logoutMatches.length > 0
      ? decodeURIComponent(logoutMatches[logoutMatches.length - 1][1].trim())
      : ((req.cookies?.["refresh_token"] as string | undefined) ?? undefined);

    await this.auth.logout({
      refreshToken: rt,
      userId: req.user?.id,
      ip,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
    });

    res.clearCookie("refresh_token", { path: "/" });
    return { ok: true };
  }

  @UseGuards(JwtGuard)
  @Post("logout-all")
  async logoutAll(@Req() req: any) {
    await this.auth.logout({
      revokeAll: true,
      userId: req.user.id,
    });
    return { ok: true };
  }
}
