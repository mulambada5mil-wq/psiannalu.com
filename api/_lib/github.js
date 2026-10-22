// Leitura e gravação dos arquivos do site no GitHub. Cada gravação vira um único envio (commit),
// mesmo com texto e capa juntos, e a Vercel publica o site depois dele.
const API = "https://api.github.com/repos/mulambada5mil-wq/psiannalu.com";
const RAMO = "main";

export class ErroGitHub extends Error {
  constructor(status, detalhe) {
    super(`GitHub respondeu ${status}`);
    this.status = status;
    this.detalhe = detalhe;
  }
}

async function gh(caminho, { method = "GET", corpo } = {}) {
  const resposta = await fetch(API + caminho, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "painel-psiannalu",
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!resposta.ok) throw new ErroGitHub(resposta.status, (await resposta.text()).slice(0, 500));
  return resposta.status === 204 ? null : resposta.json();
}

const caminhoUrl = (caminho) => caminho.split("/").map(encodeURIComponent).join("/");

// Conteúdo de um arquivo de texto, ou null se ele não existe
export async function lerArquivo(caminho) {
  try {
    const arquivo = await gh(`/contents/${caminhoUrl(caminho)}?ref=${RAMO}`);
    return Buffer.from(arquivo.content, "base64").toString("utf8");
  } catch (erro) {
    if (erro instanceof ErroGitHub && erro.status === 404) return null;
    throw erro;
  }
}

export async function listarPasta(caminho) {
  try {
    const itens = await gh(`/contents/${caminhoUrl(caminho)}?ref=${RAMO}`);
    return itens.filter((i) => i.type === "file").map((i) => i.name);
  } catch (erro) {
    if (erro instanceof ErroGitHub && erro.status === 404) return [];
    throw erro;
  }
}

// arquivos: [{ caminho, conteudo }] com conteudo em Buffer/texto, ou null para apagar o arquivo
export async function gravar(mensagem, arquivos) {
  for (let tentativa = 1; ; tentativa++) {
    const ref = await gh(`/git/ref/heads/${RAMO}`);
    const base = ref.object.sha;
    const commitBase = await gh(`/git/commits/${base}`);
    const arvore = await Promise.all(arquivos.map(async ({ caminho, conteudo }) => {
      if (conteudo === null) return { path: caminho, mode: "100644", type: "blob", sha: null };
      const blob = await gh("/git/blobs", { method: "POST", corpo: { content: Buffer.from(conteudo).toString("base64"), encoding: "base64" } });
      return { path: caminho, mode: "100644", type: "blob", sha: blob.sha };
    }));
    const novaArvore = await gh("/git/trees", { method: "POST", corpo: { base_tree: commitBase.tree.sha, tree: arvore } });
    const novo = await gh("/git/commits", { method: "POST", corpo: { message: mensagem, tree: novaArvore.sha, parents: [base] } });
    try {
      await gh(`/git/refs/heads/${RAMO}`, { method: "PATCH", corpo: { sha: novo.sha, force: false } });
      return novo.sha;
    } catch (erro) {
      // Outro envio entrou no meio: tenta de novo uma vez em cima da versão nova
      if (!(erro instanceof ErroGitHub) || erro.status !== 422 || tentativa >= 2) throw erro;
    }
  }
}
