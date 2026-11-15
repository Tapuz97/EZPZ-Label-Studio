const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Wrap long Unicode runs without cutting surrogate pairs or joined emoji. */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > width) {
        lines.push(line);
        line = "";
      }
      if (measure(word) > width) {
        for (const { segment } of graphemes.segment(word)) {
          if (line && measure(line + segment) > width) {
            lines.push(line);
            line = "";
          }
          line += segment;
        }
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}
