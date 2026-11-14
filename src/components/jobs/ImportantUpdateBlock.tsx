// P1 (CMS 2.0, Nov 2026): the most relevant current notice of a recruitment, chosen by pickImportantUpdate.
// Replaces the old "newest announcement" banner. Every announcement stays in the page's update history.
// R1: styled with the premium design system's status tokens (globals.css --ln-*): blue for something to download
// or open, red only for an urgent change, neutral for routine news. Links say where they go: a notice is called
// "Official notice" only when it is on the recruiting body's own site; otherwise it is a source, named by its host.
import React from "react";
import { AlertTriangle, Download, ExternalLink, Info } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { isFreshUpdate } from "@/lib/lifecycle";
import { NewBadge } from "@/components/common/NewBadge";
import type { ImportantUpdate } from "@/lib/important-update";

const LOOK = {
  URGENT: { box: "bg-ln-urgent-soft border-ln-urgent-line", chip: "text-ln-urgent bg-white border-ln-urgent-line", icon: "bg-ln-urgent", button: "bg-ln-urgent hover:brightness-110", heading: "Important update" },
  ACTION: { box: "bg-ln-action-soft border-ln-action-line", chip: "text-ln-action bg-white border-ln-action-line", icon: "bg-ln-action", button: "bg-ln-action hover:brightness-110", heading: "Important update" },
  INFO: { box: "bg-white border-ln-line", chip: "text-ln-past bg-ln-past-soft border-ln-past-line", icon: "bg-ln-past", button: "bg-ln-ink hover:brightness-125", heading: "Latest update" },
} as const;

const shownDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDate(d) : d);

export function ImportantUpdateBlock({ item, now }: { item: ImportantUpdate; now: Date }) {
  const look = LOOK[item.tone];
  const u = item.update;
  const Icon = item.tone === "URGENT" ? AlertTriangle : item.tone === "ACTION" ? Download : Info;
  const notice = item.notice && item.notice.url !== item.action?.url ? item.notice : null;
  return (
    <section data-important-update={item.tone.toLowerCase()} aria-labelledby="important-update-title"
      className={`${look.box} border rounded-2xl ${item.tone === "INFO" ? "p-3.5" : "p-4 sm:p-5"} text-ln-text`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`${item.tone === "INFO" ? "h-8 w-8" : "h-10 w-10"} rounded-xl ${look.icon} text-white grid place-items-center shrink-0`} aria-hidden="true">
            <Icon className={item.tone === "INFO" ? "h-4 w-4" : "h-5 w-5"} />
          </div>
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-ln-muted">{look.heading}</span>
              <span data-important-status className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${look.chip}`}>{item.status}</span>
              {isFreshUpdate(u, now) && <NewBadge />}
              <span className="text-[13px] font-semibold text-ln-muted">{u.sourceUrl ? "Notice dated" : "Updated"} {formatDate(u.date)}</span>
            </div>
            <h4 id="important-update-title" className={`${item.tone === "INFO" ? "text-[15px]" : "text-base sm:text-lg"} font-extrabold text-ln-ink leading-snug break-words`}>{u.title}</h4>
            {item.stage && (
              <div data-important-stage className="text-[13px] font-semibold text-ln-text">
                {item.stage.name}{item.stage.when ? ` · ${shownDate(item.stage.when)}` : ""}
              </div>
            )}
            {u.description && <p className="text-sm text-ln-text leading-relaxed break-words">{u.description}</p>}
            {item.noAction && <p data-important-no-action className="text-[13px] text-ln-muted">{item.noAction}</p>}
            <div className="pt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-bold">
              {notice && (
                <a data-important-notice href={notice.url} target="_blank" rel="noopener noreferrer" className="text-ln-action underline underline-offset-2 inline-flex items-center gap-1">
                  {notice.official ? "Official notice" : `Source: ${notice.host ?? "notice"}`} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
              <a href="#updates-history" className="text-ln-text underline underline-offset-2">Earlier updates</a>
            </div>
          </div>
        </div>
        {item.action && (
          <div className="w-full sm:w-auto shrink-0 grid gap-1 sm:justify-items-end">
            <a data-important-action href={item.action.url} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl ${look.button} text-white font-bold text-sm w-full sm:w-auto`}>
              <span>{item.action.label}</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            {item.action.host && (
              <span data-important-host className="text-xs text-ln-muted text-center sm:text-right">
                {item.action.official ? `Official site · ${item.action.host}` : `Opens ${item.action.host}`}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
