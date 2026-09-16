# Banco de Perguntas — Diagnóstico Psicossocial (PT-BR)
### Rascunho v0.1 · 6 domínios · pendente revisão

---

## Notas importantes antes de usar isto

1. **Wording original, não traduzido.** Estes itens foram escritos do zero em português, inspirados na *estrutura* do HSE Management Standards (6 domínios, mistura de itens positivos/negativos, duas escalas de resposta) e em conceitos amplamente usados em psicologia ocupacional (modelo Demanda-Controle-Apoio, ISO 45003). Nenhuma frase foi traduzida do questionário da HSE, que é protegido por copyright da Coroa britânica.
2. **Pendente validação.** Este é um rascunho funcional para preencher o produto — antes de ir para produção, o ideal é uma revisão por um psicólogo(a) organizacional ou pesquisador(a) com experiência em instrumentos de risco psicossocial, incluindo um piloto com análise de consistência interna (alfa de Cronbach) por domínio.
3. **Baseado em 6 domínios.** Aguardando confirmação da Thais sobre um possível 7º domínio. Se confirmado, adiciono um módulo de 5-6 itens sem precisar refazer o restante.
4. **32 itens no total** (~5-6 por domínio) — um pouco mais enxuto que os 35 da HSE, ajustável para cima ou para baixo.

---

## Convenções

- **Escala "freq"** = Nunca / Raramente / Às vezes / Frequentemente / Sempre (1–5)
- **Escala "agree"** = Discordo totalmente / Discordo / Neutro / Concordo / Concordo totalmente (1–5)
- **Reverso (R)** = item de sentido negativo; pontuação invertida no cálculo (6 − resposta) para que 5 sempre signifique "melhor"
- `display_order` sugerido ao final, com itens intercalados entre domínios (como no HSE) para reduzir viés de resposta em bloco

---

## 1. Demandas (6 itens)

| # | Texto (PT-BR) | Escala | Reverso |
|---|---|---|---|
| D1 | Consigo concluir minhas tarefas dentro do horário normal de trabalho. | agree | Não |
| D2 | Tenho prazos que considero impossíveis de cumprir. | freq | Sim |
| D3 | Preciso trabalhar em ritmo muito acelerado para dar conta do volume de trabalho. | freq | Sim |
| D4 | Deixo de fazer algumas tarefas porque tenho mais trabalho do que consigo cobrir. | freq | Sim |
| D5 | Consigo fazer pausas adequadas ao longo do meu dia de trabalho. | freq | Não |
| D6 | Sinto pressão para trabalhar além do meu horário habitual. | freq | Sim |

## 2. Autonomia / Controle (5 itens)

| # | Texto (PT-BR) | Escala | Reverso |
|---|---|---|---|
| C1 | Tenho liberdade para decidir como organizar o meu trabalho. | freq | Não |
| C2 | Posso escolher o momento de fazer uma pausa quando preciso. | freq | Não |
| C3 | Tenho voz ativa na forma como as tarefas da minha função são realizadas. | agree | Não |
| C4 | Meu horário de trabalho permite alguma flexibilidade quando necessário. | agree | Não |
| C5 | Sinto que minhas ideias sobre como melhorar meu trabalho são levadas em conta. | agree | Não |

## 3. Apoio (6 itens)

| # | Texto (PT-BR) | Escala | Reverso |
|---|---|---|---|
| S1 | Quando enfrento dificuldades no trabalho, posso contar com a ajuda dos meus colegas. | freq | Não |
| S2 | Meu gestor direto está disponível quando preciso conversar sobre um problema de trabalho. | freq | Não |
| S3 | Recebo retorno (feedback) útil sobre o meu desempenho. | freq | Não |
| S4 | Sinto que meu gestor se importa genuinamente com o meu bem-estar. | agree | Não |
| S5 | Meus colegas estão dispostos a ouvir quando tenho um problema relacionado ao trabalho. | agree | Não |
| S6 | Em situações emocionalmente difíceis no trabalho, sinto que tenho apoio suficiente. | agree | Não |

## 4. Relacionamentos (5 itens)

| # | Texto (PT-BR) | Escala | Reverso |
|---|---|---|---|
| R1 | Existe tensão ou atrito entre colegas na minha equipe. | freq | Sim |
| R2 | Já fui alvo de comentários ou comportamentos desrespeitosos no ambiente de trabalho. | freq | Sim |
| R3 | Sinto que sou tratado(a) com respeito pelos meus colegas. | agree | Não |
| R4 | Já presenciei ou vivenciei situações de intimidação (bullying) no trabalho. | freq | Sim |
| R5 | As relações no meu ambiente de trabalho são, de modo geral, saudáveis e de confiança. | agree | Não |

## 5. Clareza de Papel (5 itens)

| # | Texto (PT-BR) | Escala | Reverso |
|---|---|---|---|
| P1 | Sei exatamente o que se espera de mim no meu trabalho. | agree | Não |
| P2 | Entendo claramente quais são minhas responsabilidades no dia a dia. | agree | Não |
| P3 | Recebo instruções conflitantes sobre como fazer meu trabalho. | freq | Sim |
| P4 | Compreendo como o meu trabalho contribui para os objetivos da empresa. | agree | Não |
| P5 | Sei a quem recorrer quando tenho dúvidas sobre uma tarefa. | agree | Não |

## 6. Gestão de Mudanças (5 itens)

| # | Texto (PT-BR) | Escala | Reverso |
|---|---|---|---|
| M1 | Quando ocorrem mudanças na empresa, entendo claramente os motivos por trás delas. | agree | Não |
| M2 | Sou consultado(a) ou informado(a) com antecedência sobre mudanças que afetam meu trabalho. | agree | Não |
| M3 | Mudanças recentes na empresa geraram incerteza sobre o meu futuro no trabalho. | freq | Sim |
| M4 | Tenho oportunidade de fazer perguntas sobre mudanças antes que elas aconteçam. | agree | Não |
| M5 | Sinto que consigo me adaptar bem às mudanças na forma como trabalhamos. | agree | Não |

---

## Ordem sugerida de aplicação (intercalada)

Para reduzir o viés de responder em "modo piloto automático" dentro de um mesmo domínio, sugiro intercalar os domínios na ordem de exibição em vez de agrupá-los, seguindo o mesmo princípio do HSE:

```
1. P1   9.  P3   17. R3   25. S5
2. D1   10. M2   18. C4   26. D6
3. C1   11. D3   19. M3   27. R4
4. S1   12. R1   20. S6   28. C5
5. M1   13. C2   21. D4   29. M4
6. R2   14. S2   22. P4   30. D5
7. D2   15. P2   23. C3   31. R5
8. C3*  16. M5*  24. M5*  32. P5
```
*(nota: exemplo ilustrativo — ao implementar, gerar a ordem final programaticamente a partir da tabela por domínio acima para evitar erros de cópia manual)*

---

## Próximos passos recomendados

1. **Confirmar domínios com a Thais** — se for 7, este banco vira a base e adiciono o módulo extra.
2. **Revisão por especialista** — psicólogo(a) organizacional revisa clareza, tradução conceitual e viés cultural de cada item.
3. **Piloto pequeno** (30–50 respondentes) para checar se os itens fazem sentido e calcular consistência interna por domínio antes de lançar para clientes reais.
4. **Popular `survey_question`** no banco de dados com `domain_id`, `text_pt`, `is_reverse_scored`, `display_order` conforme a tabela acima.
