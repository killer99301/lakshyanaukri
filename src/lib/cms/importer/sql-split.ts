// ═══════════════════════════════════════════════════════════
// Splitting a SQL file into statements
// ═══════════════════════════════════════════════════════════
//
// Pure. The Neon driver runs one statement per query, so a schema file is
// sent as a list of statements (in one transaction). Semicolons inside
// quoted strings, quoted identifiers, comments and dollar-quoted function
// bodies ($fn$ … $fn$) do not end a statement.

export function splitSqlStatements(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    // -- line comment: dropped
    if (ch === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    // /* block comment */: dropped
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    // 'string' or "identifier", with doubled quotes inside
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch && text[j + 1] === ch) { j += 2; continue; }
        if (text[j] === ch) break;
        j++;
      }
      current += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // $tag$ … $tag$
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? text.length : end + tag[0].length;
        current += text.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
