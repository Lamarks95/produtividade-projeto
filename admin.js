const PIN_ADMIN = "1234";

const TIPOS_SERVICOS_4_ITENS = new Set([
  "RETORNO CREDENCIADA",
  "MUDANCA DE PACOTE",
  "TROCA TERMINAL",
  "MODERNIZACAO"
]);

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizarChaveColuna(chave) {
  return normalizarTexto(chave).replace(/[^A-Z0-9]/g, "");
}

function headersSupabase(prefer = "") {
  const h = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
  if (prefer) h["Prefer"] = prefer;
  return h;
}

let consolidadoPorLogin = {};
let mapaNomes = {};

// --- LOGIN DO ADMIN ---
const formPinAdmin = document.getElementById("formPinAdmin");
const inputPin = document.getElementById("inputPin");
const erroPin = document.getElementById("erroPin");
const boxLoginAdmin = document.getElementById("boxLoginAdmin");
const painelAdminConteudo = document.getElementById("painelAdminConteudo");

formPinAdmin.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (inputPin.value === PIN_ADMIN) {
    boxLoginAdmin.classList.add("oculto");
    painelAdminConteudo.classList.remove("oculto");
    erroPin.textContent = "";
    inputPin.value = "";
    await carregarDadosDoSupabase();
    renderizarTabelaAdmin();
  } else {
    erroPin.textContent = "PIN inválido.";
  }
});

// --- LEITURA E AGREGAÇÃO DO .XLSX ---
function lerPlanilhaComColunasDuplicadas(planilha) {
  const matriz = XLSX.utils.sheet_to_json(planilha, { header: 1, defval: "" });
  if (!matriz || matriz.length < 2) return [];

  const cabecalhos = matriz[0];
  let indiceTipoAtividadeFinal = -1;
  cabecalhos.forEach((h, idx) => {
    if (normalizarChaveColuna(h) === "TIPODEATIVIDADE") {
      indiceTipoAtividadeFinal = idx;
    }
  });

  const registros = [];
  for (let i = 1; i < matriz.length; i++) {
    const row = matriz[i];
    const obj = {};
    cabecalhos.forEach((h, idx) => {
      if (h !== "") {
        obj[h] = row[idx];
      }
    });
    if (indiceTipoAtividadeFinal >= 0) {
      obj["Tipo de Atividade"] = row[indiceTipoAtividadeFinal];
    }
    registros.push(obj);
  }
  return registros;
}

function montarLinhasParaSupabase(linhasBrutas) {
  const porDataELogin = {};

  for (const linha of linhasBrutas) {
    const mapaCol = {};
    for (const [colOriginal, valor] of Object.entries(linha)) {
      mapaCol[normalizarChaveColuna(colOriginal)] = valor;
    }

    const login = normalizarTexto(mapaCol.LOGINDOTECNICO || mapaCol.LOGIN);
    if (!login) continue;

    const dataBruta = String(mapaCol.DATA || "").trim();
    const dataRef = dataBruta || "DATA_NAO_INFORMADA";
    const chave = `${dataRef}__${login}`;

    if (!porDataELogin[chave]) {
      porDataELogin[chave] = {
        data_ref: dataRef,
        login,
        inst: 0,
        mud_end: 0,
        servicos: 0
      };
    }

    const tipoAtividade = normalizarTexto(
      mapaCol.TIPODEATIVIDADE || mapaCol.TIPO || ""
    );

    if (tipoAtividade.includes("APOIO A OUTRO TECNICO")) {
      continue;
    }

    const codBaixa = normalizarTexto(
      mapaCol.CODDEBAIXA1 || mapaCol.CODBAIXA1 || mapaCol.CODBAIXA || ""
    );

    if (!codBaixa.startsWith("409")) {
      continue;
    }

    if (tipoAtividade === "INSTALACAO") {
      porDataELogin[chave].inst += 1;
    } else if (tipoAtividade === "MUDANCA DE ENDERECO") {
      porDataELogin[chave].mud_end += 1;
    } else if (TIPOS_SERVICOS_4_ITENS.has(tipoAtividade)) {
      porDataELogin[chave].servicos += 1;
    }
  }

  return Object.values(porDataELogin);
}

function processarArquivoXlsx(arquivo) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("Biblioteca SheetJS não carregada."));
      return;
    }

    const leitor = new FileReader();
    leitor.onload = (evento) => {
      try {
        const bytes = new Uint8Array(evento.target.result);
        const workbook = XLSX.read(bytes, { type: "array" });
        const primeiraAba = workbook.SheetNames[0];
        const planilha = workbook.Sheets[primeiraAba];
        const linhas = lerPlanilhaComColunasDuplicadas(planilha);
        const linhasSupabase = montarLinhasParaSupabase(linhas);
        resolve(linhasSupabase);
      } catch (err) {
        reject(err);
      }
    };
    leitor.onerror = () => reject(new Error("Falha ao ler o arquivo .xlsx."));
    leitor.readAsArrayBuffer(arquivo);
  });
}

