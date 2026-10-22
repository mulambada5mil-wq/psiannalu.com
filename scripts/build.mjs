// Gera o site em dist/: copia os arquivos estáticos e monta o blog a partir de content/posts/*.md
// (os .md são escritos pelo painel /admin). Roda na Vercel a cada envio ao GitHub: `npm run build`.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";
import { imageSize } from "image-size";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const DIST = path.join(RAIZ, "dist");
const SITE = "https://www.psiannalu.com";
const NAO_COPIAR = new Set([".git", ".gitignore", ".vercel", "node_modules", "dist", "content", "templates", "scripts", "api",
  "package.json", "package-lock.json", "vercel.json", "COMO-PUBLICAR.txt"]);
const ULTIMA_MUDANCA_PAGINAS = "2026-10-22"; // última alteração manual da página inicial
const FECHAMENTO_PADRAO = "Se este texto fez sentido para você, a análise pode ser um espaço para pensar sobre isso.";
const OBRIGATORIOS = ["titulo", "data", "categoria", "resumo", "descricao", "capa", "capa_alt"];

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Palavra de uma letra ("O", "a", "e") fica grudada na seguinte, sem sobrar sozinha no fim da linha
const semViuva = (html) => html.replace(/(^|[\s>])(\p{L})\s/gu, "$1$2&nbsp;");
const preencher = (modelo, valores) => modelo.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in valores)) throw new Error(`Modelo usa {{${k}}}, que não foi preenchido`);
  return valores[k];
});
// JSON dentro de <script>: "<" escapado para nenhum texto fechar a tag
const jsonNoHtml = (obj) => JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
// Links do texto: só endereços comuns (nada de javascript:)
const linkSeguro = (href) => /^(https?:|mailto:|\/|#)/i.test(String(href ?? "").trim());
const dataISO = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

const markdown = new Marked({
  renderer: {
    // Citação (botão de aspas do painel) vira a frase em destaque do blog
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
      return `<img src="${esc(href)}" ${dimensoes(href)} alt="${esc(text)}" loading="lazy">`;
    },
  },
});

function dimensoes(src) {
  if (!src.startsWith("/")) return "";
  const arquivo = path.join(RAIZ, decodeURIComponent(src));
  if (!arquivo.startsWith(RAIZ + path.sep)) throw new Error(`Imagem fora do site: ${src}`);
  if (!fs.existsSync(arquivo)) throw new Error(`Imagem não encontrada: ${src}`);
  const { width, height } = imageSize(fs.readFileSync(arquivo));
  return `width="${width}" height="${height}"`;
}

function lerPosts() {
  const pasta = path.join(RAIZ, "content", "posts");
  return fs.readdirSync(pasta).filter((f) => f.endsWith(".md")).map((arquivo) => {
    const slug = arquivo.replace(/\.md$/, "");
    const { data: p, content } = matter(fs.readFileSync(path.join(pasta, arquivo), "utf8"));
    const faltando = OBRIGATORIOS.filter((c) => !String(p[c] ?? "").trim());
    if (faltando.length) throw new Error(`Post "${arquivo}" sem: ${faltando.join(", ")}`);
    const titulo = String(p.titulo).trim();
    const italico = String(p.titulo_italico ?? "").trim();
    const tituloCompleto = [titulo, italico].filter(Boolean).join(" ").replace(/\.$/, "");
    return { ...p, slug, data: dataISO(p.data), titulo, italico, tituloCompleto, corpo: content, url: `${SITE}/blog/${slug}/` };
  }).filter((p) => !p.rascunho)
    .sort((a, b) => b.data.localeCompare(a.data) || a.slug.localeCompare(b.slug));
}

function paginaPost(modelo, p) {
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
    corpo: markdown.parse(p.corpo).trim(),
    fechamento: esc(p.fechamento || FECHAMENTO_PADRAO),
  });
}

function paginaBlog(modelo, posts) {
  const cartoes = posts.map((p) => `    <a class="post-card" href="/blog/${p.slug}/">
      <img class="thumb" src="${esc(p.capa)}" width="150" height="200" alt="" loading="lazy">
      <div class="post-text">
      <span class="tag">${esc(p.categoria)}</span>
      <h2>${semViuva(esc(p.tituloCompleto))}</h2>
      <p>${esc(p.resumo)}</p>
      </div>
    </a>`).join("\n");
  const schema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE}/blog/#blog`,
    name: "Blog · Annalu Psi",
    url: `${SITE}/blog/`,
    inLanguage: "pt-BR",
    author: { "@id": `${SITE}/#anna` },
    blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.tituloCompleto, url: p.url, datePublished: p.data })),
  };
  return preencher(modelo, { cartoes, schema: jsonNoHtml(schema) });
}

function paginaInicial(html, posts) {
  const n = html.includes("\r\n") ? "\r\n" : "\n";
  const cartoes = posts.slice(0, 2).map((p) => [
    `        <a class="theme" href="/blog/${p.slug}/">`,
    `          <h3>${semViuva(esc(p.tituloCompleto))}</h3>`,
    `          <p>${esc(p.resumo)}</p>`,
    `          <span class="tag">ler no blog →</span>`,
    `        </a>`].join(n)).join(n);
  const trecho = /<!-- posts:inicio[^>]*-->[\s\S]*?<!-- posts:fim -->/;
  if (!trecho.test(html)) throw new Error("index.html sem as marcações <!-- posts:inicio --> / <!-- posts:fim -->");
  return html.replace(trecho, (m) => m.slice(0, m.indexOf("-->") + 3) + n + cartoes + n + "<!-- posts:fim -->");
}

function sitemap(posts) {
  const recente = [ULTIMA_MUDANCA_PAGINAS, ...posts.map((p) => p.data)].sort().at(-1);
  const urls = [[`${SITE}/`, recente], [`${SITE}/blog/`, recente], ...posts.map((p) => [p.url, p.data])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, mod]) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${mod}</lastmod>\n  </url>`).join("\n")}
</urlset>
`;
}

function escrever(relativo, conteudo) {
  const destino = path.join(DIST, relativo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
}

const posts = lerPosts();
fs.rmSync(DIST, { recursive: true, force: true });
for (const item of fs.readdirSync(RAIZ)) {
  if (!NAO_COPIAR.has(item)) fs.cpSync(path.join(RAIZ, item), path.join(DIST, item), { recursive: true });
}
const modeloPost = fs.readFileSync(path.join(RAIZ, "templates", "post.html"), "utf8");
for (const p of posts) escrever(`blog/${p.slug}/index.html`, paginaPost(modeloPost, p));
escrever("blog/index.html", paginaBlog(fs.readFileSync(path.join(RAIZ, "templates", "blog.html"), "utf8"), posts));
escrever("index.html", paginaInicial(fs.readFileSync(path.join(RAIZ, "index.html"), "utf8"), posts));
escrever("sitemap.xml", sitemap(posts));
console.log(`Blog gerado: ${posts.length} posts → ${posts.map((p) => p.slug).join(", ")}`);
