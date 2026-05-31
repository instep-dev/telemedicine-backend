import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PrismaModule } from "prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ProfileModule } from "./profile/profile.module";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ConsultationsModule } from "./consultations/consultations.module";
import { TwilioModule } from "./twilio/twilio.module";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { AiModule } from "./ai-summary/ai.module";
import { CallModule } from "./call/call.module";
import { AiResultsModule } from "./ai-results/ai-results.module";
import { SoapNotesModule } from "./soap-notes/soap-notes.module";
import { MulterModule } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { TenantModule } from "./tenant/tenant.module";
import { TenantMiddleware } from "./tenant/tenant.middleware";
import { SuperAdminModule } from "./super-admin/super-admin.module";
import { AdminManagementModule } from "./admin-management/admin-management.module";

const uploadsDir = join(process.cwd(), "uploads", "profiles");

if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      { ttl: 60000, limit: 100 },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "uploads"),
      serveRoot: "/uploads",
    }),
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, uploadsDir);
        },
        filename: (_req, file, cb) => {
          const timestamp = Date.now();
          const ext = file.mimetype.split("/")[1];
          cb(null, `${timestamp}-${randomBytes(8).toString("hex")}.${ext}`);
        },
      }),
    }),
    PrismaModule,
    TenantModule,
    SuperAdminModule,
    AdminManagementModule,
    AuthModule,
    ProfileModule,
    ConsultationsModule,
    TwilioModule,
    AiModule,
    CallModule,
    AiResultsModule,
    SoapNotesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes("*");
  }
}
