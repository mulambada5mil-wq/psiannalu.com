// Painel do blog: login, lista de textos, editor com prévia ao vivo e publicação.
// A prévia usa o mesmo modelo e o mesmo código que geram o site (post.mjs), então mostra a página real.
import { normalizarPost, paginaPost, slugificar, esc } from "/admin/post.mjs";

const $ = (seletor) => document.querySelector(seletor);
const telas = ["carregando", "login", "lista", "editor"];
const CAPA_VAZIA = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="100%" height="100%" fill="#E9DFCF"/>' +
  '<text x="50%" y="50%" fill="#5F6573" font-family="monospace" font-size="22" text-anchor="middle">capa do texto</text></svg>');
const LADO_MAX_CAPA = 1600;

const estado = { slug: null, capaNova: null, capaVer: "", sujo: false, posts: [], modelo: null, rascunho: false };

function mostrar(tela) {
  telas.forEach((t) => { $(`#tela-${t}`).hidden = t !== tela; });
  $("#sair").hidden = tela === "login" || tela === "carregando";
  window.scrollTo(0, 0);
}

let avisoTimer;
function avisar(html, { erro = false, fixo = false } = {}) {
  const aviso = $("#aviso");
  aviso.innerHTML = html;
  aviso.classList.toggle("erro-aviso", erro);
  aviso.hidden = false;
  clearTimeout(avisoTimer);
  if (!fixo) avisoTimer = setTimeout(() => { aviso.hidden = true; }, erro ? 8000 : 5000);
}

class ErroSessao extends Error {}

