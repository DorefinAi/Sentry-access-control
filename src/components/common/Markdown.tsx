// A deliberately tiny Markdown renderer for assistant and AI text: paragraphs,
// headings, bullet and numbered lists, **bold**, *italic* and `code`. It builds
// React nodes, so the text is never injected as HTML.
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { MONO_STACK } from "@/providers/MuiProvider";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <Box key={key} component="code" sx={{ fontFamily: MONO_STACK, fontSize: "0.92em", fontWeight: 600 }}>
          {part.slice(1, -1)}
        </Box>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    return part;
  });
}

type Block = { kind: "p"; text: string } | { kind: "h"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const num = /^\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (!line) flush();
    else if (head) {
      flush();
      blocks.push({ kind: "h", text: head[1] });
    } else if (bullet || num) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const text = (bullet ?? num)![1];
      if (last && (last.kind === "ul" || last.kind === "ol") && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] });
    } else para.push(line);
  }
  flush();
  return blocks;
}

export function Markdown({ text, size = "body2" }: { text: string; size?: "body1" | "body2" }) {
  return (
    <Box sx={{ "& > * + *": { mt: 1 }, overflowWrap: "anywhere" }}>
      {parse(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h")
          return (
            <Typography key={k} variant={size} sx={{ fontWeight: 700 }}>
              {inline(b.text, k)}
            </Typography>
          );
        if (b.kind === "p")
          return (
            <Typography key={k} variant={size}>
              {inline(b.text, k)}
            </Typography>
          );
        return (
          <Box key={k} component={b.kind} sx={{ m: 0, pl: 2.5, "& li + li": { mt: 0.25 } }}>
            {b.items.map((it, j) => (
              <Typography key={j} component="li" variant={size}>
                {inline(it, `${k}-${j}`)}
              </Typography>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
