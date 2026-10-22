// Login do painel /admin por e-mail e senha.
// O painel (Sveltia CMS) abre esta página numa janelinha; com os dados certos, ela entrega ao painel
// a chave do GitHub guardada na Vercel, pelo mesmo protocolo de mensagens do login do GitHub.
// Variáveis na Vercel: ADMIN_EMAIL, ADMIN_SENHA e GITHUB_TOKEN (só com acesso ao conteúdo deste repositório).
import crypto from "node:crypto";

const ORIGEM = "https://www.psiannalu.com";
const ESPERA_ERRO_MS = 1500;
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;
const tentativas = new Map(); // ip -> { erros, desde } (vale por instância da função)

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hash = (t) => crypto.createHash("sha256").update(String(t ?? ""), "utf8").digest();
const iguais = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
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

function pagina(conteudo) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Entrar · Annalu Psi</title>
<style>
  :root { --paper: #F4ECDF; --sheet: #FBF6EE; --ink: #26385F; --text: #3E4659; --earth: #6B4A3A; --line: rgba(38, 56, 95, .16); }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--paper); color: var(--text); font: 17px/1.6 "Segoe UI", system-ui, sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--sheet); border: 1px solid var(--line); border-radius: 18px; padding: 32px 28px; display: grid; gap: 18px; }
  h1 { margin: 0; font: italic 700 34px/1 Georgia, serif; color: var(--ink); }
  p { margin: 0; }
  label { display: grid; gap: 6px; font-weight: 600; color: var(--ink); font-size: 15px; }
  input { font: inherit; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: #fff; color: var(--text); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--earth); outline-offset: 2px; }
  button { font: 600 16px inherit; font-family: inherit; padding: 13px 22px; border-radius: 999px; border: 0; background: var(--ink); color: var(--paper); cursor: pointer; }
  button:hover { background: var(--earth); }
  .erro { color: #9B2C2C; font-size: 15px; }
</style>
</head>
<body><main>${conteudo}</main></body>
</html>`;
}

function formulario(erro = "") {
  return pagina(`<h1>Annalu Psi</h1>
<p>Entre para publicar e editar os textos do blog.</p>
${erro ? `<p class="erro" role="alert">${esc(erro)}</p>` : ""}
<form method="post" action="/api/auth">
  <div style="display:grid;gap:14px">
    <label>E-mail <input type="email" name="email" autocomplete="username" required autofocus></label>
    <label>Senha <input type="password" name="senha" autocomplete="current-password" required></label>
    <button type="submit">Entrar</button>
  </div>
</form>`);
}

// Entrega a chave só para o painel aberto em ORIGEM (o navegador bloqueia qualquer outro site)
function sucesso(token) {
  const mensagem = JSON.stringify("authorization:github:success:" + JSON.stringify({ token, provider: "github" })).replace(/</g, "\\u003c");
  return pagina(`<h1>Annalu Psi</h1>
<p id="aviso">Entrando no painel…</p>
<script>
(function () {
  var ORIGEM = ${JSON.stringify(ORIGEM)};
  if (!window.opener) { document.getElementById("aviso").textContent = "Abra o painel em " + ORIGEM + "/admin para entrar."; return; }
  function receber(e) {
    if (e.origin !== ORIGEM) return;
    window.removeEventListener("message", receber);
    window.opener.postMessage(${mensagem}, ORIGEM);
  }
  window.addEventListener("message", receber);
  window.opener.postMessage("authorizing:github", ORIGEM);
})();
</script>`);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");

  const { ADMIN_EMAIL, ADMIN_SENHA, GITHUB_TOKEN } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_SENHA || !GITHUB_TOKEN) {
    console.error("Login do painel sem configuração: faltam ADMIN_EMAIL, ADMIN_SENHA ou GITHUB_TOKEN na Vercel");
    return res.status(500).send(pagina("<h1>Annalu Psi</h1><p>O login do painel ainda não foi configurado na Vercel.</p>"));
  }

  if (req.method === "GET") return res.status(200).send(formulario());
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).send(formulario()); }

  const ip = String(req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "desconhecido";
  if (bloqueado(ip)) {
    return res.status(429).send(formulario("Muitas tentativas. Espere 15 minutos e tente de novo."));
  }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const senha = String(req.body?.senha ?? "");
  const emailOk = iguais(email, ADMIN_EMAIL.trim().toLowerCase());
  const senhaOk = iguais(senha, ADMIN_SENHA);
  if (!emailOk || !senhaOk) {
    registrarErro(ip);
    await esperar(ESPERA_ERRO_MS);
    return res.status(401).send(formulario("E-mail ou senha incorretos."));
  }

  tentativas.delete(ip);
  return res.status(200).send(sucesso(GITHUB_TOKEN));
}