async function api(caminho, { method = "GET", corpo } = {}) {
  const resposta = await fetch(caminho, {
    method,
    credentials: "same-origin",
    headers: corpo ? { "Content-Type": "application/json" } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 && caminho !== "/api/sessao") throw new ErroSessao(dados.erro);
  if (!resposta.ok) throw new Error(dados.erro || "Algo deu errado. Tente de novo.");
  return dados;
}

async function tratarErro(erro) {
  if (erro instanceof ErroSessao) {
    mostrar("login");
    $("#erro-login").textContent = erro.message || "Sua sessão terminou. Entre de novo.";
    $("#erro-login").hidden = false;
    return;
  }
  avisar(esc(erro.message), { erro: true });
}

/* ---------- Login ---------- */

$("#form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const form = evento.currentTarget;
  const botao = form.querySelector("button");
  const erro = $("#erro-login");
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = "Entrando…";
  try {
    await api("/api/sessao", { method: "POST", corpo: { email: form.email.value, senha: form.senha.value } });
    form.reset();
    await abrirLista();
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});

$("#sair").addEventListener("click", async () => {
  if (estado.sujo && !confirmarSaida()) return;
  await api("/api/sessao", { method: "DELETE" }).catch(() => {});
  estado.sujo = false;
  mostrar("login");
});

/* ---------- Lista ---------- */

const dataBr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

async function abrirLista() {
  mostrar("carregando");
  try {
    const { posts } = await api("/api/posts");
    estado.posts = posts;
    $("#categorias").innerHTML = [...new Set(posts.map((p) => p.categoria).filter(Boolean))]
      .map((c) => `<option value="${esc(c)}">`).join("");
    $("#lista").innerHTML = posts.length ? posts.map((p) => `<li><button class="item" type="button" data-slug="${esc(p.slug)}">
        <img src="${esc(p.capa)}" alt="" loading="lazy">
        <span><strong>${esc(p.titulo)}${p.titulo_italico ? ` <em>${esc(p.titulo_italico)}</em>` : ""}</strong>
        <span class="meta">${esc(p.categoria)} · ${esc(dataBr(p.data))}</span></span>
        <span class="selo${p.rascunho ? "" : " no-ar"}">${p.rascunho ? "rascunho" : "no ar"}</span>
      </button></li>`).join("")
      : '<li class="vazio">Nenhum texto ainda. Clique em "+ Novo texto" para escrever o primeiro.</li>';
    mostrar("lista");
  } catch (e) {
    await tratarErro(e);
  }
}

$("#lista").addEventListener("click", (evento) => {
  const item = evento.target.closest(".item");
  if (item) abrirEditor(item.dataset.slug);
});
$("#novo").addEventListener("click", () => abrirEditor(null));

/* ---------- Editor ---------- */

const form = $("#form-post");
const CAMPOS = ["titulo", "titulo_italico", "categoria", "data", "capa_alt", "corpo", "fechamento", "resumo", "descricao"];

function lerFormulario() {
  return Object.fromEntries(CAMPOS.map((c) => [c, form.elements[c].value]));
}

function mostrarCapa(src) {
  estado.capaVer = src;
  $("#capa-miniatura").innerHTML = src ? `<img src="${esc(src)}" alt="Capa escolhida">` : "<span>sem capa</span>";
}

async function abrirEditor(slug) {
  if (!estado.modelo) {
    mostrar("carregando");
    try {
      const resposta = await fetch("/admin/modelo-post.html");
      if (!resposta.ok) throw new Error("Não foi possível carregar o modelo da prévia.");
      estado.modelo = await resposta.text();
    } catch (e) {
      return tratarErro(e);
    }
  }
  form.reset();
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  Object.assign(estado, { slug, capaNova: null, sujo: false, rascunho: false });
  mostrarCapa("");

  if (slug) {
    mostrar("carregando");
    try {
      const post = await api(`/api/posts?slug=${encodeURIComponent(slug)}`);
      CAMPOS.forEach((c) => { form.elements[c].value = c === "corpo" ? post.corpo : (post.campos[c] ?? ""); });
      mostrarCapa(post.campos.capa ?? "");
      estado.rascunho = Boolean(post.campos.rascunho);
    } catch (e) {
      return tratarErro(e);
    }
  } else {
    form.elements.data.value = hoje();
    form.elements.categoria.value = "reflexões";
  }
  $("#area-apagar").hidden = !slug;
  $("#confirmar-apagar").hidden = true;
  $("#apagar").hidden = false;
  atualizarSituacao();
  atualizarContadores();
  trocarAba("escrever");
  mostrar("editor");
  atualizarPrevia();
}

function atualizarSituacao() {
  const partes = [];
  if (!estado.slug) partes.push("texto novo");
  else partes.push(estado.rascunho ? "rascunho, ainda não está no site" : "publicado no site");
  if (estado.sujo) partes.push("alterações não salvas");
  $("#situacao").textContent = partes.join(" · ");
  $("#publicar").textContent = estado.slug && !estado.rascunho ? "Publicar alterações" : "Publicar";
}

function atualizarContadores() {
  const resumo = form.elements.resumo.value.trim().length;
  const descricao = form.elements.descricao.value.trim().length;
  const cr = $('[data-contador="resumo"]');
  cr.textContent = `${resumo}/300`;
  const cd = $('[data-contador="descricao"]');
  cd.textContent = `${descricao}/160`;
  cd.classList.toggle("fora", descricao > 0 && descricao < 50);
  cd.classList.toggle("dentro", descricao >= 50);
}

form.addEventListener("input", () => {
  estado.sujo = true;
  atualizarSituacao();
  atualizarContadores();
  agendarPrevia();
});

function confirmarSaida() {
  return window.confirm("Você tem alterações não salvas. Sair mesmo assim?");
}
window.addEventListener("beforeunload", (evento) => {
  if (estado.sujo) evento.preventDefault();
});
$("#voltar").addEventListener("click", () => {
  if (estado.sujo && !confirmarSaida()) return;
  estado.sujo = false;
  abrirLista();
});

/* Capa: reduzida e convertida no navegador antes de subir (foto de celular fica leve) */
function paraBlob(canvas, tipo, qualidade) {
  return new Promise((resolver) => canvas.toBlob(resolver, tipo, qualidade));
}
function lerComoDataUrl(blob) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result);
    leitor.onerror = () => rejeitar(new Error("Não foi possível ler a imagem."));
    leitor.readAsDataURL(blob);
  });
}
async function prepararCapa(arquivo) {
  let imagem;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    throw new Error("Não consegui abrir essa imagem. Use uma foto em JPG ou PNG.");
  }
  const escala = Math.min(1, LADO_MAX_CAPA / Math.max(imagem.width, imagem.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(imagem.width * escala);
  canvas.height = Math.round(imagem.height * escala);
  canvas.getContext("2d").drawImage(imagem, 0, 0, canvas.width, canvas.height);
  let blob = await paraBlob(canvas, "image/webp", 0.82);
  if (!blob || blob.type !== "image/webp") blob = await paraBlob(canvas, "image/jpeg", 0.85); // Safari não gera WebP
  if (!blob) throw new Error("Não consegui preparar essa imagem.");
  return lerComoDataUrl(blob);
}

$("#capa-arquivo").addEventListener("change", async (evento) => {
  const arquivo = evento.target.files?.[0];
  evento.target.value = "";
  if (!arquivo) return;
  try {
    const dataUrl = await prepararCapa(arquivo);
    estado.capaNova = dataUrl.split(",")[1];
    mostrarCapa(dataUrl);
    estado.sujo = true;
    atualizarSituacao();
    atualizarPrevia();
  } catch (e) {
    avisar(esc(e.message), { erro: true });
  }
});

/* Barra de formatação: escreve a marcação no texto, em volta da seleção */
const corpo = $("#corpo");
function aplicarFormato(formato) {
  const { selectionStart: ini, selectionEnd: fim, value } = corpo;
  const selecionado = value.slice(ini, fim);
  const inicioLinha = value.lastIndexOf("\n", ini - 1) + 1;
  let novo, cursorIni, cursorFim;
  const prefixarLinhas = (prefixo) => {
    const bloco = value.slice(inicioLinha, fim);
    const linhas = bloco.split("\n").map((l) => (l.startsWith(prefixo) ? l.slice(prefixo.length) : prefixo + l.replace(/^(## |> |- )/, "")));
    novo = value.slice(0, inicioLinha) + linhas.join("\n") + value.slice(fim);
    cursorIni = inicioLinha;
    cursorFim = inicioLinha + linhas.join("\n").length;
  };
  const envolver = (marca, exemplo) => {
    const meio = selecionado || exemplo;
    novo = value.slice(0, ini) + marca + meio + marca + value.slice(fim);
    cursorIni = ini + marca.length;
    cursorFim = cursorIni + meio.length;
  };
  if (formato === "subtitulo") prefixarLinhas("## ");
  else if (formato === "lista") prefixarLinhas("- ");
  else if (formato === "destaque") prefixarLinhas("> ");
  else if (formato === "negrito") envolver("**", "texto em negrito");
  else if (formato === "italico") envolver("*", "texto em itálico");
  else if (formato === "link") {
    const texto = selecionado || "texto do link";
    novo = `${value.slice(0, ini)}[${texto}](https://)${value.slice(fim)}`;
    cursorIni = ini + texto.length + 3;
    cursorFim = cursorIni + "https://".length;
  } else return;
  corpo.value = novo;
  corpo.focus();
  corpo.setSelectionRange(cursorIni, cursorFim);
  corpo.dispatchEvent(new Event("input", { bubbles: true }));
}
$(".ferramentas").addEventListener("click", (evento) => {
  const botao = evento.target.closest("[data-formato]");
  if (botao) aplicarFormato(botao.dataset.formato);
});
corpo.addEventListener("keydown", (evento) => {
  if (!(evento.ctrlKey || evento.metaKey)) return;
  const formato = { b: "negrito", i: "italico" }[evento.key.toLowerCase()];
  if (formato) { evento.preventDefault(); aplicarFormato(formato); }
});

/* Prévia ao vivo */
const previa = $("#previa");
let previaTimer;
function agendarPrevia() {
  clearTimeout(previaTimer);
  previaTimer = setTimeout(atualizarPrevia, 250);
}
function atualizarPrevia() {
  if (!estado.modelo) return;
  const campos = lerFormulario();
  const slug = estado.slug || slugificar(campos.titulo) || "texto-novo";
  const post = normalizarPost({
    ...campos,
    titulo: campos.titulo || "Título do texto",
    categoria: campos.categoria || "categoria",
    capa: estado.capaVer || CAPA_VAZIA,
    capa_alt: campos.capa_alt,
  }, slug, campos.corpo || "*O texto vai aparecer aqui enquanto você escreve.*");
  let html;
  try {
    html = paginaPost(estado.modelo, post);
  } catch (e) {
    console.error("Prévia", e);
    return;
  }
  // Links da prévia abrem em outra aba, para não sair do painel
  html = html.replace("<head>", '<head>\n<base target="_blank">');
  const rolagem = previa.contentWindow?.scrollY ?? 0;
  previa.addEventListener("load", () => previa.contentWindow?.scrollTo(0, rolagem), { once: true });
  previa.srcdoc = html;
}

// Prévia "Computador": encolhe a página de 1280px para caber na moldura
const LARGURA_COMPUTADOR = 1280;
const moldura = $("#moldura");
new ResizeObserver(() => {
  moldura.style.setProperty("--escala", String(Math.min(1, moldura.clientWidth / LARGURA_COMPUTADOR)));
}).observe(moldura);

document.querySelectorAll("[data-tamanho]").forEach((botao) => {
  if (botao.tagName !== "BUTTON") return;
  botao.addEventListener("click", () => {
    $("#moldura").dataset.tamanho = botao.dataset.tamanho;
    document.querySelectorAll(".tamanhos button").forEach((b) => b.setAttribute("aria-pressed", String(b === botao)));
  });
});

function trocarAba(aba) {
  $("#grade").dataset.aba = aba;
  $("#aba-escrever").setAttribute("aria-selected", String(aba === "escrever"));
  $("#aba-previa").setAttribute("aria-selected", String(aba === "previa"));
  if (aba === "previa") atualizarPrevia();
}
$("#aba-escrever").addEventListener("click", () => trocarAba("escrever"));
$("#aba-previa").addEventListener("click", () => trocarAba("previa"));

/* Salvar e publicar */
function validar(publicar) {
  const campos = lerFormulario();
  const faltando = [];
  const marcar = (nome, invalido) => {
    form.elements[nome].setAttribute("aria-invalid", String(invalido));
    if (invalido) faltando.push(nome);
  };
  marcar("titulo", !campos.titulo.trim());
  marcar("categoria", !campos.categoria.trim());
  marcar("data", !campos.data);
  if (publicar) {
    marcar("capa_alt", !campos.capa_alt.trim());
    marcar("resumo", !campos.resumo.trim());
    const d = campos.descricao.trim().length;
    marcar("descricao", d < 50 || d > 160);
  }
  if (publicar && !estado.capaVer) faltando.push("capa");
  if (!faltando.length) return null;
  trocarAba("escrever");
  const primeiro = faltando[0] === "capa" ? $("#capa-arquivo").closest("fieldset") : form.elements[faltando[0]];
  primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
  if (primeiro.focus) primeiro.focus({ preventScroll: true });
  return faltando.includes("capa") ? "Escolha uma imagem de capa." :
    faltando.includes("descricao") && faltando.length === 1 ? "A descrição para o Google precisa ter entre 50 e 160 caracteres." :
    "Preencha os campos marcados em vermelho.";
}

async function salvar(publicar) {
  const problema = validar(publicar);
  if (problema) return avisar(esc(problema), { erro: true });
  const botoes = [$("#publicar"), $("#salvar-rascunho")];
  botoes.forEach((b) => { b.disabled = true; });
  const original = (publicar ? botoes[0] : botoes[1]).textContent;
  (publicar ? botoes[0] : botoes[1]).textContent = "Salvando…";
  try {
    const { corpo: textoCorpo, ...campos } = lerFormulario();
    const resposta = await api("/api/posts", {
      method: "POST",
      corpo: { slug: estado.slug, campos: { ...campos, rascunho: !publicar }, corpo: textoCorpo, capaNova: estado.capaNova },
    });
    Object.assign(estado, { slug: resposta.slug, capaNova: null, sujo: false, rascunho: !publicar });
    $("#area-apagar").hidden = false;
    atualizarSituacao();
    const url = `/blog/${resposta.slug}/`;
    if (publicar) {
      avisar(`Publicado! Em 1 a 2 minutos o texto aparece em <a href="${url}" target="_blank" rel="noopener">psiannalu.com${url}</a>.`, { fixo: true });
      if (resposta.novo) esperarNoAr(url);
    } else {
      avisar("Rascunho salvo. Ele não aparece no site até você clicar em Publicar.");
    }
  } catch (e) {
    await tratarErro(e);
  } finally {
    botoes.forEach((b) => { b.disabled = false; });
    (publicar ? botoes[0] : botoes[1]).textContent = original;
    atualizarSituacao();
  }
}
$("#publicar").addEventListener("click", () => salvar(true));
$("#salvar-rascunho").addEventListener("click", () => salvar(false));

// Confere a cada 15 s se o texto novo já entrou no ar (até 4 minutos)
async function esperarNoAr(url) {
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const resposta = await fetch(url, { method: "HEAD", cache: "no-store" }).catch(() => null);
    if (resposta?.ok) {
      avisar(`Já está no ar: <a href="${url}" target="_blank" rel="noopener">abrir o texto</a>.`, { fixo: true });
      return;
    }
  }
}

/* Apagar */
$("#apagar").addEventListener("click", () => {
  $("#apagar").hidden = true;
  $("#confirmar-apagar").hidden = false;
});
$("#apagar-nao").addEventListener("click", () => {
  $("#apagar").hidden = false;
  $("#confirmar-apagar").hidden = true;
});
$("#apagar-sim").addEventListener("click", async () => {
  try {
    await api(`/api/posts?slug=${encodeURIComponent(estado.slug)}`, { method: "DELETE" });
    estado.sujo = false;
    avisar("Texto apagado. Em 1 a 2 minutos ele sai do site.");
    await abrirLista();
  } catch (e) {
    await tratarErro(e);
  }
});

/* Início */
(async function iniciar() {
  try {
    const resposta = await fetch("/api/sessao", { credentials: "same-origin" });
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 503) {
      mostrar("login");
      $("#erro-login").textContent = dados.erro;
      $("#erro-login").hidden = false;
      return;
    }
    if (dados.logado) await abrirLista();
    else mostrar("login");
  } catch {
    mostrar("login");
    $("#erro-login").textContent = "Sem conexão com o servidor. Confira a internet e recarregue a página.";
    $("#erro-login").hidden = false;
  }
})();
