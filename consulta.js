function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function headersSupabase() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

async function buscarNomeTecnico(login) {
  const url = `${SUPABASE_URL}/rest/v1/tecnicos_nomes?login=eq.${encodeURIComponent(login)}&select=nome`;
  const resp = await fetch(url, { headers: headersSupabase() });
  if (!resp.ok) return null;
  const dados = await resp.json();
  return dados.length > 0 && dados[0].nome ? String(dados[0].nome).toUpperCase() : null;
}

async function buscarProdutividadeTecnico(login) {
  const url = `${SUPABASE_URL}/rest/v1/produtividade_diaria?login=eq.${encodeURIComponent(login)}&select=data_ref,inst,mud_end,servicos`;
  const resp = await fetch(url, { headers: headersSupabase() });
  if (!resp.ok) {
    throw new Error("Não foi possível consultar o banco de dados.");
  }

  const linhas = await resp.json();
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return null;
  }

  const datasUnicas = new Set();
  let inst = 0;
  let mudEnd = 0;
  let servicos = 0;

  for (const r of linhas) {
    if (r.data_ref) {
      datasUnicas.add(String(r.data_ref).trim());
    }
    inst += Number(r.inst) || 0;
    mudEnd += Number(r.mud_end) || 0;
    servicos += Number(r.servicos) || 0;
  }

  return {
    login,
    diasTrabalhados: datasUnicas.size,
    inst,
    mudEnd,
    servicos
  };
}

const formBuscaLogin = document.getElementById("formBuscaLogin");
const inputLogin = document.getElementById("inputLogin");
const btnConsultar = document.getElementById("btnConsultar");
const mensagemErro = document.getElementById("mensagemErro");
const resultadoColaborador = document.getElementById("resultadoColaborador");

formBuscaLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const loginDigitado = normalizarTexto(inputLogin.value);
  if (!loginDigitado) return;

  mensagemErro.textContent = "";
  btnConsultar.disabled = true;
  btnConsultar.textContent = "Buscando...";

  try {
    const [registro, nomeCadastrado] = await Promise.all([
      buscarProdutividadeTecnico(loginDigitado),
      buscarNomeTecnico(loginDigitado)
    ]);

    if (!registro) {
      resultadoColaborador.classList.add("oculto");
      mensagemErro.textContent = "Login não encontrado na base carregada. Verifique com a liderança.";
      return;
    }

    renderizarPerfilColaborador(loginDigitado, registro, nomeCadastrado || loginDigitado);
  } catch (err) {
    resultadoColaborador.classList.add("oculto");
    mensagemErro.textContent = err.message || "Erro ao consultar produtividade.";
  } finally {
    btnConsultar.disabled = false;
    btnConsultar.textContent = "Consultar";
  }
});

function renderizarPerfilColaborador(login, reg, nomeExibicao) {
  const inst = reg.inst || 0;
  const mudEnd = reg.mudEnd || 0;
  const servicos = reg.servicos || 0;
  const dias = reg.diasTrabalhados || 0;
  const total = inst + mudEnd + servicos;
  const media = dias > 0 ? total / dias : 0;

  document.getElementById("colabNome").textContent = nomeExibicao;
  document.getElementById("colabLoginBadge").textContent = `Login: ${login}`;
  document.getElementById("colabTotal").textContent = total;
  document.getElementById("colabDias").textContent = dias;
  document.getElementById("colabMedia").textContent = media.toFixed(2).replace(".", ",");

  document.getElementById("colabInst").textContent = inst;
  document.getElementById("colabMudEnd").textContent = mudEnd;
  document.getElementById("colabServicos").textContent = servicos;

  const itens = [
    { label: "Instalação (Cód. 409)", qtd: inst },
    { label: "Mudança de Endereço (Cód. 409)", qtd: mudEnd },
    { label: "Serviços - 4 itens (Cód. 409)", qtd: servicos }
  ];

  const container = document.getElementById("colabBarras");
  container.innerHTML = "";

  itens.forEach((item) => {
    const pct = total > 0 ? ((item.qtd / total) * 100).toFixed(1) : "0.0";
    container.innerHTML += `
      <div class="categoria-item">
        <div class="categoria-topo">
          <span>${item.label}</span>
          <span><strong>${item.qtd}</strong> (${pct}%)</span>
        </div>
        <div class="barra-fundo">
          <div class="barra-preenchida" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  });

  resultadoColaborador.classList.remove("oculto");
}