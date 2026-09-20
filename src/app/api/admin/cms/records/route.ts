// ═══════════════════════════════════════════════════════════
// GET  /api/admin/cms/records  — list all recruitment records
// POST /api/admin/cms/records  — create a new record
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { sql } from "@/lib/db";
import { makePendingField } from "@/lib/cms/validation";
import {
  createRecruitment,
  type CreateRecruitmentParams,
} from "@/lib/cms/repository";
import type { GovernmentType } from "@/types/recruitment-record";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const rows = await sql`
      SELECT
        id, slug, draft_state, record_revision,
        organization_id, organization_name, title_text, gov_type,
        created_at, updated_at
      FROM recruitments
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return NextResponse.json({ records: rows });
  } catch (err) {
    console.error("[CMS] list error", err);
    return NextResponse.json({ error: "Failed to load records" }, { status: 500 });
  }
}

interface CreateBody {
  organizationId: string;
  organizationName: string;
  govType?: GovernmentType;
  title: string;
  recruitmentYear: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { organizationId, organizationName, govType, title, recruitmentYear } = body;
  if (!organizationId || !title || !recruitmentYear) {
    return NextResponse.json(
      { error: "organizationId, title, and recruitmentYear are required" },
      { status: 400 },
    );
  }

  const slug = buildSlug(organizationId, title, recruitmentYear);

  const params: CreateRecruitmentParams = {
    slug,
    identity: {
      organizationId,
      organizationName: organizationName ?? organizationId,
      govType,
      recruitmentYear,
      title: makePendingField(title),
    },
    provenance: {
      status: "NOT_VERIFIED",
      lastVerifiedAt: new Date().toISOString().slice(0, 10),
      primarySourceType: "NOT_VERIFIED",
    },
    adminId: auth.adminId,
  };

  try {
    const record = await createRecruitment(params);
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    console.error("[CMS] create error", err);
    if (String(err).includes("unique")) {
      return NextResponse.json(
        { error: `Slug "${slug}" already exists. Use a different title or year.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Failed to create record" }, { status: 500 });
  }
}

function buildSlug(orgId: string, title: string, year: number): string {
  const titlePart = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${orgId}-${titlePart}-${year}`;
}
