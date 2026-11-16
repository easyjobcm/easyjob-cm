/**
 * Générateur PDF minimal, sans dépendance (lot 13).
 *
 * PDF 1.4, A4, polices standard Helvetica et Helvetica-Bold (aucune police
 * embarquée) en codage WinAnsi : couvre les lettres accentuées du français,
 * « », ’, –, — et €. Les espaces insécables (dont l'espace fine des montants
 * fr-FR) deviennent des espaces ; un caractère hors WinAnsi devient « ? ».
 * Le texte est écrit en chaînes hexadécimales : aucun échappement, aucun
 * contenu interprété. Mise en page en blocs, retour à la ligne par mots,
 * pagination et pied de page « n / N ».
 */

export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string; muted?: boolean; bold?: boolean }
  | { kind: "bullet"; text: string }
  | { kind: "spacer" };

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const FOOTER_Y = 32;

// Unicode → WinAnsi (CP1252), hors plage Latin-1 directe.
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85, // …
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c, // Œ
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92, // ’
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c, // œ
  0x017e: 0x9e,
  0x0178: 0x9f,
};
const SPACES = new Set([
  0x00a0, 0x202f, 0x2007, 0x2009, 0x200a, 0x2002, 0x2003,
]);

/** Octets WinAnsi d'un texte (NFC ; « ? » pour un caractère non couvert). */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFC").replace(/→/g, "->")) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    if (SPACES.has(cp)) out.push(0x20);
    else if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out.push(0x20);
    else if (cp >= 0x20 && cp <= 0x7e) out.push(cp);
    else if (cp >= 0xa1 && cp <= 0xff) out.push(cp);
    else if (WIN_ANSI_EXTRA[cp] !== undefined) out.push(WIN_ANSI_EXTRA[cp]);
    else out.push(0x3f);
  }
  return out;
}

// Chasses Helvetica (1/1000 em), codes 32 à 126 ; lettres accentuées comme
// leur lettre de base. Servent seulement au retour à la ligne.
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const BASE_LETTER: Record<number, number> = {};
for (const [base, accented] of [
  ["a", "àáâãäå"],
  ["A", "ÀÁÂÃÄÅ"],
  ["e", "èéêë"],
  ["E", "ÈÉÊË"],
  ["i", "ìíîï"],
  ["I", "ÌÍÎÏ"],
  ["o", "òóôõö"],
  ["O", "ÒÓÔÕÖ"],
  ["u", "ùúûü"],
  ["U", "ÙÚÛÜ"],
  ["c", "ç"],
  ["C", "Ç"],
  ["n", "ñ"],
  ["N", "Ñ"],
  ["y", "ýÿ"],
  ["Y", "Ý"],
] as const) {
  for (const ch of accented) {
    BASE_LETTER[toWinAnsi(ch)[0]] = base.charCodeAt(0);
  }
}
const SPECIAL_WIDTHS: Record<number, number> = {
  0x80: 556,
  0x85: 1000,
  0x8c: 1000,
  0x92: 222,
  0x95: 350,
  0x96: 556,
  0x97: 1000,
  0x9c: 944,
  0xab: 556,
  0xb0: 400,
  0xbb: 556,
};

function byteWidth(b: number): number {
  const base = BASE_LETTER[b] ?? b;
  if (base >= 32 && base <= 126) return ASCII_WIDTHS[base - 32];
  return SPECIAL_WIDTHS[b] ?? 556;
}

/** Largeur en points d'un texte (gras : marge de sécurité de 8 %). */
export function textWidth(text: string, size: number, bold = false): number {
  const units = toWinAnsi(text).reduce((sum, b) => sum + byteWidth(b), 0);
  return (units * size * (bold ? 1.08 : 1)) / 1000;
}

/** Lignes d'au plus `width` points (mot trop long : coupé). */
export function wrapText(
  text: string,
  size: number,
  width: number,
  bold = false,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, bold) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (textWidth(rest, size, bold) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > width) {
        cut -= 1;
      }
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

const hex = (text: string) =>
  `<${toWinAnsi(text)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}>`;

const num = (n: number) => (Math.round(n * 100) / 100).toString();

type Style = { font: "F1" | "F2"; size: number; color: string; gap: number };

const STYLES: Record<Exclude<PdfBlock["kind"], "spacer">, Style> = {
  title: { font: "F2", size: 18, color: "0.486 0.227 0.929 rg", gap: 10 },
  heading: { font: "F2", size: 12, color: "0.1 0.1 0.1 rg", gap: 4 },
  text: { font: "F1", size: 10, color: "0.1 0.1 0.1 rg", gap: 3 },
  bullet: { font: "F1", size: 10, color: "0.1 0.1 0.1 rg", gap: 2 },
};

/** Octets d'un document PDF composé des blocs donnés. */
export function renderPdf(
  blocks: PdfBlock[],
  options: { title: string; footer: string },
): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  const ensure = (height: number) => {
    if (y - height < MARGIN) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };
  const draw = (text: string, x: number, style: Style, color = style.color) => {
    pages[pages.length - 1].push(
      `BT ${color} /${style.font} ${style.size} Tf ${num(x)} ${num(y)} Td ${hex(text)} Tj ET`,
    );
  };

  for (const block of blocks) {
    if (block.kind === "spacer") {
      y -= 8;
      continue;
    }
    const base = STYLES[block.kind];
    const style: Style =
      block.kind === "text" && block.bold ? { ...base, font: "F2" } : base;
    const color =
      block.kind === "text" && block.muted ? "0.4 0.4 0.4 rg" : style.color;
    const leading = style.size * 1.35;
    const indent = block.kind === "bullet" ? 14 : 0;
    const lines = wrapText(
      block.text,
      style.size,
      CONTENT_WIDTH - indent,
      style.font === "F2",
    );
    if (block.kind === "heading") {
      y -= 6;
      // Un intitulé n'est jamais seul en bas de page.
      ensure(leading * 2);
    }
    lines.forEach((line, i) => {
      ensure(leading);
      y -= leading;
      if (block.kind === "bullet" && i === 0) {
        draw("•", MARGIN + 2, style, color);
      }
      draw(line, MARGIN + indent, style, color);
    });
    y -= style.gap;
  }

  const total = pages.length;
  pages.forEach((ops, i) => {
    const label = `${options.footer} · ${i + 1} / ${total}`;
    ops.push(
      `BT 0.4 0.4 0.4 rg /F1 8 Tf ${num(MARGIN)} ${FOOTER_Y} Td ${hex(label)} Tj ET`,
    );
  });

  // Objets : 1 catalogue, 2 pages, 3-4 polices, 5 infos, puis par page
  // l'objet page et son flux.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${total} >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const utf16 = Array.from(options.title)
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0x3f;
      return (cp > 0xffff ? 0x3f : cp).toString(16).padStart(4, "0");
    })
    .join("");
  objects[5] = `<< /Title <feff${utf16}> /Producer (EasyJob CM) >>`;
  pages.forEach((ops, i) => {
    const pageId = pageIds[i];
    const stream = ops.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // En-tête binaire (Latin-1), puis uniquement de l'ASCII (texte en
  // hexadécimal) : longueur en caractères = longueur en octets.
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  const header = Buffer.from(out, "latin1").length;
  let body = "";
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = header + body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = header + body.length;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out +=
    body +
    xref +
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
