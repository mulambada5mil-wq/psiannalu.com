// Montagem da página de um texto do blog. Usado pelo gerador do site (scripts/build.mjs)
// e pela prévia do painel (/admin), para os dois mostrarem exatamente a mesma página.
// Sem nada de Node aqui: este arquivo também roda no navegador.
import { Marked } from "marked";

export const SITE = "https://www.psiannalu.com";
export const FECHAMENTO_PADRAO = "Se este texto fez sentido para você, a análise pode ser um espaço para pensar sobre isso.";
export const OBRIGATORIOS = ["titulo", "data", "categoria", "resumo", "descricao", "capa", "capa_alt"];

export const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Palavra de uma letra ("O", "a", "e") fica grudada na seguinte, sem sobrar sozinha no fim da linha
export const semViuva = (html) => html.replace(/(^|[\s>])(\p{L})\s/gu, "$1$2&nbsp;");
// JSON dentro de <script>: "<" escapado para nenhum texto fechar a tag
export const jsonNoHtml = (obj) => JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
export const dataISO = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
export const slugificar = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");

export const preencher = (modelo, valores) => modelo.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in valores)) throw new Error(`Modelo usa {{${k}}}, que não foi preenchido`);
  return valores[k];
});
// Links do texto: só endereços comuns (nada de javascript:)
const linkSeguro = (href) => /^(https?:|mailto:|\/(?!\/)|#)/i.test(String(href ?? "").trim());
// Imagens no meio do texto: só as do próprio site ou endereços https
const imagemSegura = (src) => /^(\/img\/|https:)/i.test(String(src ?? "").trim());

// Texto colado do Word ou do WhatsApp vem com uma quebra de linha por parágrafo: cada linha vira um parágrafo
const umaLinhaUmParagrafo = (md) => String(md ?? "").replace(/\r\n/g, "\n")
  .replace(/([^\n])\n(?!\n|\s*([-*+]|\d+\.|>|#)\s)/g, "$1\n\n");

function criarMarkdown(dimensoes) {
  return new Marked({
    renderer: {
      // Citação (botão "Destaque" do painel) vira a frase em destaque do blog
      blockquote({ tokens }) {
        return `<p class="lede">${this.parser.parse(tokens).replace(/<\/?p>/g, "").trim()}</p>\n`;
      },
      // Título 1 no meio do texto vira subtítulo: a página já tem o título principal
      heading({ tokens, depth }) {
        const n = Math.min(Math.max(depth, 2), 3);
        return `<h${n}>${this.parser.parseInline(tokens)}</h${n}>\n`;
      },
      // HTML colado no texto é descartado: o texto aparece só com a formatação do painel
      html() {
        return "";
      },
      link({ href, tokens }) {
        const texto = this.parser.parseInline(tokens);
        if (!linkSeguro(href)) return texto;
        const externo = /^https?:/i.test(href);
        return `<a href="${esc(href)}"${externo ? " target=\"_blank\" rel=\"noopener\"" : ""}>${texto}</a>`;
      },
      image({ href, text }) {
        if (!imagemSegura(href)) return "";
        return `<img src="${esc(href)}" ${dimensoes(href)} alt="${esc(text)}" loading="lazy">`;
      },
    },
  });
}

// Lê os campos de um texto (front matter) e calcula o que as páginas usam
export function normalizarPost(campos, slug, corpo) {
  const titulo = String(campos.titulo ?? "").trim();
  const italico = String(campos.titulo_italico ?? "").trim();
  return {
    ...campos,
    slug,
    data: dataISO(campos.data ?? ""),
    titulo,
    italico,
    tituloCompleto: [titulo, italico].filter(Boolean).join(" ").replace(/\.$/, ""),
    corpo: corpo ?? "",
    url: `${SITE}/blog/${slug}/`,
  };
}

// dimensoes(src) devolve 'width="…" height="…"' da imagem (ou "" quando não dá para saber, como na prévia)
export function paginaPost(modelo, p, dimensoes = () => "") {
  const og = p.imagem_compartilhamento || p.capa;
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.tituloCompleto,
    description: p.descricao,
    url: p.url,
    mainEntityOfPage: p.url,
    datePublished: p.data,
    inLanguage: "pt-BR",
    keywords: p.categoria,
    image: SITE + og,
    author: { "@type": "Person", "@id": `${SITE}/#anna`, name: "Anna Luiza Ecard Eyng", jobTitle: "Psicóloga", url: `${SITE}/` },
    publisher: { "@type": "Organization", name: "Annalu Psi", url: `${SITE}/` },
    isPartOf: { "@id": `${SITE}/blog/#blog` },
  };
  const ogDim = dimensoes(og).replace(/width="(\d+)" height="(\d+)"/,
    `<meta property="og:image:width" content="$1">\n<meta property="og:image:height" content="$2">`);
  return preencher(modelo, {
    titulo_completo: esc(p.tituloCompleto),
    descricao: esc(p.descricao),
    url: p.url,
    resumo: esc(p.resumo),
    og_imagem: [`<meta property="og:image" content="${SITE}${esc(og)}">`, ogDim,
      `<meta property="og:image:alt" content="${esc(p.capa_alt)}">`].filter(Boolean).join("\n"),
    schema: jsonNoHtml(schema),
    categoria: esc(p.categoria),
    titulo_h1: semViuva(esc(p.titulo) + (p.italico ? ` <em>${esc(p.italico)}</em>` : "")),
    capa: esc(p.capa),
    capa_dimensoes: dimensoes(p.capa),
    capa_alt: esc(p.capa_alt),
    corpo: criarMarkdown(dimensoes).parse(umaLinhaUmParagrafo(p.corpo)).trim(),
    fechamento: esc(p.fechamento || FECHAMENTO_PADRAO),
  });
}
