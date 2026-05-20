import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

export interface PublicTenant {
  slug: string;
  name: string;
}

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<PublicTenant[]> {
    const rows = await this.prisma.$queryRaw<{ slug: string; name: string }[]>`
      SELECT slug, name
      FROM public.tenant_registry
      WHERE status = 'active'
      ORDER BY name ASC
    `;
    return rows;
  }
}
