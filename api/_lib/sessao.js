// Sessão do painel /admin: cookie assinado (HttpOnly) que vale 3 dias.
// A assinatura usa a senha e a chave do GitHub: trocar a senha na Vercel derruba todas as sessões.
import crypto from "node:crypto";

export const ORIGEM = "https://www.psiannalu.com";
const NOME = "__Host-sessao_painel";
const DURACAO_S = 3 * 24 * 60 * 60;

export function configurado() {
  const { ADMIN_EMAIL, ADMIN_SENHA, GITHUB_TOKEN } = process.env;
  return Boolean(ADMIN_EMAIL && ADMIN_SENHA && GITHUB_TOKEN);
}

const assinar = (dado) => crypto.createHmac("sha256", `sessao|${process.env.ADMIN_SENHA}|${process.env.GITHUB_TOKEN}`)
  .update(dado).digest("base64url");
const hash = (t) => crypto.createHash("sha256").update(String(t ?? ""), "utf8").digest();
export const iguais = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

function lerCookie(req) {
  const cookies = String(req.headers.cookie ?? "").split(";").map((c) => c.trim().split("="));
  const achado = cookies.find(([k]) => k === NOME);
  return achado ? achado.slice(1).join("=") : "";
}

export function sessaoValida(req) {
  if (!configurado()) return false;
  const [exp, assinatura] = lerCookie(req).split(".");
  if (!exp || !assinatura || !/^\d+$/.test(exp)) return false;
  if (!iguais(assinatura, assinar(exp))) return false;
  return Number(exp) > Date.now() / 1000;
}

export function abrirSessao(res) {
  const exp = String(Math.floor(Date.now() / 1000) + DURACAO_S);
  res.setHeader("Set-Cookie", `${NOME}=${exp}.${assinar(exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURACAO_S}`);
}

export function fecharSessao(res) {
  res.setHeader("Set-Cookie", `${NOME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

// Pedidos que gravam algo só valem vindos do próprio painel (protege contra outro site mandar o pedido)
export const origemOk = (req) => req.headers.origin === ORIGEM;

export function responderJson(res, status, corpo) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).send(JSON.stringify(corpo));
}
