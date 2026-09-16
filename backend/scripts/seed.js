require("dotenv").config();
const pool = require("../db");

const DOMAINS = [
  { code: "demands", label_pt: "Demandas" },
  { code: "control", label_pt: "Autonomia" },
  { code: "support", label_pt: "Apoio" },
  { code: "relationships", label_pt: "Relacionamentos" },
  { code: "role", label_pt: "Clareza de Papel" },
  { code: "change", label_pt: "Gestão de Mudanças" },
];

// Small real subset (from pt-question-bank.md) — enough to prove the
// scoring/reverse-coding pipeline end to end, not the full 32-item bank.
const QUESTIONS = [
  { domain: "demands", text: "Consigo concluir minhas tarefas dentro do horário normal de trabalho.", scale: "agree", reverse: false, order: 1 },
  { domain: "demands", text: "Tenho prazos que considero impossíveis de cumprir.", scale: "freq", reverse: true, order: 7 },
  { domain: "control", text: "Tenho liberdade para decidir como organizar o meu trabalho.", scale: "freq", reverse: false, order: 2 },
  { domain: "control", text: "Posso escolher o momento de fazer uma pausa quando preciso.", scale: "freq", reverse: false, order: 8 },
  { domain: "support", text: "Quando enfrento dificuldades no trabalho, posso contar com a ajuda dos meus colegas.", scale: "freq", reverse: false, order: 3 },
  { domain: "support", text: "Meu gestor direto está disponível quando preciso conversar sobre um problema de trabalho.", scale: "freq", reverse: false, order: 9 },
  { domain: "relationships", text: "Existe tensão ou atrito entre colegas na minha equipe.", scale: "freq", reverse: true, order: 4 },
  { domain: "relationships", text: "Já fui alvo de comentários ou comportamentos desrespeitosos no ambiente de trabalho.", scale: "freq", reverse: true, order: 10 },
  { domain: "role", text: "Sei exatamente o que se espera de mim no meu trabalho.", scale: "agree", reverse: false, order: 5 },
  { domain: "role", text: "Entendo claramente quais são minhas responsabilidades no dia a dia.", scale: "agree", reverse: false, order: 11 },
  { domain: "change", text: "Quando ocorrem mudanças na empresa, entendo claramente os motivos por trás delas.", scale: "agree", reverse: false, order: 6 },
  { domain: "change", text: "Sou consultado(a) ou informado(a) com antecedência sobre mudanças que afetam meu trabalho.", scale: "agree", reverse: false, order: 12 },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const domainIds = {};
    for (const d of DOMAINS) {
      const result = await client.query(
        `INSERT INTO survey_domain (code, version, label_pt)
         VALUES ($1, 1, $2)
         ON CONFLICT (code, version) DO UPDATE SET label_pt = $2
         RETURNING id`,
        [d.code, d.label_pt]
      );
      domainIds[d.code] = result.rows[0].id;
    }

    for (const q of QUESTIONS) {
      await client.query(
        `INSERT INTO survey_question (domain_id, version, text_pt, scale, is_reverse_scored, display_order)
         VALUES ($1, 1, $2, $3, $4, $5)`,
        [domainIds[q.domain], q.text, q.scale, q.reverse, q.order]
      );
    }

    await client.query("COMMIT");
    console.log(`Seeded ${DOMAINS.length} domains and ${QUESTIONS.length} questions (version 1).`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("seed_error", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
