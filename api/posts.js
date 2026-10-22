// Textos do blog para o painel /admin (só com sessão aberta).
// GET: lista · GET ?slug=x: um texto · POST: salva (cria ou edita) · DELETE ?slug=x: apaga.
import matter from "gray-matter";
import { sessaoValida, origemOk, responderJson } from "./_lib/sessao.js";
import { lerArquivo, listarPasta, gravar, ErroGitHub } from "./_lib/github.js";
import { slugificar, dataISO } from "../scripts/post.mjs";

const PASTA = "content/posts";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CAPA_BYTES = 3 * 1024 * 1024;
// campo: [obrigatório, máximo de caracteres, mínimo]
const LIMITES = {
  titulo: [true, 120], titulo_italico: [false, 160], categoria: [true, 40], resumo: [true, 300],
  descricao: [true, 160, 50], capa_alt: [true, 200], fechamento: [false, 400],
};
const ORDEM = ["titulo", "titulo_italico", "data", "categoria", "resumo", "capa", "capa_alt", "imagem_compartilhamento", "descricao", "fechamento", "rascunho"];

class ErroValidacao extends Error {}

const caminhoPost = (slug) => `${PASTA}/${slug}.md`;

async function lerPost(slug) {
  const bruto = await lerArquivo(caminhoPost(slug));
  if (bruto === null) return null;
  const { data: campos, content } = matter(bruto);
  return { slug, campos: { ...campos, data: dataISO(campos.data ?? "") }, corpo: content.replace(/^\n+/, "") };
}

async function listar() {
  const nomes = (await listarPasta(PASTA)).filter((n) => n.endsWith(".md"));
  const posts = await Promise.all(nomes.map((n) => lerPost(n.replace(/\.md$/, ""))));
  return posts.filter(Boolean)
    .map(({ slug, campos }) => ({ slug, titulo: campos.titulo, titulo_italico: campos.titulo_italico ?? "", data: campos.data,
      categoria: campos.categoria, capa: campos.capa, rascunho: Boolean(campos.rascunho) }))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || a.slug.localeCompare(b.slug));
}

// Rascunho pode ficar incompleto (só o título é exigido); para publicar, vale tudo
function validarCampos(entrada) {
  const rascunho = entrada?.rascunho === true;
  const campos = {};
  for (const [nome, [obrigatorio, maximo, minimo = 0]] of Object.entries(LIMITES)) {
    const valor = String(entrada?.[nome] ?? "").trim();
    const exigido = obrigatorio && (!rascunho || nome === "titulo");
    if (exigido && !valor) throw new ErroValidacao(`Preencha o campo "${nome.replace("_", " ")}".`);
    if (valor.length > maximo || (valor && !rascunho && valor.length < minimo)) {
      throw new ErroValidacao(`O campo "${nome.replace("_", " ")}" precisa ter ${minimo ? `entre ${minimo} e ` : "até "}${maximo} caracteres.`);
    }
    if (valor) campos[nome] = valor;
  }
  const data = String(entrada?.data ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data))) throw new ErroValidacao("Data de publicação inválida.");
  campos.data = data;
  campos.rascunho = entrada?.rascunho === true;
  return campos;
}

// Capa nova vem do painel já reduzida, em base64; aceita só WebP, JPEG ou PNG de verdade
function lerCapaNova(base64) {
  const bytes = Buffer.from(String(base64 ?? ""), "base64");
  if (!bytes.length || bytes.length > MAX_CAPA_BYTES) throw new ErroValidacao("A capa precisa ter até 3 MB.");
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { bytes, ext: "webp" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, ext: "jpg" };
  if (bytes.subarray(1, 4).toString("latin1") === "PNG") return { bytes, ext: "png" };
  throw new ErroValidacao("A capa precisa ser uma imagem JPG, PNG ou WebP.");
}