// --- OPERAÇÕES COM SUPABASE ---
async function upsertProdutividadeDiaria(linhas) {
  const url = `${SUPABASE_URL}/rest/v1/produtividade_diaria?on_conflict=data_ref,login`;
  const resp = await fetch(url, {
    method: "POST",
    headers: headersSupabase("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(linhas)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Erro ao salvar no Supabase: ${txt || resp.status}`);
  }
}

async function carregarDadosDoSupabase() {
  const [respProd, respNomes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/produtividade_diaria?select=data_ref,login,inst,mud_end,servicos`, {
      headers: headersSupabase()
    }),
    fetch(`${SUPABASE_URL}/rest/v1/tecnicos_nomes?select=login,nome`, {
      headers: headersSupabase()
    })
  ]);

  if (!respProd.ok || !respNomes.ok) {
    throw new Error("Erro ao carregar dados do Supabase.");
  }

  const linhasProd = await respProd.json();
  const linhasNomes = await respNomes.json();

  const nomesMap = {};
  for (const n of linhasNomes) {
    if (n.login) nomesMap[normalizarTexto(n.login)] = n.nome || "";
  }
  mapaNomes = nomesMap;

  const porLogin = {};
  for (const r of linhasProd) {
    const login = normalizarTexto(r.login);
    if (!login) continue;

    if (!porLogin[login]) {
      porLogin[login] = {
        inst: 0,
        mudEnd: 0,
        servicos: 0,
        datas: new Set()
      };
    }

    porLogin[login].inst += Number(r.inst) || 0;
    porLogin[login].mudEnd += Number(r.mud_end) || 0;
    porLogin[login].servicos += Number(r.servicos) || 0;
    if (r.data_ref) {
      porLogin[login].datas.add(String(r.data_ref).trim());
    }
  }

  const consolidado = {};
  for (const [login, d] of Object.entries(porLogin)) {
    consolidado[login] = {
      inst: d.inst,
      mudEnd: d.mudEnd,
      servicos: d.servicos,
      diasTrabalhados: d.datas.size
    };
  }

  consolidadoPorLogin = consolidado;
}

const inputArquivoXlsx = document.getElementById("inputArquivoXlsx");
const feedbackImportacao = document.getElementById("feedbackImportacao");
const erroImportacao = document.getElementById("erroImportacao");

inputArquivoXlsx.addEventListener("change", async (e) => {
  const arquivo = e.target.files[0];
  feedbackImportacao.textContent = "";
  erroImportacao.textContent = "";

  if (!arquivo) return;

  try {
    const linhasParaSalvar = await processarArquivoXlsx(arquivo);
    if (linhasParaSalvar.length === 0) {
      erroImportacao.textContent = "Nenhum login encontrado na planilha.";
      return;
    }

    await upsertProdutividadeDiaria(linhasParaSalvar);
    await carregarDadosDoSupabase();
    renderizarTabelaAdmin();

    const datasUnicas = [...new Set(linhasParaSalvar.map((x) => x.data_ref))];
    feedbackImportacao.textContent = `Enviado ao Supabase! Data(s) processada(s): ${datasUnicas.join(", ")}.`;
  } catch (err) {
    erroImportacao.textContent = err.message || "Erro ao importar arquivo.";
  } finally {
    inputArquivoXlsx.value = "";
  }
});

// --- TABELA ADMIN E SALVAR NOMES ---
const corpoTabelaAdmin = document.getElementById("corpoTabelaAdmin");
const btnSalvarNomes = document.getElementById("btnSalvarNomes");
const feedbackNomes = document.getElementById("feedbackNomes");

function renderizarTabelaAdmin() {
  corpoTabelaAdmin.innerHTML = "";
  const loginsOrdenados = Object.keys(consolidadoPorLogin).sort();

  loginsOrdenados.forEach((login) => {
    const reg = consolidadoPorLogin[login];
    const dias = reg.diasTrabalhados || 0;
    const total = (reg.inst || 0) + (reg.mudEnd || 0) + (reg.servicos || 0);
    const media = dias > 0 ? (total / dias).toFixed(2).replace(".", ",") : "0,00";
    const nomeAtual = mapaNomes[login] || "";

    corpoTabelaAdmin.innerHTML += `
      <tr>
        <td><strong>${login}</strong></td>
        <td>
          <input
            type="text"
            class="input-nome-login"
            data-login="${login}"
            value="${nomeAtual.replace(/"/g, "&quot;")}"
            placeholder="Digite o nome do técnico"
          />
        </td>
        <td>${dias}</td>
        <td>${reg.inst || 0}</td>
        <td>${reg.mudEnd || 0}</td>
        <td>${reg.servicos || 0}</td>
        <td><strong>${total}</strong></td>
        <td>${media}</td>
      </tr>
    `;
  });
}

btnSalvarNomes.addEventListener("click", async () => {
  feedbackNomes.textContent = "";
  const inputs = corpoTabelaAdmin.querySelectorAll(".input-nome-login");
  const registrosNomes = [];

  inputs.forEach((inp) => {
    const login = inp.dataset.login;
    const nomeDigitado = inp.value.trim().toUpperCase();
    mapaNomes[login] = nomeDigitado;
    if (nomeDigitado) {
      registrosNomes.push({ login, nome: nomeDigitado });
    }
  });

  try {
    if (registrosNomes.length > 0) {
      const url = `${SUPABASE_URL}/rest/v1/tecnicos_nomes?on_conflict=login`;
      const resp = await fetch(url, {
        method: "POST",
        headers: headersSupabase("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify(registrosNomes)
      });
      if (!resp.ok) {
        throw new Error("Erro ao salvar nomes no Supabase.");
      }
    }
    feedbackNomes.textContent = "Nomes salvos na nuvem com sucesso!";
  } catch (err) {
    feedbackNomes.textContent = err.message;
  }
});

document.getElementById("btnLimparTudo").addEventListener("click", async () => {
  feedbackImportacao.textContent = "";
  erroImportacao.textContent = "";

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/produtividade_diaria?id=gt.0`, {
      method: "DELETE",
      headers: headersSupabase("return=minimal")
    });
    if (!resp.ok) throw new Error("Erro ao limpar dados no Supabase.");

    consolidadoPorLogin = {};
    renderizarTabelaAdmin();
    feedbackImportacao.textContent = "Dados de produtividade removidos do Supabase.";
  } catch (err) {
    erroImportacao.textContent = err.message;
  }
});