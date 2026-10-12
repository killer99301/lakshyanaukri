// ═══════════════════════════════════════════════════════════
// Keeping a job's syllabus in the library, automatically
// ═══════════════════════════════════════════════════════════
//
// Server-only. Called after a syllabus or exam pattern has been saved on a
// job. If the library has nothing for that exam, the job's content is added
// to it (see library-from-job.ts). Rules:
//
//   - An entry added by hand is never replaced, and a job already covered by
//     one adds nothing.
//   - An entry made here is refreshed only by the job it came from.
//   - It can never fail or slow the save it follows: every problem is
//     swallowed and reported as "nothing saved".

import type { RecruitmentRecord } from "@/types/recruitment-record";
import { formatDate } from "@/lib/utils";
import { examKey, suggestFromLibrary } from "@/lib/cms/syllabus-library";
import { listLibrary, saveLibraryFile } from "@/lib/cms/syllabus-library-repository";
import { autoBasis, buildLibraryFile, isAutoEntryOf, libraryExamName } from "@/lib/cms/library-from-job";

export interface LibraryAutosave {
  /** The exam the entry is kept under. */
  exam: string;
  /** True when an entry this job made earlier was brought up to date. */
  refreshed: boolean;
}

export async function rememberSyllabusInLibrary(record: RecruitmentRecord, adminId: string, todayIso: string): Promise<LibraryAutosave | null> {
  try {
    const syllabus = record.syllabus?.value ?? [];
    const examPattern = record.examPattern?.value ?? [];
    if (syllabus.length === 0 && examPattern.length === 0) return null;
    const title = record.identity.title?.value ?? "";
    const names = [title, record.identity.shortTitle?.value, record.identity.organizationName];

    const library = await listLibrary();
    const matching = suggestFromLibrary(library, names);
    const own = matching.find((e) => isAutoEntryOf(e.basis, record.slug)) ?? library.find((e) => isAutoEntryOf(e.basis, record.slug));
    // Covered already by an entry this job did not make: leave the library alone.
    if (!own && matching.length > 0) return null;

    const exam = own?.exam ?? libraryExamName(record.identity.shortTitle?.value || title);
    if (!exam) return null;
    // The same exam under a name someone else entered: never replace it.
    if (!own && library.some((e) => examKey(e.exam) === examKey(exam))) return null;

    const file = buildLibraryFile({
      exam,
      basis: autoBasis(title, record.slug, formatDate(todayIso)),
      examPattern,
      syllabus,
    });
    await saveLibraryFile(file, adminId);
    return { exam, refreshed: Boolean(own) };
  } catch (err) {
    console.error("[CMS] syllabus library autosave skipped:", err instanceof Error ? err.message : "error");
    return null;
  }
}
