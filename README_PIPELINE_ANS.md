# Pipeline ANS JSON

Este pacote automatiza a criação dos JSONs agregados da ANS no GitHub.

## Arquivos

- `scripts/update_ans_json.py`: baixa o ZIP público da ANS, processa e gera `data/ans_RS_AAAAMM.json`.
- `.github/workflows/update_ans_json.yml`: roda manualmente ou mensalmente no GitHub Actions.
- `requirements.txt`: dependências Python.

## Uso manual no GitHub

1. Suba estes arquivos no repositório.
2. Vá em Actions.
3. Rode o workflow `Atualizar JSONs ANS`.
4. Para processar uma competência específica, use `months = 202602`.
5. Para processar várias, use `months = 202312 202406 202412`.
6. Se deixar `months` vazio, o workflow tenta processar a competência mais recente disponível.

## Saídas

O workflow cria ou atualiza:

- `data/ans_RS_AAAAMM.json`
- `data/index.json`

O Apps Script lê esses arquivos pelo GitHub raw.
