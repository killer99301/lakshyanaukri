# Smart Recruitment Assistant — how it is built, and what comes next

Status on 2026-10-25: local only, in the `feature/importer` worktree. Nothing is deployed and
no production database has been changed.

The assistant is an extra way to fill the **existing** CMS. It has no jobs table or editor
of its own. AI Assist, the prepared-file parser, manual entry, Check for updates, publish,
revert and take-down work as before, and none of them depends on it.

## Modules

Each part can be changed on its own; they meet only at plain data types.

| Module | Files | What it does |
|---|---|---|
| Input recognition | `importer/service.ts` (`obtain`, `imageType`) | Pasted text, PDF upload (text layer or scan), image (PNG/JPEG/WebP), or an address fetched by the server. Each becomes one *retrieval* with its text and SHA-256. |
| Source processing | `importer/fetch-source.ts`, `scan-reader.ts` | Safe fetch: public addresses only, every redirect checked, 4 MB cap. Scans and images are written out as text by the AI. The original file is not kept. |
| Field extraction and mapping | `importer/extract.ts`, `importer/article.ts`, AI Assist readers | AI Assist's topic readers first (their checks are strictest), then one whole-text reading for everything else: vacancy breakdown, exam stages, category-wise age, pattern, syllabus, selection, how to apply, notes. Every value must quote the source word for word. Each value is then passed through the editor's own field builder, so the preview only offers what the editor would store. |
| Links | `importer/links.ts`, `importer/trusted-domains.ts` | Addresses with or without `https://`; their type comes from the address and from the words just before it. Only hosts on an organisation's list are official, and a partner only for its stated purpose (`btsc.pariksha.nic.in`: applications only). |
| Proposal | `importer/proposal.ts` | One item per value or link: fill, same, replace, replace-checked; conflicts; corrigendum supersession; a passed last date is flagged but never changed; warnings for a missing official notification or apply link and for research-only imports. |
| Evidence and verification | `importer/schema.sql`, `importer/classify.ts`, `importer/repository.ts` | Claims and decisions bound to the field's exact current revision; the editor badges and the publish gate are worked out from them. The field's own CMS status is never changed. |
| Review and saving | `admin/cms/import/*`, `importer/apply-build.ts` | Three steps: provide, review, save as draft. One transaction (`cms_apply_import`): everything ticked is saved, or nothing is. |
| Job discovery | `importer/discover.ts`, `api/admin/cms/import/discover` | On demand, one listing page, only if its robots.txt allows. No crawling, no logins, no AI. Results are sorted into new announcements and updates and matched against jobs already in the CMS. Picking one opens Smart intake with the page as research. |
| Existing-job updates | Smart intake into a job (`?record=`), Check for updates (unchanged) | A corrigendum or a newer source is previewed against the job. A checked value can only be replaced with a second confirmation, and it then needs checking again. |

## What the AI is trusted with

- It reads text and must quote it. A quote that is not in the source, or that does not
  contain the value, is refused; refusals are listed in the preview.
- It never decides what is official (that comes from the code's host list), never verifies
  anything, and never publishes.
- Images and scans are the AI's own reading of a picture. Their values say so, and they
  can only support a check when the admin has attested the copy.

## Next milestones (not built yet)

1. **AI Research** ("Research BTSC FSO 2026 and prepare the record"). This needs a search
   service. The likely choice is Gemini with Google Search grounding, used under the same
   daily cap. Official domains (from the host list) are searched first; portals are used
   only as research. Every page found goes through the same Smart intake path as a source,
   so nothing about trust or saving changes. Open question for the owner: which search
   service, and how much of the daily cap it may use.
2. **Recurring discovery.** The same one-page reader, run on a schedule for owner-chosen
   listing pages, feeding a review queue. This needs a small queue table and a Vercel cron.
   It would never create jobs on its own: the queue offers "Smart intake →" exactly as today.
3. **Existing-job intelligence.** Discovery already marks "Update" announcements that match a
   job ("bring this into it"). The next step is to run Check for updates or Smart intake
   automatically on those matches and list the proposed changes for review.
4. **Host list in the admin.** Today trusted hosts live in code
   (`importer/trusted-domains.ts`), and an organisation that is not listed cannot have its
   fields checked. An admin screen for owner-approved hosts would avoid a code change for each
   new body.
5. **Real-AI acceptance.** The whole-text reading has only run against the local stand-in.
   Run the BTSC article, the LIC PDF and a screenshot with a dedicated Gemini test key before
   relying on it.

## Before production

The importer tables need the migration `scripts/cms-add-importer-tables.ts` to run on Neon
before this code is deployed: the publish route reads `recruitment_imports`. Before that,
take a Neon recovery point, confirm the importer switch key in Redis (it defaults to off),
and re-run the PostgreSQL 18 concurrency test.
