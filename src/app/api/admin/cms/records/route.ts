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
import { buildSlug } from "@/lib/cms/slug";
import type { GovernmentType } from "@/types/recruitment-record";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const rows = await sql`
      SELECT
        id, slug, draft_state, record_revision,
        organization_id, organization_name, title_text, gov_type,
        created_at, updated_at, published_at
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
  // Set after the admin has seen the duplicate warning and chosen to continue.
  forceCreate?: boolean;
}

const GOV_TYPES: ReadonlySet<string> = new Set(["Central Govt", "State Govt", "PSU"]);

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

  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const organizationName =
    typeof body.organizationName === "string" && body.organizationName.trim()
      ? body.organizationName.trim()
      : organizationId;
  const recruitmentYear = Number(body.recruitmentYear);
  const govType = body.govType;

  if (!organizationId || !title || !body.recruitmentYear) {
    return NextResponse.json(
      { error: "organizationId, title, and recruitmentYear are required" },
      { status: 400 },
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(organizationId)) {
    return NextResponse.json(
      { error: "Organisation ID must be 2–40 lowercase letters, digits or hyphens" },
      { status: 400 },
    );
  }
  if (organizationName.length > 160) {
    return NextResponse.json({ error: "Organisation name must be 160 characters or fewer" }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: "Title must be 200 characters or fewer" }, { status: 400 });
  }
  if (!Number.isInteger(recruitmentYear) || recruitmentYear < 2000 || recruitmentYear > 2100) {
    return NextResponse.json({ error: "Recruitment year must be a 4-digit year" }, { status: 400 });
  }
  if (govType !== undefined && !GOV_TYPES.has(govType)) {
    return NextResponse.json({ error: "Unknown government type" }, { status: 400 });
  }

  // Warn before creating another record for the same organisation and year.
  // Nothing is created until the admin confirms with forceCreate.
  if (!body.forceCreate) {
    try {
      const existing = await sql`
        SELECT id, slug, draft_state, title_text
        FROM recruitments
        WHERE draft_state != 'ARCHIVED'
          AND organization_id = ${organizationId}
          AND identity->>'recruitmentYear' = ${String(recruitmentYear)}
        ORDER BY updated_at DESC
        LIMIT 5
      `;
      if (existing.length > 0) {
        return NextResponse.json({
          duplicates: existing.map((r) => ({
            id: String(r.id),
            slug: String(r.slug),
            draftState: String(r.draft_state),
            title: r.title_text ? String(r.title_text) : "",
          })),
        });
      }
    } catch (err) {
      console.error("[CMS] duplicate check error", err);
      return NextResponse.json({ error: "Could not check for existing records" }, { status: 500 });
    }
  }

  const slug = buildSlug(organizationId, title, recruitmentYear);

  const params: CreateRecruitmentParams = {
    slug,
    identity: {
      organizationId,
      organizationName,
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
        { error: `A record with the address "${slug}" already exists. Use a different title or year.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Failed to create record" }, { status: 500 });
  }
}
