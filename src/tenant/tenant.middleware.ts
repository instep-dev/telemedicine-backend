import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PrismaService } from 'prisma/prisma.service';

interface TenantRow {
  id: string;
  slug: string;
  schema_name: string;
  status: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug = req.headers['x-tenant-slug'];

    if (!slug || typeof slug !== 'string') {
      (req as any).tenant = null;
      return next();
    }

    const rows = await this.prisma.$queryRaw<TenantRow[]>`
      SELECT id, slug, schema_name, status
      FROM public.tenant_registry
      WHERE slug = ${slug}
      LIMIT 1
    `;

    const tenant = rows[0];

    if (!tenant || tenant.status !== 'active') {
      throw new BadRequestException('Invalid or inactive tenant');
    }

    (req as any).tenant = {
      id: tenant.id,
      slug: tenant.slug,
      schemaName: tenant.schema_name,
    };

    next();
  }
}
