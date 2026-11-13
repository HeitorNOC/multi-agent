"""Build the prompts used by the Aurora workflow."""

import json


def plan_prompt(goal: str, catalog: list[dict]) -> str:
    return (
        "Você é Chief of Staff do Grupo Aurora fictício. Pedido: "
        + goal
        + ". Catálogo completo: "
        + json.dumps(catalog, ensure_ascii=False)
        + ". Escolha APENAS as diretorias e especialistas necessários. Agentes não "
        "selecionados não executarão nada. Diretores coordenam seus especialistas reais "
        "em subgrafos; não são somente rótulos. Cada time tem um diretor e um ou dois de "
        "seus próprios especialistas; máximo quatro times e oito agentes totais, com "
        "mínimo suficiente. O limite de oito INCLUI os diretores: some para cada time 1 +"
        " quantidade de especialistas. Quatro times só cabem com EXATAMENTE um "
        "especialista em cada: 4 diretores + 4 especialistas = 8. Três times permitem no "
        "máximo cinco especialistas. Confira essa soma antes de responder; um plano maior"
        " é recusado sem executar agentes. Não convoque RH ou direção executiva por "
        "padrão. Não amplie escopo de um incidente para campanha ou vice-versa. "
        "Justifique todos os agentes deixados de fora com uma frase curta por agente. Return valid JSON only: strategy "
        "(A2 if one team, A3 if multiple teams), selected_agent_count:number (diretores "
        "mais especialistas), reason:string, teams:[{lead:catalog ID,specialists:[catalog"
        " IDs],reason:string}], not_selected:[{id:every unselected catalog "
        "ID,reason:string}], requires_approval:true. Escreva razões em português. Planeje"
        " sem executar ação externa."
    )


def specialist_prompt(goal: str, meta: dict, evidence: list[dict]) -> str:
    return (
        "Você é "
        + meta["title"]
        + ", capacidade "
        + meta["focus"]
        + ". Pedido: "
        + goal
        + ". Fontes vigentes recuperadas pelo LightRAG: "
        + json.dumps(evidence, ensure_ascii=False)
        + ". Retorne JSON: agent, facts:[{claim:string,value:number or boolean or "
        "string,unit:string,sources:[source IDs]}], "
        "calculations:[{expression,result,source_ids}], risks:[string], "
        "unknowns:[string], recommendation:string. Português. Calcule dependências entre "
        "documentos quando necessário; explique fórmula e unidades. Diferencie saldo "
        "físico de livre, oportunidade de compromisso, teto de orçamento de caixa, "
        "política vigente de revogada, suspeita de exfiltração confirmada. Não invente "
        "fonte, prazo, causa ou autorização. Somente assessoramento."
    )


def director_prompt(goal: str, meta: dict, evidence: list[dict], findings: list[dict]) -> str:
    return (
        "Você é "
        + meta["title"]
        + ", responsável por "
        + meta["focus"]
        + ". Pedido: "
        + goal
        + ". Evidência própria vigente: "
        + json.dumps(evidence, ensure_ascii=False)
        + ". Retornos dos seus especialistas: "
        + json.dumps(findings, ensure_ascii=False)
        + ". Retorne JSON: agent, facts:[{claim,value,unit,sources:[source IDs]}], "
        "risks:[string], conditions:[string], recommendation:string, "
        "disagreements:[string]. Consolide e verifique a contribuição dos especialistas. "
        "Português. Não trate projeção como confirmado nem aprove ação. Registre "
        "dependências de outras áreas e ausência de prova. Citações devem ser IDs exatos "
        "fornecidos."
    )


def synthesis_prompt(goal: str, department_reports: list[dict], keys: str) -> str:
    return (
        "Você é Chief of Staff. Pedido: "
        + goal
        + ". Relatórios das diretorias selecionadas: "
        + json.dumps(department_reports, ensure_ascii=False)
        + ". Produza decisão integrada, não uma aprovação. Return JSON: summary:string, "
        "facts:[{key,value:number or boolean,unit:string,label:string,sources:[exact "
        "source IDs]}], risks:[string], conditions:[string], cited_sources:[exact IDs], "
        "action:string, requires_approval:true. Os facts devem incluir as chaves "
        + keys
        + ". Calcule a partir das fontes recebidas; se faltar evidência, declare "
        "desconhecido sem inventar. Margens percentuais com duas casas decimais. Informe "
        "claramente se a proposta original é viável nas condições atuais, o que está "
        "bloqueado e um plano condicionado revisável. Para incidente, prazo é interno "
        "fictício, sem conclusão legal real. Não confundir autorizar checklist no quadro "
        "local com executar campanha, conter incidente ou notificar terceiros. Tudo em "
        "português."
    )
