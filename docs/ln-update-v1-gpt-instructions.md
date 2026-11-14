# LN Update v1: instructions for GPT

Paste everything between the two lines into GPT, together with the official notice (its text, PDF or link) and the job's current title. GPT's answer is pasted into the CMS ("Update this job"). The CMS reads it with code, compares it with the job and shows you the changes. Nothing is saved until you tick and save, and nothing is published until you publish.

---

You prepare an update for one existing recruitment on LakshyaNaukri, from the official notice I give you. Write ONLY what the notice says. Follow this format exactly. It is read by a program, not a person.

**1. The first line is exactly:** `LN Update v1`

**2. The header comes next**, one item per line, then a blank line:

```
Job: <the job's title, exactly as I gave it to you>
Notice number: <as printed, or None>
Organisation: <the recruiting body, as printed>
Update type: <one of: Correction, New information, Corrigendum, Schedule, Result, Admit card, Answer key, Cut-off, Postponement, Cancellation>
Source: <the notice's title>, dated <D Mon YYYY>
Source link: <the notice's web address, if you have it>
```

**3. Write only the sections the notice changes or adds.** Leave every other section out completely.
- Never write "unchanged" or "same as before".
- A section you leave out is kept as it is.

**4. When the notice clearly says something is absent**, write that state instead of leaving the section out:
- `Not specified in the notice`: the notice says nothing is prescribed.
- `Not applicable`: the item does not exist for this recruitment.

Never use these just because this particular notice does not mention a section.

**5. Each list holds only the items that change.** If only Mathematics changes, write only Mathematics; the other subjects are kept.
- Write `Complete list` on the section heading or on the `Stage:` line ONLY when the notice gives the whole list and it must replace what is on record.

**6. Every exam pattern and syllabus block starts with a `Stage:` line** naming the stage exactly as the notice names it.
- If it differs by post or paper, add `| Post: <name>` and/or `| Paper: <name>`.
- A stage name alone is not enough when posts have different papers.

**7. Removing something:** only when the notice removes it, write one line per item:
- `Remove: Post: <name>`
- `Remove: Stage: <name>`
- `Remove: Subject: <name> | Stage: <stage>`
- `Remove: Link: <address>`

**8. Web addresses go only under Important Links**, on the header's `Source link:` line, on a stage's `Notice:` part, or on a `Supersede` line's `Source:` part. Never invent or guess an address.

**9. Never invent anything:** topics, questions, marks, dates or links. Never put a coaching site's own tips in the syllabus.

**10. Dates are written `D Mon YYYY`** (`27 Oct 2026`).
- A stage over continuous days: `From: <first day> | Until: <last day>`.
- Separate days: `Date: 23 & 25 Nov 2026`.
- Add `As written: <the notice's own words>` when the notice describes the schedule in words.
- Every stage that has a date must also say `Tentative` or `Confirmed`. A date without one is not applied, because the CMS never guesses.
- **Fees:** name every category the notice names, as written. Use `Nil` or `Exempted` for no fee. Where fees differ by post, write one line per post: `Application Fee (Assistant Manager): …`.
- **Age:** a line with only the age relaxation can't be applied on its own. Repeat the `Age Limit:` line with it.

**11. Announcement:** write at most one, and only when there is real news for applicants. For a Correction (fixing an earlier mistake on our site) write no announcement.
- `Action:` (optional) names which of the job's official links the notice's button opens: `Admit card`, `Result`, `Answer key`, `Apply Online`, `Official Notification`. Give the address itself under Important Links, never here.
- `Stage:` (optional) names the stage the notice is about, exactly as under Exam Stages, so that two admit cards of one job stay two separate notices.
- `Relevant until:` (optional) only when the notice itself gives the last day it matters, such as the exam day or the last day to download. Never estimate it.

**12. Supersede:** list our earlier announcements that this notice shows were wrong or outdated, with a short reason (under 200 characters).

**13. Never write who made the change** (no "By:", no names or IDs). The CMS records that itself.

### The sections (use only the ones needed)

```
Exam Stages:
Stage: <name> | Status: <Scheduled | Admit card out | Postponed | Conducted | Result declared | Not declared> | From: <date> | Until: <date> | Date: <date> | As written: <words> | Notice: <address> | Tentative|Confirmed
Note: <a short fact about the stage above, from the notice>

Selection Process:
Stage: <name>
Stage: <name> | Qualifying
Merit List: <how the final merit is made, as written>

Exam Pattern:
Stage: <name> | Paper: <name> | Post: <name> | Mode: <as written> | Duration: <N> minutes | Negative marking: <as written>
Subject: <subject>: <N> Questions, <M> Marks
Total: <N> Questions, <M> Marks
Note: <e.g. Qualifying in nature>

Syllabus:
Stage: <name> | Paper: <name> | Post: <name>
Subject: <subject>: <topic>; <topic>; <topic>

Application Fee: General/EWS/OBC Rs. <amount>, SC/ST/PwBD Nil, Women Exempted
Application Fee (<post>): General Rs. <amount>, SC/ST Rs. <amount>
Age Limit: Minimum <X> years, Maximum <Y> years as on <D Mon YYYY>
Age Relaxation: <as written>
Eligibility: <as written>

Important Links:
Apply Online: <label> | <address> | For: <who uses this portal>
Official Notification: <label> | <address>
Result: <label> | <address>
Admit Card: Not yet released

Announcement:
Title: <one line>
Text: <two or three short sentences, facts only>
Action: <Admit card | Result | Answer key | Apply Online | Official Notification>
Stage: <the stage's name>
Relevant until: <D Mon YYYY, only if the notice says>

Supersede:
<D Mon YYYY> – <the earlier announcement's title> | Reason: <short reason> | Source: <official address> | Replaced by: <this update's announcement title, if it gives the correct information>
```

---

## Example

**SYNTHETIC: an invented recruitment, for illustration only.**

```text
LN Update v1
Job: Example Steel Plant Apprentice Recruitment 2026-27
Notice number: None
Organisation: Example Steel Limited, Example Steel Plant
Update type: Correction
Source: Example apprentice advertisement 2026-27, dated 30 Sep 2026
Source link: https://careers.example.in/apprentice-2026.pdf

Exam Stages:
Stage: Walk-in Document Verification | Status: Scheduled | From: 27 Oct 2026 | Until: 21 Nov 2026 | As written: 27 Oct – 21 Nov 2026 (trade-wise) | Confirmed
Note: Held trade by trade. Each trade has its own days within this period.

Important Links:
Apply Online: NATS portal | https://nats.example.gov.in/ | For: Graduate and Diploma apprentices
Apply Online: Apprenticeship portal | https://apprentice.example.gov.in/ | For: ITI trade apprentices

Supersede:
24 Oct 2026 – Walk-in Document Verification rescheduled | Reason: arose from CMS date corrections, not an official notice
```
