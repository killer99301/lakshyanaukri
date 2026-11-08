# Apply Online link — policy proposal (report only, no gate change)

Written 8 Nov 2026 for the owner, as part of the end-to-end safety corrections. Nothing below is implemented.
The publish gate is unchanged.

## What the gate does today

- "Apply Online link" (`links#APPLY_ONLINE`) is a Tier A field: an imported job publishes only when it is
  **Verified** or **Not applicable — reviewed**. "Not stated" is refused for Tier A.
- **Verified** needs a link value, an official confirmed or attested document, and the words that give the
  link (on the cited page, for a PDF — checked from this pass).
- **Not applicable** needs the words from the official document (quote, page for a PDF) and a reason of at
  least 10 characters. It does not need a link value.
- The public page shows no Apply button without a link (G1: no website fallback).

## The four cases and how they fare

| Case | Example words in the notice | Today | Proposal |
|---|---|---|---|
| 1. Documented offline process | "Applications in the prescribed format must reach … by Speed Post" | Can publish: record **Not applicable** with that line and a reason ("offline application by post"). | **No change.** Only explain it in the check list: "Offline application? Record Not applicable with the line that says how to apply." |
| 2. Link not yet announced | "The online application link will be available on www.… from 01.12.2026" | **Blocked** (no link to verify; not "not applicable", because there will be one). | **Owner decision needed** (below). |
| 3. Notice silent about applying | No application words at all | **Blocked.** | Keep blocked: no safe public statement can be made. |
| 4. Broken or unverified link | Link given, but it fails to open, or is from an unlisted host | **Blocked** unless verified from an official document's words. | Keep blocked. Optionally flag "link did not open when checked" in the check list (no new decision kind). |

## The decision the owner needs to make (case 2)

Options:

- **A. Keep blocked (current).** The job waits until the link exists. Safest; the job may appear late.
- **B. Allow a "Link not yet open" decision for this field only.** It would need: the official words saying
  when or where the link will appear (quote, page for a PDF), a reason, and a public note shown in place of
  the Apply button ("The online application opens on 01.12.2026 at the official website"). The job must then
  show in "Updates needed" until a verified link is added. This is a new decision kind (or a Tier A
  exception for one field), a schema check change and a migration — wider than this pass, so not done.

Recommendation: **A** until the update flow (B) is designed and accepted; case 1 already works.

## Not done in this pass

No gate, decision kind, schema or public-page change for the Apply link.
