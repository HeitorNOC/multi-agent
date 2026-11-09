# Fontes primárias

- [Modelos Codex](https://learn.chatgpt.com/docs/models): nome de modelo e uso de `--model`; disponibilidade da conta também confirmada por chamada real.
- [Modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode): JSONL, evento de consumo e saída estruturada. Não inferimos custo monetário a partir de tokens.
- [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers): endpoints de authorization code, token, chaves e introspecção. A aplicação deste laboratório valida JWT e cadastro local; não faz introspecção em cada requisição.
- [RFC 9700](https://www.rfc-editor.org/info/rfc9700/): fundamentos de PKCE e segurança OAuth. O laboratório usa HTTP loopback e não se apresenta como implantação conforme todos os requisitos do RFC.
- [Modelos FastEmbed](https://qdrant.github.io/fastembed/examples/Supported_Models/): opções multilíngues e dimensões.
- [Qdrant MiniLM ONNX quantizado](https://huggingface.co/Qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q): artefato selecionado; card declara Apache-2.0. Revisão/arquivos efetivos nos resultados locais.
- [E5 multilingual](https://huggingface.co/intfloat/multilingual-e5-small): consultado, não utilizado no ensaio.

Evidência de funcionamento vem dos comandos, respostas, asserts e versões locais, não das afirmações comerciais dos projetos. O dossiê e relatórios anteriores permanecem em seus diretórios originais.
