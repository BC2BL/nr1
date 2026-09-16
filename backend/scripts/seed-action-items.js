require("dotenv").config();
const pool = require("../db");

// Real action-item library, replacing the hardcoded mock titles that were
// only ever in the dashboard HTML. Each maps to a domain + the risk band
// that should trigger it (amber and/or red).
const ACTION_ITEMS = [
  {
    domain: "demands", trigger: "red",
    title: "Treinamento: priorização e gestão de carga de trabalho",
    description: "Treinamento para gestores sobre como priorizar tarefas da equipe e renegociar prazos em picos de demanda.",
    delivery: "on_platform_training",
  },
  {
    domain: "demands", trigger: "red",
    title: "Revisar distribuição de tarefas nos picos sazonais",
    description: "Avaliar se a carga de trabalho está distribuída de forma justa durante períodos de pico, e ajustar recursos conforme necessário.",
    delivery: "off_platform",
  },
  {
    domain: "demands", trigger: "amber",
    title: "Revisar prazos e cargas de trabalho com a equipe",
    description: "Sessão com a equipe para identificar tarefas que podem ser redistribuídas ou adiadas.",
    delivery: "off_platform",
  },
  {
    domain: "control", trigger: "amber",
    title: "Treinamento: delegação e autonomia da equipe",
    description: "Treinamento para gestores sobre como dar mais autonomia às equipes na forma como o trabalho é realizado.",
    delivery: "on_platform_training",
  },
  {
    domain: "control", trigger: "red",
    title: "Ampliar autonomia decisória em reuniões de equipe",
    description: "Revisar processos de decisão para incluir mais participação da equipe nas escolhas do dia a dia.",
    delivery: "off_platform",
  },
  {
    domain: "support", trigger: "amber",
    title: "Treinamento: feedback e apoio a equipes",
    description: "Treinamento para gestores sobre como dar feedback construtivo e oferecer apoio consistente.",
    delivery: "on_platform_training",
  },
  {
    domain: "relationships", trigger: "red",
    title: "Treinamento: prevenção de assédio e conflitos no trabalho",
    description: "Treinamento obrigatório sobre políticas de combate ao assédio e resolução de conflitos entre colegas.",
    delivery: "on_platform_training",
  },
  {
    domain: "relationships", trigger: "amber",
    title: "Revisar canal de denúncias e políticas de convivência",
    description: "Confirmar que a equipe conhece o canal de denúncias confidencial e as políticas de conduta.",
    delivery: "off_platform",
  },
  {
    domain: "role", trigger: "amber",
    title: "Treinamento: clareza de papéis e responsabilidades",
    description: "Treinamento para gestores sobre como definir e comunicar responsabilidades claras para a equipe.",
    delivery: "on_platform_training",
  },
  {
    domain: "change", trigger: "red",
    title: "Treinamento: comunicação em períodos de mudança organizacional",
    description: "Treinamento para gestores sobre como comunicar mudanças de forma clara e reduzir incerteza na equipe.",
    delivery: "on_platform_training",
  },
  {
    domain: "change", trigger: "amber",
    title: "Criar canal de perguntas sobre mudanças em andamento",
    description: "Estabelecer um canal onde a equipe pode fazer perguntas sobre mudanças antes que elas aconteçam.",
    delivery: "off_platform",
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const domainRows = await client.query("SELECT id, code FROM survey_domain WHERE version = 1");
    const domainIdByCode = Object.fromEntries(domainRows.rows.map(r => [r.code, r.id]));

    let inserted = 0;
    for (const item of ACTION_ITEMS) {
      const domainId = domainIdByCode[item.domain];
      if (!domainId) {
        console.warn(`Skipping "${item.title}" — domain "${item.domain}" not found. Run scripts/seed.js first.`);
        continue;
      }
      await client.query(
        `INSERT INTO action_item (domain_id, risk_band_trigger, title, description, delivery_type, active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [domainId, item.trigger, item.title, item.description, item.delivery]
      );
      inserted++;
    }

    await client.query("COMMIT");
    console.log(`Seeded ${inserted} action items.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("seed_action_items_error", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