async function slugLivre(base) {
  const existentes = new Set((await listarPasta(PASTA)).map((n) => n.replace(/\.md$/, "")));
  if (!existentes.has(base)) return base;
  for (let i = 2; ; i++) if (!existentes.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function salvar(corpoPedido) {
  const campos = validarCampos(corpoPedido?.campos);
  const corpo = String(corpoPedido?.corpo ?? "");
  if (corpo.length > 100000) throw new ErroValidacao("O texto passou do limite de 100 mil caracteres.");

  let slug = String(corpoPedido?.slug ?? "");
  let anterior = null;
  if (slug) {
    if (!SLUG.test(slug)) throw new ErroValidacao("Endereço do texto inválido.");
    anterior = await lerPost(slug);
    if (!anterior) throw new ErroValidacao("Esse texto não existe mais. Recarregue a lista.");
  } else {
    const base = slugificar(campos.titulo) || "texto";
    slug = await slugLivre(base);
  }

  const arquivos = [];
  if (corpoPedido?.capaNova) {
    const { bytes, ext } = lerCapaNova(corpoPedido.capaNova);
    const caminho = `img/blog/${slug}-capa-${Date.now().toString(36)}.${ext}`;
    arquivos.push({ caminho, conteudo: bytes });
    campos.capa = `/${caminho}`;
  } else if (anterior?.campos.capa) {
    campos.capa = anterior.campos.capa;
  } else if (!campos.rascunho) {
    throw new ErroValidacao("Escolha uma imagem de capa.");
  }
  // Campos que o painel não edita (como a imagem de compartilhamento dos 2 primeiros textos) são mantidos
  if (anterior?.campos.imagem_compartilhamento) campos.imagem_compartilhamento = anterior.campos.imagem_compartilhamento;

  const ordenados = Object.fromEntries(ORDEM.filter((k) => k in campos).map((k) => [k, campos[k]]));
  arquivos.push({ caminho: caminhoPost(slug), conteudo: matter.stringify(`\n${corpo.trim()}\n`, ordenados) });

  const acao = anterior ? "fix: texto do blog atualizado" : "feat: novo texto no blog";
  await gravar(`${acao}, ${slug}${campos.rascunho ? " (rascunho)" : ""}`, arquivos);
  return { slug, novo: !anterior };
}

export default async function handler(req, res) {
  if (!sessaoValida(req)) return responderJson(res, 401, { erro: "Sua sessão terminou. Entre de novo." });
  if (req.method !== "GET" && !origemOk(req)) return responderJson(res, 403, { erro: "Pedido recusado." });

  try {
    const slug = String(req.query?.slug ?? "");
    if (req.method === "GET") {
      if (!slug) return responderJson(res, 200, { posts: await listar() });
      if (!SLUG.test(slug)) return responderJson(res, 400, { erro: "Endereço do texto inválido." });
      const post = await lerPost(slug);
      return post ? responderJson(res, 200, post) : responderJson(res, 404, { erro: "Texto não encontrado." });
    }
    if (req.method === "POST") return responderJson(res, 200, await salvar(req.body));
    if (req.method === "DELETE") {
      if (!SLUG.test(slug) || !(await lerPost(slug))) return responderJson(res, 404, { erro: "Texto não encontrado." });
      await gravar(`chore: texto do blog removido, ${slug}`, [{ caminho: caminhoPost(slug), conteudo: null }]);
      return responderJson(res, 200, { ok: true });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return responderJson(res, 405, { erro: "Método não permitido." });
  } catch (erro) {
    if (erro instanceof ErroValidacao) return responderJson(res, 400, { erro: erro.message });
    console.error("Erro no painel", erro instanceof ErroGitHub ? `${erro.message}: ${erro.detalhe}` : erro);
    const limite = erro instanceof ErroGitHub && (erro.status === 429 || /rate limit/i.test(erro.detalhe ?? ""));
    const semPermissao = !limite && erro instanceof ErroGitHub && (erro.status === 401 || erro.status === 403);
    return responderJson(res, 502, {
      erro: semPermissao
        ? "O GitHub recusou o acesso. Confira se a chave (GITHUB_TOKEN) na Vercel tem permissão Contents: Read and write."
        : "Não foi possível falar com o GitHub agora. Tente de novo em alguns minutos.",
    });
  }
}
