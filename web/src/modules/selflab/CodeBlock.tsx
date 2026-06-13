// Minimal, dependency-free syntax tinting for the evolved operator's source.
// Not a real parser — just regex token classes, enough to make Python/pseudocode
// read like code on the blueprint canvas (keywords cyan, numbers amber, strings mint).

const KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "while", "in", "not", "and",
  "or", "is", "None", "True", "False", "lambda", "with", "as", "import",
  "from", "class", "yield", "break", "continue", "pass", "min", "max", "sum",
  "len", "sorted", "abs", "any", "all", "self",
]);

type Tok = { text: string; cls: string };

function tokenizeLine(line: string): Tok[] {
  const toks: Tok[] = [];
  // split on a comment first (everything after # is a comment)
  const hash = line.indexOf("#");
  const code = hash >= 0 ? line.slice(0, hash) : line;
  const comment = hash >= 0 ? line.slice(hash) : "";

  // token regex: strings | numbers | identifiers | operators/punct | whitespace
  const re = /("[^"]*"|'[^']*'|\d+\.?\d*|[A-Za-z_]\w*|[^\sA-Za-z0-9_]+|\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const t = m[0];
    let cls = "tk-plain";
    if (/^\s+$/.test(t)) cls = "tk-ws";
    else if (/^["']/.test(t)) cls = "tk-str";
    else if (/^\d/.test(t)) cls = "tk-num";
    else if (/^[A-Za-z_]\w*$/.test(t)) cls = KEYWORDS.has(t) ? "tk-kw" : "tk-id";
    else cls = "tk-op";
    toks.push({ text: t, cls });
  }
  if (comment) toks.push({ text: comment, cls: "tk-comment" });
  return toks;
}

export function CodeBlock({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre className="sl-code mono">
      <code>
        {lines.map((line, i) => (
          <span className="sl-code-line" key={i}>
            <span className="sl-code-gutter num">{i + 1}</span>
            <span className="sl-code-src">
              {tokenizeLine(line).map((t, j) => (
                <span key={j} className={t.cls}>{t.text}</span>
              ))}
              {line.length === 0 && " "}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
