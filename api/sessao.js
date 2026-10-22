// Login do painel por e-mail e senha.
// GET: diz se já está logado · POST { email, senha }: entra · DELETE: sai.
// Variáveis na Vercel: ADMIN_EMAIL, ADMIN_SENHA e GITHUB_TOKEN.
import { configurado, sessaoValida, abrirSessao, fecharSessao, origemOk, iguais, responderJson } from "./_lib/sessao.js";

const ESPERA_ERRO_MS = 1500;
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;
const tentativas = new Map(); // ip -> { erros, desde } (vale por instância da função)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return false;
  if (Date.now() - t.desde > JANELA_MS) { tentativas.delete(ip); return false; }
  return t.erros >= MAX_TENTATIVAS;
}

function registrarErro(ip) {
  const t = tentativas.get(ip);
  const novo = t && Date.now() - t.desde <= JANELA_MS ? { erros: t.erros + 1, desde: t.desde } : { erros: 1, desde: Date.now() };
  tentativas.set(ip, novo);
}

export default async function handler(req, res) {
  if (!configurado()) {
    console.error("Painel sem configuração: faltam ADMIN_EMAIL, ADMIN_SENHA ou GITHUB_TOKEN na Vercel");
    return responderJson(res, 503, { erro: "O login do painel ainda não foi configurado na Vercel." });
  }

  if (req.method === "GET") return responderJson(res, 200, { logado: sessaoValida(req) });
  if (!origemOk(req)) return responderJson(res, 403, { erro: "Pedido recusado." });

  if (req.method === "DELETE") {
    fecharSessao(res);
    return responderJson(res, 200, { ok: true });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return responderJson(res, 405, { erro: "Método não permitido." });
  }

  const ip = String(req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "desconhecido";
  if (bloqueado(ip)) return responderJson(res, 429, { erro: "Muitas tentativas. Espere 15 minutos e tente de novo." });

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const senha = String(req.body?.senha ?? "");
  const emailOk = iguais(email, process.env.ADMIN_EMAIL.trim().toLowerCase());
  const senhaOk = iguais(senha, process.env.ADMIN_SENHA);
  if (!emailOk || !senhaOk) {
    registrarErro(ip);
    await esperar(ESPERA_ERRO_MS);
    return responderJson(res, 401, { erro: "E-mail ou senha incorretos." });
  }

  tentativas.delete(ip);
  abrirSessao(res);
  return responderJson(res, 200, { ok: true });
}
