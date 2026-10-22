// Gera o site em dist/: copia os arquivos estáticos e monta o blog a partir de content/posts/*.md
// (os .md são escritos pelo painel /admin). Roda na Vercel a cada envio ao GitHub: `npm run build`.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { imageSize } from "image-size";
import { SITE, OBRIGATORIOS, esc, semViuva, jsonNoHtml, preencher, normalizarPost, paginaPost } from "./post.mjs";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const DIST = path.join(RAIZ, "dist");
const NAO_COPIAR = new Set([".git", ".gitignore", ".vercel", ".impeccable", "node_modules", "dist", "content", "templates", "scripts", "api",
  "package.json", "package-lock.json", "vercel.json", "COMO-PUBLICAR.txt"]);
const ULTIMA_MUDANCA_PAGINAS = "2026-10-22"; // última alteração manual da página inicial

// Uma imagem com problema não pode travar a publicação do site inteiro: fica sem as medidas e avisa no log
function dimensoes(src) {
  if (!src.startsWith("/") || src.startsWith("//")) return "";
  try {
    const arquivo = path.join(RAIZ, decodeURIComponent(src));
    if (!arquivo.startsWith(RAIZ + path.sep)) throw new Error("fora da pasta do site");
    if (!fs.existsSync(arquivo)) throw new Error("arquivo não encontrado");
    const { width, height } = imageSize(fs.readFileSync(arquivo));
    return `width="${width}" height="${height}"`;
  } catch (erro) {
    console.warn(`Aviso: imagem ${src} sem medidas (${erro.message})`);
    return "";
  }
}

function lerPosts() {
  const pasta = path.join(RAIZ, "content", "posts");
  return fs.readdirSync(pasta).filter((f) => f.endsWith(".md")).map((arquivo) => {
    const { data: campos, content } = matter(fs.readFileSync(path.join(pasta, arquivo), "utf8"));
    if (campos.rascunho) return null; // rascunho pode estar incompleto e não vai para o site
    const faltando = OBRIGATORIOS.filter((c) => !String(campos[c] ?? "").trim());
    if (faltando.length) throw new Error(`Post "${arquivo}" sem: ${faltando.join(", ")}`);
    return normalizarPost(campos, arquivo.replace(/\.md$/, ""), content);
  }).filter(Boolean)
    .sort((a, b) => b.data.localeCompare(a.data) || a.slug.localeCompare(b.slug));
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
for (const p of posts) escrever(`blog/${p.slug}/index.html`, paginaPost(modeloPost, p, dimensoes));
// A prévia do painel monta a página com o mesmo modelo e o mesmo código
escrever("admin/modelo-post.html", modeloPost);
escrever("admin/post.mjs", fs.readFileSync(path.join(RAIZ, "scripts", "post.mjs"), "utf8")
  .replace('from "marked";', 'from "/admin/vendor/marked.esm.js";'));
escrever("admin/vendor/marked.esm.js", fs.readFileSync(path.join(RAIZ, "node_modules", "marked", "lib", "marked.esm.js"), "utf8"));
escrever("blog/index.html", paginaBlog(fs.readFileSync(path.join(RAIZ, "templates", "blog.html"), "utf8"), posts));
escrever("index.html", paginaInicial(fs.readFileSync(path.join(RAIZ, "index.html"), "utf8"), posts));
escrever("sitemap.xml", sitemap(posts));
console.log(`Blog gerado: ${posts.length} posts → ${posts.map((p) => p.slug).join(", ")}`);
