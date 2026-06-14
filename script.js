// ======================== NORMALIZAÇÃO ========================
function normalizarTurma(turma) {
    if (!turma) return "";
    return turma.replace(/º/g, "o").replace(/"/g, "");
}

function normalizarDisciplina(disciplina) {
    if (!disciplina) return "";
    // remove ponto final apenas de GEOG.
    if (disciplina === "GEOG.") return "GEOG";
    return disciplina;
}

function normalizarProfessor(prof) {
    if (!prof) return "";
    const mapeamento = {
        "EMILI CECATO": "EMILI",
        "SILVANA DEFENDI": "SILVANA",
        "CARLOS W.": "CARLOS",
        "CRISTINA BORGES": "CRISTINA",
        "FABIO F.": "FABIO",
        "LAB. KAROL": "KAROLINE",
        "KELI S.": "KELI S.",  // não usado nas aulas, mas mantido
        "JULIA B.": "JULIA B.",
        "JANIR": "JANIR",
        "KELLY": "KELLY",
        "KARINA": "KARINA",
        "MORGANA": "MORGANA",
        "GUSTAVO": "GUSTAVO",
        "VARGAS": "VARGAS",
        "ANDREA": "ANDREA",
        "CINTIA": "CINTIA",
        "CLEUSA": "CLEUSA",
        "LUIZA": "LUIZA",
        "SILVANE S.": "SILVANE S.",
        "GABRIEL": "GABRIEL",
        "LUANA": "LUANA",
        "FABIO": "FABIO",
        "CRISTINA": "CRISTINA"
    };
    let profLimpo = prof.replace(/\s*\(Quizizz\)$/, "").trim();
    return mapeamento[profLimpo] || profLimpo;
}

function extrairTurmaDisciplina(str) {
    // Exemplo de entrada: "9º ""B""/Arte" ou "6º ""A""/L.A.M."
    // Saída: { turma: "9o B", disciplina: "Arte" }
    if (!str || str === "HA" || str === "HAF") return null;
    let partes = str.split("/");
    if (partes.length !== 2) return null;
    let turmaRaw = partes[0].trim();
    let disciplina = partes[1].trim();
    let turma = normalizarTurma(turmaRaw);
    return { turma, disciplina };
}

// ======================== ESTRUTURAS GLOBAIS ========================
let mapaProfessores = {};     // { professor: [ { dia, horario, turma, disciplina } ] }
let aulasObrigatorias = [];   // array de objetos aula
let alocacaoAtual = {};       // chave "dia|horario|recurso" -> padraoEspacos
let aulasAlocadasMap = new Map(); // idAula -> { dia, horario, recurso }

// Função auxiliar para converter horário "01º" em número 1
function horarioParaNumero(horarioStr) {
    let num = parseInt(horarioStr);
    return isNaN(num) ? 99 : num;
}

// ======================== LEITURA DOS CSVs (PapaParse) ========================
function carregarHorarios(file, callback) {
    Papa.parse(file, {
        header: true,
        delimiter: ";",       // o arquivo usa ponto e vírgula
        skipEmptyLines: true,
        complete: (results) => {
            const dados = results.data;
            mapaProfessores = {};
            for (let row of dados) {
                let professor = row["Professor"];
                if (!professor) continue;
                let horario = row["Horário"];
                let horarioNum = horarioParaNumero(horario);
                for (let dia of ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"]) {
                    let celula = row[dia];
                    if (!celula || celula === "HA" || celula === "HAF") continue;
                    let info = extrairTurmaDisciplina(celula);
                    if (!info) continue;
                    if (!mapaProfessores[professor]) mapaProfessores[professor] = [];
                    mapaProfessores[professor].push({
                        dia: dia,
                        horario: horario,
                        horarioNum: horarioNum,
                        turma: info.turma,
                        disciplina: info.disciplina,
                        original: celula
                    });
                }
            }
            callback(true);
        },
        error: (err) => { console.error(err); callback(false); }
    });
}

function carregarAulas(file, callback) {
    Papa.parse(file, {
        header: true,
        delimiter: ",",
        skipEmptyLines: true,
        complete: (results) => {
            aulasObrigatorias = [];
            for (let row of results.data) {
                let turma = normalizarTurma(row["Turma"]);
                let disciplina = normalizarDisciplina(row["Disciplina / Matéria"]);
                let professor = normalizarProfessor(row["Professor"]);
                let prioridadeRaw = (row["prioridade"] || "").trim();
                let prioridade = "";
                let restricaoHorario = null;
                if (prioridadeRaw === "l1") prioridade = "l1";
                else if (prioridadeRaw === "tablets") prioridade = "tablets";
                else if (prioridadeRaw.includes("obrigatorio ser até a 6° aula")) {
                    prioridade = "l2";       // comportamento padrão, mas com restrição
                    restricaoHorario = 6;
                } else prioridade = "l2";     // padrão: laboratório 2
                
                aulasObrigatorias.push({
                    id: `aula_${turma}_${disciplina}_${professor}_${Math.random()}`,
                    turma,
                    disciplina,
                    professor,
                    prioridade,
                    restricaoHorario,
                    padraoEspacos: row["Padrão com Espaços (Padrão do Arquivo)"],
                    alocada: false,
                    detalhesAlocacao: null
                });
            }
            callback(true);
        },
        error: (err) => { console.error(err); callback(false); }
    });
}

// ======================== HEURÍSTICA DE ALOCAÇÃO ========================
function alocarAulas() {
    // Limpa alocações anteriores
    alocacaoAtual = {};
    aulasAlocadasMap.clear();
    
    // Criar estrutura de ocupação: [dia][horario][recurso] = padrao
    let ocupacao = {};
    const dias = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
    for (let dia of dias) {
        ocupacao[dia] = {};
        for (let i = 1; i <= 12; i++) {
            let hor = i.toString().padStart(2, '0') + "º";
            ocupacao[dia][hor] = { L1: null, L2: null, Tablets: null };
        }
    }

    // Ordenar aulas por prioridade (l1 > tablets > l2)
    const ordemPrioridade = { "l1": 0, "tablets": 1, "l2": 2 };
    let aulasOrdenadas = [...aulasObrigatorias];
    aulasOrdenadas.sort((a,b) => ordemPrioridade[a.prioridade] - ordemPrioridade[b.prioridade]);

    for (let aula of aulasOrdenadas) {
        // Buscar todos os horários disponíveis do professor que coincidam turma/disciplina
        let disponibilidades = mapaProfessores[aula.professor] || [];
        let candidatos = disponibilidades.filter(d => 
            d.turma === aula.turma && d.disciplina === aula.disciplina
        );
        // Aplica restrição de horário (ex: até 6ª aula)
        if (aula.restricaoHorario) {
            candidatos = candidatos.filter(c => c.horarioNum <= aula.restricaoHorario);
        }
        // Ordenar candidatos por dia/horário (para manter previsibilidade)
        candidatos.sort((a,b) => {
            const ordemDia = { "Segunda-feira":1, "Terça-feira":2, "Quarta-feira":3, "Quinta-feira":4, "Sexta-feira":5 };
            if (ordemDia[a.dia] !== ordemDia[b.dia]) return ordemDia[a.dia] - ordemDia[b.dia];
            return a.horarioNum - b.horarioNum;
        });

        let alocado = false;
        for (let cand of candidatos) {
            let dia = cand.dia;
            let hor = cand.horario;
            // Tentar alocar conforme prioridade
            let recursos = [];
            if (aula.prioridade === "l1") recursos = ["L1"];
            else if (aula.prioridade === "tablets") recursos = ["Tablets", "L1", "L2"];  // tenta tablets, depois qq lab
            else recursos = ["L2", "L1", "Tablets"];  // padrão prefere L2
            
            for (let recurso of recursos) {
                if (!ocupacao[dia][hor][recurso]) {
                    ocupacao[dia][hor][recurso] = aula.padraoEspacos;
                    alocacaoAtual[`${dia}|${hor}|${recurso}`] = aula.padraoEspacos;
                    aula.alocada = true;
                    aula.detalhesAlocacao = { dia, horario: hor, recurso };
                    aulasAlocadasMap.set(aula.id, aula.detalhesAlocacao);
                    alocado = true;
                    break;
                }
            }
            if (alocado) break;
        }
        if (!alocado) {
            console.warn(`Aula não alocada: ${aula.turma} / ${aula.disciplina} / ${aula.professor}`);
        }
    }
    return { ocupacao, alocacaoAtual };
}

// ======================== RENDERIZAÇÃO DA TABELA LAB ========================
function renderizarTabela(ocupacao) {
    const dias = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
    const tbody = document.querySelector("#tabelaLab tbody");
    tbody.innerHTML = "";
    for (let i = 1; i <= 12; i++) {
        let hor = i.toString().padStart(2, '0') + "º";
        for (let dia of dias) {
            let linha = document.createElement("tr");
            let celDia = document.createElement("td");
            let celHor = document.createElement("td");
            let celL1 = document.createElement("td");
            let celL2 = document.createElement("td");
            let celTablets = document.createElement("td");
            celDia.textContent = dia;
            celHor.textContent = hor;
            celL1.textContent = ocupacao[dia]?.[hor]?.L1 || "";
            celL2.textContent = ocupacao[dia]?.[hor]?.L2 || "";
            celTablets.textContent = ocupacao[dia]?.[hor]?.Tablets || "";
            linha.appendChild(celDia);
            linha.appendChild(celHor);
            linha.appendChild(celL1);
            linha.appendChild(celL2);
            linha.appendChild(celTablets);
            tbody.appendChild(linha);
        }
    }
}

function renderizarListaAulas() {
    const container = document.getElementById("listaAulas");
    container.innerHTML = "";
    for (let aula of aulasObrigatorias) {
        const div = document.createElement("div");
        div.className = "aula-item" + (aula.alocada ? " alocada" : "");
        const info = document.createElement("div");
        info.className = "aula-info";
        info.innerHTML = `<strong>${aula.turma}</strong> - ${aula.disciplina} (${aula.professor})<br>
                          <small>${aula.padraoEspacos}</small>`;
        const priorSpan = document.createElement("span");
        priorSpan.className = "aula-prioridade";
        let priorText = "";
        if (aula.prioridade === "l1") priorText = "L1 obrigatório";
        else if (aula.prioridade === "tablets") priorText = "Tablets preferencial";
        else priorText = "L2 padrão";
        if (aula.restricaoHorario) priorText += " (até 6ª)";
        priorSpan.textContent = priorText;
        priorSpan.classList.add(aula.prioridade === "l1" ? "prioridade-l1" : (aula.prioridade === "tablets" ? "prioridade-tablets" : "prioridade-outro"));
        
        const statusSpan = document.createElement("span");
        statusSpan.style.marginLeft = "10px";
        if (aula.alocada) {
            statusSpan.innerHTML = `✅ ${aula.detalhesAlocacao.dia} ${aula.detalhesAlocacao.horario} (${aula.detalhesAlocacao.recurso})`;
        } else {
            statusSpan.innerHTML = "❌ Não alocada";
            statusSpan.style.color = "red";
        }
        div.appendChild(info);
        div.appendChild(priorSpan);
        div.appendChild(statusSpan);
        container.appendChild(div);
    }
}

// ======================== EXPORTAÇÃO CSV ========================
function exportarCSV() {
    const dias = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
    let linhas = [["Dia","Horário","L1 (Laboratório 1)","L2 (Laboratório 2)","Tablets (Tablets 2)"]];
    for (let i = 1; i <= 12; i++) {
        let hor = i.toString().padStart(2, '0') + "º";
        for (let dia of dias) {
            let L1 = alocacaoAtual[`${dia}|${hor}|L1`] || "";
            let L2 = alocacaoAtual[`${dia}|${hor}|L2`] || "";
            let Tab = alocacaoAtual[`${dia}|${hor}|Tablets`] || "";
            linhas.push([dia, hor, L1, L2, Tab]);
        }
    }
    let csvContent = linhas.map(row => row.join(",")).join("\n");
    let blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    let link = document.createElement("a");
    let url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", "laboratorios_alocados.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ======================== GERENCIAMENTO DE UPLOAD E EXECUÇÃO ========================
let horariosCarregados = false;
let aulasCarregadas = false;

document.getElementById("fileHorarios").addEventListener("change", (e) => {
    if (e.target.files.length) {
        document.getElementById("statusHorarios").innerText = "🔄 Lendo arquivo...";
        carregarHorarios(e.target.files[0], (ok) => {
            if (ok) {
                horariosCarregados = true;
                document.getElementById("statusHorarios").innerHTML = "✅ Horários carregados!";
            } else {
                document.getElementById("statusHorarios").innerHTML = "❌ Erro ao ler horários.";
            }
            atualizarBotoes();
        });
    }
});

document.getElementById("fileAulas").addEventListener("change", (e) => {
    if (e.target.files.length) {
        document.getElementById("statusAulas").innerText = "🔄 Lendo arquivo...";
        carregarAulas(e.target.files[0], (ok) => {
            if (ok) {
                aulasCarregadas = true;
                document.getElementById("statusAulas").innerHTML = `✅ ${aulasObrigatorias.length} aulas carregadas!`;
            } else {
                document.getElementById("statusAulas").innerHTML = "❌ Erro ao ler aulas.";
            }
            atualizarBotoes();
        });
    }
});

function atualizarBotoes() {
    const btnDist = document.getElementById("btnDistribuir");
    const btnExp = document.getElementById("btnExportar");
    btnDist.disabled = !(horariosCarregados && aulasCarregadas);
    btnExp.disabled = !(horariosCarregados && aulasCarregadas);
}

document.getElementById("btnDistribuir").addEventListener("click", () => {
    if (!horariosCarregados || !aulasCarregadas) return;
    const { ocupacao } = alocarAulas();
    renderizarTabela(ocupacao);
    renderizarListaAulas();
});

document.getElementById("btnExportar").addEventListener("click", () => {
    exportarCSV();
});

// Inicializa desabilitado
atualizarBotoes();