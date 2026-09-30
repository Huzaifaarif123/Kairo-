// CV tailoring engine.
//
// Builds a job-specific CV from the candidate profile markdown. Everything in
// the output is taken from the profile - the engine only selects, reorders and
// emphasises. Requirements the profile doesn't cover are reported as gaps and
// never written into the CV, unless the candidate confirms they have them
// ("confirmed skills"), in which case they're added to the skills section.
//
// The CV follows the ATS-friendly LaTeX layout in CV_TEMPLATES (the HTML preview
// and PDF mirror it). More layouts can be added there.

import fs from 'node:fs';
import path from 'node:path';

// Terms recognised in job descriptions, by category. The first entry is the display
// name, the rest are aliases matched case-insensitively on word boundaries.
const LEXICON = {
  Languages: [
    ['Python', 'python'], ['TypeScript', 'typescript'], ['JavaScript', 'javascript', 'es6'],
    ['Java', 'java'], ['Go', 'golang'], ['Rust', 'rust'], ['C#', 'c#'], ['C++', 'c++'],
    ['Ruby', 'ruby'], ['PHP', 'php'], ['Kotlin', 'kotlin'], ['Swift', 'swiftui'], ['Scala', 'scala'],
    ['SQL', 'sql'], ['R', 'r programming', 'rstudio'], ['Bash', 'bash', 'shell scripting'],
    ['HTML', 'html', 'html5'], ['CSS', 'css', 'css3']
  ],
  Backend: [
    ['Django', 'django'], ['Django REST Framework', 'django rest framework', 'drf'], ['FastAPI', 'fastapi'],
    ['Flask', 'flask'], ['Node.js', 'node.js', 'nodejs'], ['Express.js', 'express.js', 'expressjs'],
    ['NestJS', 'nestjs'], ['Spring', 'spring boot', 'spring framework', 'spring mvc'], ['.NET', '.net', 'asp.net'], ['Rails', 'ruby on rails', 'rails app', 'rails apps'],
    ['Laravel', 'laravel'], ['Celery', 'celery'], ['REST APIs', 'rest api', 'rest apis', 'restful', 'rest services'],
    ['GraphQL', 'graphql'], ['gRPC', 'grpc'], ['WebSockets', 'websocket', 'websockets'],
    ['Microservices', 'microservices', 'microservice'], ['Distributed systems', 'distributed systems', 'distributed system'],
    ['Event-driven architecture', 'event-driven', 'event driven'], ['System design', 'system design'],
    ['Prisma', 'prisma'], ['Pydantic', 'pydantic']
  ],
  Frontend: [
    ['React', 'react', 'react.js', 'reactjs'], ['Next.js', 'next.js', 'nextjs'], ['Vue', 'vue', 'vue.js', 'vuejs'],
    ['Angular', 'angular'], ['Svelte', 'svelte'], ['Redux', 'redux', 'redux toolkit'], ['Zustand', 'zustand'],
    ['Tailwind CSS', 'tailwind', 'tailwind css'], ['React Native', 'react native'], ['Flutter', 'flutter'],
    ['Accessibility', 'accessibility', 'a11y', 'wcag'], ['Core Web Vitals', 'core web vitals', 'web vitals', 'lighthouse'],
    ['Frontend performance', 'code splitting', 'lazy loading', 'bundle size', 'bundle sizes'],
    ['Figma', 'figma'], ['Design systems', 'design system', 'design systems'], ['Storybook', 'storybook']
  ],
  Data: [
    ['PostgreSQL', 'postgresql', 'postgres'], ['MySQL', 'mysql'], ['MongoDB', 'mongodb', 'mongo'], ['Redis', 'redis'],
    ['Elasticsearch', 'elasticsearch'], ['OpenSearch', 'opensearch'], ['ClickHouse', 'clickhouse'], ['SQLite', 'sqlite'],
    ['DynamoDB', 'dynamodb'], ['Cassandra', 'cassandra'], ['Kafka', 'kafka'], ['RabbitMQ', 'rabbitmq'],
    ['Snowflake', 'snowflake'], ['BigQuery', 'bigquery'], ['Redshift', 'redshift'], ['Databricks', 'databricks'],
    ['Airflow', 'airflow'], ['Spark', 'spark', 'pyspark'], ['dbt', 'dbt'], ['Flink', 'flink'], ['Kinesis', 'kinesis'],
    ['ETL', 'etl', 'elt', 'data pipelines', 'data pipeline'], ['Data modeling', 'data modeling', 'data modelling'],
    ['Pandas', 'pandas'], ['NumPy', 'numpy'], ['Query optimization', 'query optimization', 'indexing', 'schema design']
  ],
  'AI and LLMs': [
    ['LLMs', 'llm', 'llms', 'large language model', 'large language models'], ['Generative AI', 'generative ai', 'genai', 'gen ai'],
    ['AI', 'ai', 'artificial intelligence'], ['OpenAI API', 'openai'], ['Anthropic Claude', 'anthropic', 'claude'],
    ['Google Gemini', 'gemini'], ['Llama', 'llama'], ['Mistral', 'mistral'], ['Amazon Bedrock', 'aws bedrock', 'amazon bedrock'],
    ['Azure OpenAI', 'azure openai'], ['Vertex AI', 'vertex ai'], ['Hugging Face', 'hugging face', 'huggingface'],
    ['Claude Code', 'claude code'], ['Cursor AI', 'cursor'], ['Prompt engineering', 'prompt engineering'],
    ['Embeddings', 'embeddings', 'embedding'], ['Fine-tuning', 'fine-tuning', 'fine tuning', 'finetuning'],
    ['LoRA', 'lora', 'qlora', 'peft'], ['Model evaluation', 'evals', 'llm evaluation', 'model evaluation', 'evaluation frameworks', 'evaluation pipelines'],
    ['Guardrails', 'guardrails'], ['Inference optimization', 'inference optimization', 'inference optimisation', 'model serving'],
    ['vLLM', 'vllm'], ['Ollama', 'ollama']
  ],
  'AI Agents and Orchestration': [
    ['LangChain', 'langchain'], ['LangGraph', 'langgraph'], ['LlamaIndex', 'llamaindex', 'llama index'],
    ['CrewAI', 'crewai'], ['AutoGen', 'autogen'], ['OpenAI Agents SDK', 'agents sdk'], ['DSPy', 'dspy'],
    ['MCP', 'mcp', 'model context protocol'], ['Agentic workflows', 'agentic', 'ai agents', 'ai agent', 'llm agents', 'autonomous agents', 'agent workflows', 'agent frameworks', 'multi-agent', 'multi agent'],
    ['Function calling', 'function calling', 'tool calling', 'tool use']
  ],
  'RAG and Retrieval': [
    ['RAG', 'rag', 'retrieval-augmented', 'retrieval augmented'], ['Vector databases', 'vector database', 'vector databases', 'vector db', 'vector search'],
    ['pgvector', 'pgvector'], ['Pinecone', 'pinecone'], ['Weaviate', 'weaviate'], ['Qdrant', 'qdrant'], ['Milvus', 'milvus'],
    ['FAISS', 'faiss'], ['Chroma', 'chromadb', 'chroma db'], ['Semantic search', 'semantic search', 'hybrid search'],
    ['Reranking', 'reranking', 're-ranking', 'rerankers']
  ],
  'Machine Learning': [
    ['Machine learning', 'machine learning', 'ml'], ['Deep learning', 'deep learning'], ['PyTorch', 'pytorch'],
    ['TensorFlow', 'tensorflow'], ['JAX', 'jax'], ['Keras', 'keras'], ['Scikit-learn', 'scikit-learn', 'sklearn'],
    ['XGBoost', 'xgboost'], ['LightGBM', 'lightgbm'], ['NLP', 'nlp', 'natural language processing'],
    ['Computer vision', 'computer vision', 'opencv'], ['MLOps', 'mlops'], ['MLflow', 'mlflow'], ['Kubeflow', 'kubeflow'],
    ['SageMaker', 'sagemaker'], ['Weights & Biases', 'weights & biases', 'wandb'], ['LangSmith', 'langsmith'],
    ['Langfuse', 'langfuse'], ['Ragas', 'ragas'], ['Arize Phoenix', 'arize phoenix', 'arize'], ['DeepEval', 'deepeval'],
    ['Braintrust', 'braintrust'], ['Feature stores', 'feature store', 'feature stores', 'feast'], ['Ray', 'ray serve', 'ray tune', 'ray train', 'anyscale']
  ],
  'Cloud and DevOps': [
    ['AWS', 'aws', 'amazon web services'], ['GCP', 'gcp', 'google cloud'], ['Azure', 'azure'],
    ['Docker', 'docker', 'containerization', 'containerisation'], ['Kubernetes', 'kubernetes', 'k8s'],
    ['Terraform', 'terraform'], ['Helm', 'helm chart', 'helm charts', 'helmfile'], ['Ansible', 'ansible'],
    ['CI/CD', 'ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
    ['GitHub Actions', 'github actions'], ['GitLab CI', 'gitlab ci', 'gitlab ci/cd', 'gitlab'], ['Jenkins', 'jenkins'],
    ['Linux', 'linux'], ['Nginx', 'nginx'], ['Serverless', 'serverless', 'aws lambda', 'lambda functions'], ['Vercel', 'vercel'],
    ['Infrastructure as code', 'infrastructure as code', 'iac']
  ],
  Observability: [
    ['Observability', 'observability', 'monitoring', 'distributed tracing', 'alerting'], ['Sentry', 'sentry'], ['Datadog', 'datadog'],
    ['Grafana', 'grafana'], ['Prometheus', 'prometheus'], ['OpenTelemetry', 'opentelemetry']
  ],
  Testing: [
    ['Testing', 'unit tests', 'unit testing', 'integration tests', 'automated testing', 'test coverage', 'tdd'],
    ['PyTest', 'pytest'], ['Jest', 'jest'], ['Cypress', 'cypress'], ['Playwright', 'playwright'], ['Vitest', 'vitest']
  ],
  'Ways of Working': [
    ['Mentoring', 'mentoring', 'mentor', 'mentored', 'coaching'], ['Code review', 'code review', 'code reviews', 'pull request reviews'],
    ['Technical leadership', 'technical leadership', 'tech lead', 'lead engineer', 'led the architecture'],
    ['Agile', 'agile', 'scrum'], ['Cross-functional collaboration', 'cross-functional', 'cross functional'],
    ['Security', 'application security', 'secure coding', 'authentication', 'authorization', 'oauth', 'owasp']
  ]
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRegex = (aliases) =>
  new RegExp(`(?<![a-z0-9])(?:${aliases.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})(?![a-z0-9])`, 'gi');

const TERMS = Object.entries(LEXICON).flatMap(([category, list]) =>
  list.map(([name, ...aliases]) => ({ name, category, re: termRegex(aliases) })));

// "REST" in capitals is the API style; lower-case "rest" is an everyday word
TERMS.find(t => t.name === 'REST APIs').re = /(?<![A-Za-z0-9])(?:[Rr][Ee][Ss][Tt][Ff][Uu][Ll]|[Rr][Ee][Ss][Tt][ -]?(?:[Aa][Pp][Ii][Ss]?|[Ss]ervices))(?![A-Za-z0-9])|(?<![A-Za-z0-9])REST(?![A-Za-z0-9])/g;

// "Go" the language is also an everyday word: besides "golang", match a capitalised
// "Go" only where it reads as a language ("in Go and Java", "Go, Python", "Go/Rust")
TERMS.find(t => t.name === 'Go').re = /(?<![A-Za-z0-9])[Gg]o[Ll]ang(?![A-Za-z0-9])|(?<=(?:\b(?:in|with|using|and|or)|[,/(])\s*)Go(?![A-Za-z0-9'’-])|(?<![A-Za-z0-9])Go(?=\s*(?:[,/)]|\s(?:and|or)\s|\s(?:developer|engineer|services|microservices|backend|programming|language)\b))/g;

// ---------- Profile parsing ----------

function section(md, name) {
  const m = md.match(new RegExp(`^## ${escapeRe(name)}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : '';
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// Template comments (<!-- ... -->) are guidance, not profile content
export const stripComments = (md) => String(md || '').replace(/<!--[\s\S]*?-->/g, '');

const NOT_GIVEN = /^(available (up)?on request|upon request|n\/?a|none|-)$/i;

export function parseProfile(rawMd) {
  const md = stripComments(rawMd);
  const field = (label) => {
    const v = (md.match(new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)`)) || [])[1]?.trim() || '';
    return NOT_GIVEN.test(v) ? '' : v;
  };

  const experience = [];
  const expRe = /^### (.+?) - (.+?) \((.+?)\)\s*\n(?!- )(.*)\n((?:- .*\n?)*)/gm;
  let m;
  const expText = section(md, 'Professional Experience');
  while ((m = expRe.exec(expText))) {
    experience.push({
      role: m[1].trim(), company: m[2].trim(), period: m[3].trim(), location: m[4].trim(),
      bullets: m[5].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim())
    });
  }

  // Technical skills: one group per bullet line, labelled by its bold head
  const skills = [];
  let heading = '';
  for (const line of section(md, 'Technical Skills').split('\n')) {
    if (line.startsWith('### ')) { heading = line.slice(4).trim(); continue; }
    if (!line.startsWith('- ')) continue;
    const clean = line.slice(2).replace(/\*\*/g, '').replace(/\s*\((Expert|Advanced|Intermediate|Proficient|Basic)\)/gi, '');
    const colon = clean.indexOf(':');
    if (colon > -1) {
      skills.push({ group: clean.slice(0, colon).trim(), items: splitTopLevel(clean.slice(colon + 1)) });
    } else {
      skills.push({ group: heading, items: splitTopLevel(clean) });
    }
  }

  const tableRows = (text) => text.split('\n')
    .filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .slice(1)
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()));

  const listItems = (text) => text.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());

  return {
    name: field('Name'),
    title: field('Title'),
    email: field('Email'),
    phone: field('Phone'),
    linkedin: field('LinkedIn'),
    github: field('GitHub'),
    location: field('Location'),
    summary: section(md, 'Summary').split('\n').map(l => l.trim()).filter(Boolean).join(' '),
    experience,
    skills,
    education: tableRows(section(md, 'Education')).map(r => ({ degree: r[0] || '', period: r[1] || '', school: r[2] || '' })),
    projects: listItems(section(md, 'Independent Projects')).map(l => {
      const [, name, desc] = l.match(/\*\*(.+?)\*\*:?\s*(.*)/) || [null, l, ''];
      return { name, desc };
    }),
    certifications: listItems(section(md, 'Certifications')).map(l => l.replace(/\*\*/g, '')),
    languages: tableRows((md.match(/### Languages\s*\n([\s\S]*?)\n\n/) || [])[1] || '').map(r => ({ name: r[0], level: r[1] }))
  };
}

// ---------- Job description analysis ----------

function countMatches(re, text) {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

// ----- Reading a posting -----
//
// Postings mix requirements with company intros, benefits and legal text. Each line is
// classified by the heading it sits under:
//   required  - requirements, qualifications, responsibilities, tech stack…
//   optional  - nice to have, preferred, bonus…
//   ignored   - about us, benefits, perks, compensation, equal opportunity…
// Text before the first heading counts as an intro (ignored) when the posting has
// requirement headings; otherwise the whole posting counts.

const HEADING_KINDS = [
  ['optional', /^(nice[- ]to[- ]haves?|preferred( qualifications| skills| experience| requirements)?|bonus( points)?|good[- ]to[- ]haves?|pluses|extra credit|desirable|it would be (great|nice)|would be a plus|additional (skills|qualifications)|ideally)/i],
  ['required', /^(requirements|required|must[- ]haves?|key (qualifications|skills|requirements)|minimum qualifications|basic qualifications|qualifications|what (you('ll)?|we('re)?) (need|bring|look(ing)? for|expect)|what you('ll)? (do|work on|bring)|who you are|about you|you have|you are|you('ll)? (have|need)|your (profile|skills|experience)|skills|experience|responsibilities|key responsibilities|the role|role overview|about the role|in this role|your role|day[- ]to[- ]day|tech(nology|nical)? stack|our stack|tools|technical skills|what we('re)? looking for|job description|position summary)/i],
  ['ignored', /^(about (us|the company|the team|[a-z0-9&.' -]{2,30})|who we are|our (mission|story|values|culture|company|team)|company|benefits|perks|what we offer|why (join|work)|compensation|salary|pay|equal (employment )?opportunity|eeo|diversity|how to apply|application process|interview process|location|working hours|our commitment|disclaimer)/i]
];
const OPTIONAL_LINE = /\b(a plus|is a bonus|nice[- ]to[- ]have|preferred|bonus points|would be (a )?(plus|great|nice)|desirable|ideally|not required)\b/i;
// Single lines of boilerplate even without a heading
const IGNORED_LINE = /\b(equal (employment )?opportunit|we do not discriminate|without regard to|reasonable accommodation|benefits|perks|health insurance|paid time off|pto|salary range|compensation|stock options|equity|401\(?k|parental leave|we are an? |we're an? |our (company|mission|team) (is|was)|founded in)\b/i;

function headingOf(line) {
  // Bullet points are content, never headings ("- Experience with Kafka")
  if (/^\s*([-*•·▪◦–]|\d+[.)])\s+/.test(line)) return null;
  const t = line.trim().replace(/^[#\s]+|[*:\s]+$/g, '').replace(/^\*+/, '').trim();
  if (!t || t.length > 60 || /[.!?,;]$/.test(t)) return null;
  for (const [kind, re] of HEADING_KINDS) {
    const m = t.match(re);
    if (!m) continue;
    // What follows the heading word must be short and not continue a sentence
    // ("Experience with Kafka" is a requirement, "Experience & skills" a heading)
    const rest = t.slice(m[0].length).trim();
    if (rest.split(/\s+/).filter(Boolean).length > 3) continue;
    if (/^(with|in|of|using|building|on|at|for|to|as)\b/i.test(rest)) continue;
    return kind;
  }
  return null;
}

function classifyLines(jd) {
  // Long paragraphs are judged sentence by sentence ("… Terraform is a plus." must not
  // make the rest of the paragraph optional)
  // (never after abbreviations such as "e.g." or "i.e.")
  const lines = jd.split('\n').flatMap(l => (l.length > 140 ? l.split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs|incl|approx|esp|resp)\.)\s+(?=[A-Z(])/i) : [l]));
  const hasRequiredHeading = lines.some(l => headingOf(l.split(':')[0]) === 'required');
  const out = [];
  let kind = hasRequiredHeading ? 'ignored' : 'required';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // "Heading: items" on one line
    const colon = line.indexOf(':');
    const inlineKind = colon > 0 && colon <= 40 ? headingOf(line.slice(0, colon)) : null;
    if (inlineKind) {
      kind = inlineKind;
      const rest = line.slice(colon + 1).trim();
      if (rest) out.push({ text: rest, kind });
      continue;
    }
    const heading = headingOf(line);
    if (heading) { kind = heading; continue; }
    if (kind === 'ignored') continue;
    if (IGNORED_LINE.test(line) && !/\b(experience|years|proficien|knowledge|familiar)/i.test(line)) continue;
    out.push({ text: line, kind: kind === 'optional' || OPTIONAL_LINE.test(line) ? 'optional' : 'required' });
  }
  return out;
}

// Skills that are shown by other skills in the profile: a profile listing GitHub Actions
// has CI/CD experience, one listing PostgreSQL knows SQL, and so on. Evidence is
// matched against the profile with the same word-boundary rules as everything else.
const IMPLIED_BY = {
  'CI/CD': ['github actions', 'gitlab ci', 'jenkins', 'circleci', 'argocd', 'argo cd', 'azure devops', 'bitbucket pipelines', 'buildkite', 'teamcity'],
  'Kubernetes': ['eks', 'gke', 'aks', 'openshift', 'helm chart', 'helm charts'],
  'Docker': ['docker compose', 'ecs', 'fargate', 'kubernetes', 'containerized', 'containerised'],
  'AWS': ['ec2', 's3', 'aws lambda', 'ecs', 'eks', 'rds', 'sagemaker', 'bedrock', 'dynamodb', 'cloudwatch', 'redshift', 'amazon'],
  'GCP': ['bigquery', 'vertex ai', 'gke', 'cloud run', 'google cloud'],
  'Azure': ['azure openai', 'aks', 'azure devops'],
  'Infrastructure as code': ['terraform', 'cloudformation', 'pulumi', 'aws cdk', 'bicep'],
  'Model evaluation': ['langsmith', 'ragas', 'deepeval', 'arize', 'langfuse', 'braintrust', 'promptfoo', 'evals', 'eval harness', 'evaluation harness', 'llm-as-a-judge', 'llm as a judge'],
  'Observability': ['prometheus', 'grafana', 'datadog', 'sentry', 'opentelemetry', 'new relic', 'cloudwatch', 'elk', 'arize phoenix', 'langsmith'],
  'Vector databases': ['pgvector', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'faiss', 'chromadb', 'chroma db', 'opensearch vector'],
  'Semantic search': ['pgvector', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'faiss', 'vector search', 'hybrid search'],
  'Embeddings': ['pgvector', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'faiss', 'vector search'],
  'LLMs': ['openai', 'gpt-4', 'gpt-4o', 'claude', 'anthropic', 'gemini', 'llama', 'mistral', 'bedrock', 'langchain', 'langgraph'],
  'Generative AI': ['openai', 'claude', 'anthropic', 'gemini', 'llama', 'mistral', 'llm', 'llms', 'large language model', 'rag'],
  'Machine learning': ['pytorch', 'tensorflow', 'scikit-learn', 'sklearn', 'xgboost', 'lightgbm', 'keras'],
  'Deep learning': ['pytorch', 'tensorflow', 'keras', 'jax'],
  'Agentic workflows': ['langgraph', 'crewai', 'autogen', 'agents sdk', 'ai agents', 'agentic', 'multi-agent'],
  'Function calling': ['mcp', 'model context protocol', 'tool calling', 'tool use'],
  'Fine-tuning': ['lora', 'qlora', 'peft'],
  'SQL': ['postgresql', 'postgres', 'mysql', 'sqlite', 'snowflake', 'bigquery', 'redshift', 'sql server', 'mssql', 't-sql', 'pl/sql', 'mariadb'],
  'REST APIs': ['fastapi', 'express.js', 'expressjs', 'django rest framework', 'flask', 'nestjs', 'restful', 'openapi'],
  'JavaScript': ['typescript', 'node.js', 'nodejs', 'react', 'next.js'],
  'Testing': ['pytest', 'jest', 'cypress', 'playwright', 'vitest', 'unit tests', 'integration tests'],
  'ETL': ['airflow', 'dbt', 'spark', 'pyspark', 'data pipelines', 'data pipeline', 'elt', 'etl'],
  'Serverless': ['aws lambda', 'cloud functions', 'cloud run', 'vercel'],
  'Microservices': ['microservice', 'service-oriented', 'distributed services'],
  'Distributed systems': ['microservices', 'kafka', 'distributed'],
  'Linux': ['ubuntu', 'debian', 'centos', 'bash', 'shell scripting'],
  'Security': ['oauth', 'authentication', 'authorization', 'rbac', 'sast', 'iam', 'encryption'],
  'Data modeling': ['data modelling', 'schema design', 'dimensional model', 'star schema', 'warehousing design', 'data warehouse design']
};
// Evidence is reported by its proper name ("GitHub Actions", not "github actions")
const displayName = (alias) => TERMS.find(t => countMatches(t.re, alias) > 0 && t.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(alias.toLowerCase().replace(/[^a-z0-9]/g, '')))?.name
  || alias.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Aws|Gcp|Eks|Gke|Aks|Ecs|Rds|Iam|Sql|Etl|Elt|Mcp|Llms?|Rag|Cdk|Sast|Rbac|Elk)\b/g, (w) => w.toUpperCase());
const IMPLIED_RE = Object.fromEntries(Object.entries(IMPLIED_BY).map(([name, list]) => [name, list.map(a => ({ label: displayName(a), re: termRegex([a]) }))]));

// Skill names in profiles that are also everyday words; matching them in a posting
// ("the rest of the team", "spring break") would be wrong
const COMMON_WORDS = new Set(['rest', 'go', 'express', 'spring', 'ray', 'helm', 'chroma', 'swift', 'rust', 'node', 'agents', 'lambda', 'vertex', 'transformers', 'rails', 'flask', 'jest', 'dash', 'tableau', 'excel', 'office', 'teams', 'slack', 'communication', 'leadership', 'problem solving', 'ownership', 'teamwork', 'english']);

// The candidate's own listed skills count as requirements too when a posting names
// them, even if they aren't in the built-in lexicon (e.g. "Ragas", "Supabase").
function profileTerms(profile) {
  const extra = [];
  const seen = new Set();
  for (const g of profile.skills) {
    for (const raw of g.items) {
      const name = raw.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      const key = name.toLowerCase();
      if (!name || name.length > 40 || seen.has(key) || COMMON_WORDS.has(key)) continue;
      // Too short to match reliably, unless it's an acronym such as "ML" or "QA"
      if (name.length < 3 && !/^[A-Z0-9]{2}$/.test(name)) continue;
      if (TERMS.some(t => countMatches(t.re, name) > 0)) continue;
      seen.add(key);
      extra.push({ name, category: g.group, re: termRegex([key]), own: true });
    }
  }
  return extra;
}

// Soft skills and ways of working are shown but never lower the score
const SOFT_CATEGORIES = new Set(['Ways of Working']);

export function analyseJob(description, title, rawProfileText, confirmed = []) {
  const profileText = stripComments(rawProfileText);
  const profile = parseProfile(rawProfileText);
  const confirmedList = (confirmed || []).map(s => String(s).trim()).filter(Boolean).slice(0, 60);
  const confirmedText = confirmedList.join('\n');
  const lines = [{ text: title, kind: 'required' }, ...classifyLines(String(description || ''))];
  const terms = [...TERMS, ...profileTerms(profile)];

  // How the candidate covers a term: in the profile, shown by another skill, or confirmed
  const coverage = new Map();
  const coverOf = (t) => {
    if (coverage.has(t.name)) return coverage.get(t.name);
    let c = null;
    if (countMatches(t.re, profileText) > 0) c = { how: 'profile' };
    else if ((IMPLIED_RE[t.name] || []).some(e => countMatches(e.re, profileText) > 0)) {
      c = { how: 'implied', by: IMPLIED_RE[t.name].find(e => countMatches(e.re, profileText) > 0).label };
    } else if (countMatches(t.re, confirmedText) > 0 || confirmedList.some(x => x.toLowerCase() === t.name.toLowerCase())) c = { how: 'confirmed' };
    coverage.set(t.name, c);
    return c;
  };

  const stats = new Map();
  let position = 0;
  for (const line of lines) {
    const hits = [];
    for (const t of terms) {
      t.re.lastIndex = 0;
      let m;
      while ((m = t.re.exec(line.text))) hits.push({ t, index: m.index, end: m.index + m[0].length });
    }
    // Longer names win where two overlap ("Azure OpenAI" over "Azure")
    hits.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));
    const kept = [];
    for (const h of hits) if (!kept.some(k => h.index < k.end && h.end > k.index && k.t !== h.t)) kept.push(h);

    // "AWS or GCP", "such as Snowflake, BigQuery", "(e.g., AWS, GCP, Azure)", "at least one
    // cloud platform": one covered alternative satisfies the rest
    const hasOr = /\b(or|either|such as|like|e\.?g\.?|for example|for instance|including|at least one|one or more|one of|any of|similar|comparable|equivalent)\b|\band\/or\b/i.test(line.text);
    const anyCovered = kept.some(h => coverOf(h.t));
    // "AWS (S3, Glue, Redshift)": bracketed examples of a covered skill aren't hard requirements
    const brackets = [...line.text.matchAll(/\(([^)]*)\)/g)].map(m => [m.index, m.index + m[0].length]);
    const inBracketOfCovered = (h) => brackets.some(([s, e]) => h.index > s && h.end < e
      && kept.some(k => k.end <= s && s - k.end <= 3 && coverOf(k.t)));

    for (const h of kept) {
      let kind = line.kind;
      let note = '';
      if (kind === 'required' && !coverOf(h.t)) {
        if (hasOr && anyCovered) { kind = 'optional'; note = 'alternative'; }
        else if (inBracketOfCovered(h)) { kind = 'optional'; note = 'example'; }
      }
      const s = stats.get(h.t.name) || { t: h.t, req: 0, opt: 0, firstSeen: position + h.index, note: '' };
      if (kind === 'required') s.req++; else s.opt++;
      if (note && !s.note) s.note = note;
      stats.set(h.t.name, s);
    }
    position += line.text.length + 1;
  }

  const found = [...stats.values()].map(({ t, req, opt, firstSeen, note }) => {
    const c = coverOf(t);
    const soft = SOFT_CATEGORIES.has(t.category);
    t.re.lastIndex = 0;
    return {
      name: t.name,
      category: t.category,
      re: t.re,
      weight: req * 2 + opt,
      required: req > 0 && !soft,
      soft,
      note,
      firstSeen,
      inProfile: c?.how === 'profile',
      implied: c?.how === 'implied' ? c.by : null,
      confirmed: c?.how === 'confirmed'
    };
  });
  found.sort((a, b) => b.weight - a.weight || a.firstSeen - b.firstSeen);
  const covered = (f) => f.inProfile || f.implied || f.confirmed;
  return {
    matched: found.filter(covered),
    missing: found.filter(f => !covered(f))
  };
}

// ---------- Markup ----------

// Wrap every mention of a matched term in `text` using the given renderer.
function markup(text, terms, esc, wrap) {
  const ranges = [];
  for (const t of terms) {
    t.re.lastIndex = 0;
    let m;
    while ((m = t.re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let out = '', pos = 0;
  for (const [s, e] of merged) {
    out += esc(text.slice(pos, s)) + wrap(esc(text.slice(s, e)));
    pos = e;
  }
  return out + esc(text.slice(pos));
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escTex = (s) => String(s)
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%$#_{}])/g, '\\$1')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}')
  .replace(/[–—]/g, '--')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/•/g, '\\textbullet{}');

// ---------- Tailoring ----------

// Turn a bullet's quantified result into a short noun phrase for the summary,
// e.g. "...lowering database latency by 47%" -> "a 47% reduction in database latency".
function metricPhrase(text) {
  const by = text.match(/^(.*?)\s+by\s+(\d+(?:\.\d+)?%)/i);
  if (by) {
    const verbs = [...by[1].matchAll(/\b(reduc|cut|lower|decreas|shorten|improv|increas|boost|accelerat)\w*\s+/gi)];
    const verb = verbs[verbs.length - 1];
    if (verb) {
      const object = by[1].slice(verb.index + verb[0].length).trim();
      if (object && object.split(/\s+/).length <= 6) {
        const kind = /^(improv|increas|boost|accelerat)/i.test(verb[1]) ? 'improvement' : 'reduction';
        return `a ${by[2]} ${kind} in ${object}`;
      }
    }
  }
  // "cutting query costs 30%", "lifting campaign ROI by 28%", "reducing release effort 30%"
  const verbFirst = text.match(/\b(cut|cutting|reduc\w*|lower\w*|decreas\w*|shorten\w*|improv\w*|increas\w*|lift\w*|boost\w*|rais\w*|grow\w*)\s+((?:[\w-]+\s+){0,4}?[\w-]+)\s+(?:by\s+)?(?:roughly\s+|about\s+|around\s+|over\s+)?(\d+(?:\.\d+)?%)/i);
  if (verbFirst && !/^(the|a|an|our|their|its|to|from)$/i.test(verbFirst[2].trim())) {
    const kind = /^(improv|increas|lift|boost|rais|grow)/i.test(verbFirst[1]) ? 'improvement' : 'reduction';
    return `a ${verbFirst[3]} ${kind} in ${verbFirst[2].trim()}`;
  }
  // "took 40% off response latency"
  const off = text.match(/\b(?:took|cut|shaved)\s+(\d+(?:\.\d+)?%)\s+off\s+((?:[\w-]+\s+){0,3}[\w-]+)/i);
  if (off) return `a ${off[1]} reduction in ${off[2].trim()}`;
  const coverage = text.match(/(\d+%)\s+test coverage/i);
  if (coverage) return `${coverage[1]} test coverage`;
  const users = text.match(/(\d{1,3}(?:,\d{3})+\+?)\s+concurrent users/i);
  if (users) return `systems serving ${users[1]} concurrent users`;
  return null;
}

export function yearsOfExperience(experience) {
  const years = experience.flatMap(x => (x.period.match(/\d{4}/g) || []).map(Number));
  const current = experience.some(x => /present|current|since|now/i.test(x.period)) ? new Date().getFullYear() : Math.max(...years);
  return years.length ? current - Math.min(...years) : 0;
}

// The posting's title without gender markers, locations, reference numbers or "remote"
function cleanJobTitle(title) {
  return String(title || '')
    .replace(/\((?:[mwfdx]\s*\/\s*)+[mwfdx*]\)|\((?:all genders?|h\/f|f\/h|m\/f\/\*?)\)/gi, '')
    .replace(/\bREF#?\s*\d+\b/gi, '')
    .replace(/[-–|,(]\s*(100%\s*)?(fully\s*)?remote\b.*$/i, '')
    .replace(/\bremote\b/gi, '')
    .replace(/[\s\-–|,:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ----- Standard skill categories (the ATS Classic template's labels) -----

const CATEGORY_ORDER = [
  'Languages', 'Machine Learning', 'Generative AI and LLMs', 'AI Agents and Orchestration', 'RAG and Retrieval',
  'LLM Training and Fine Tuning', 'Inference and Model Serving', 'MLOps and Evaluation', 'Backend and APIs',
  'Frontend', 'Data Engineering', 'Cloud and Infrastructure', 'Monitoring and Observability', 'Testing',
  'Databases', 'Design', 'Other Tools'
];
const DATABASES = new Set(['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'OpenSearch', 'ClickHouse', 'SQLite', 'DynamoDB', 'Cassandra', 'pgvector']);
const TERM_CATEGORY = {
  'Fine-tuning': 'LLM Training and Fine Tuning', LoRA: 'LLM Training and Fine Tuning',
  'Model evaluation': 'MLOps and Evaluation', Guardrails: 'MLOps and Evaluation', MLOps: 'MLOps and Evaluation', MLflow: 'MLOps and Evaluation',
  Kubeflow: 'MLOps and Evaluation', 'Weights & Biases': 'MLOps and Evaluation', LangSmith: 'MLOps and Evaluation', Langfuse: 'MLOps and Evaluation', Ragas: 'MLOps and Evaluation',
  'Arize Phoenix': 'MLOps and Evaluation', DeepEval: 'MLOps and Evaluation', Braintrust: 'MLOps and Evaluation', 'Feature stores': 'MLOps and Evaluation',
  'Inference optimization': 'Inference and Model Serving', vLLM: 'Inference and Model Serving', Ollama: 'Inference and Model Serving', Ray: 'Inference and Model Serving',
  SageMaker: 'Cloud and Infrastructure', pgvector: 'RAG and Retrieval', Figma: 'Design', 'Design systems': 'Design', Storybook: 'Frontend'
};
const LEXICON_CATEGORY = {
  Languages: 'Languages', Backend: 'Backend and APIs', Frontend: 'Frontend', Data: 'Data Engineering',
  'AI and LLMs': 'Generative AI and LLMs', 'AI Agents and Orchestration': 'AI Agents and Orchestration',
  'RAG and Retrieval': 'RAG and Retrieval', 'Machine Learning': 'Machine Learning', 'Cloud and DevOps': 'Cloud and Infrastructure',
  Observability: 'Monitoring and Observability', Testing: 'Testing'
};

// The standard category for a skill: from the lexicon term it names, otherwise from the
// profile group it was listed under
function categoryOf(name, fromGroup = '') {
  const hits = TERMS.filter(t => countMatches(t.re, name) > 0);
  const t = hits.sort((a, b) => b.name.length - a.name.length)[0];
  if (t) {
    if (t.category === 'Ways of Working') return null; // soft skills stay out of Technical Skills
    if (TERM_CATEGORY[t.name]) return TERM_CATEGORY[t.name];
    if (DATABASES.has(t.name)) return 'Databases';
    return LEXICON_CATEGORY[t.category] || 'Other Tools';
  }
  const g = fromGroup.toLowerCase();
  if (/\b(language|programming)/.test(g)) return 'Languages';
  if (/\b(agent|orchestrat)/.test(g)) return 'AI Agents and Orchestration';
  if (/\b(rag|retriev|vector|search)/.test(g)) return 'RAG and Retrieval';
  if (/\b(ai|llm|genai|generative|nlp)\b/.test(g)) return 'Generative AI and LLMs';
  if (/\b(ml|machine|model|deep learning)/.test(g)) return 'Machine Learning';
  if (/\b(cloud|infra|devops|reliab|platform|deploy)/.test(g)) return 'Cloud and Infrastructure';
  if (/\b(data|etl|pipeline|analytics|warehouse)/.test(g)) return 'Data Engineering';
  if (/\b(database|storage)/.test(g)) return 'Databases';
  if (/\b(front|ui|web)/.test(g)) return 'Frontend';
  if (/\b(back|api|server|application)/.test(g)) return 'Backend and APIs';
  if (/\b(test|qa|quality)/.test(g)) return 'Testing';
  if (/\b(monitor|observ)/.test(g)) return 'Monitoring and Observability';
  if (/\b(design|ux)/.test(g)) return 'Design';
  if (/\b(soft|leadership|communication|language(s)? spoken)/.test(g)) return null;
  return 'Other Tools';
}

// "vector search" -> "Vector search"; brands written in lower case stay as they are
const LOWERCASE_BRANDS = new Set(['pgvector', 'dbt', 'npm', 'pnpm', 'yarn', 'vllm', 'grpc', 'ios', 'macos', 'k8s', 'jq', 'tRPC'.toLowerCase(), 'webpack', 'vite']);
function capitalise(name) {
  const n = String(name || '').trim();
  if (!/^[a-z]/.test(n) || LOWERCASE_BRANDS.has(n.split(/[\s(]/)[0].toLowerCase())) return n;
  return n[0].toUpperCase() + n.slice(1);
}

// ----- Key-skills line under the headline -----
// Short, recognisable labels (as in "Generative AI | LLMs | Python | RAG | AI Agents | AWS"),
// most important to this job first
const TAGLINE_LABEL = {
  'Agentic workflows': 'AI Agents', 'Anthropic Claude': 'Claude', 'OpenAI API': 'OpenAI', 'Google Gemini': 'Gemini',
  'Model evaluation': 'LLM Evaluation', 'Machine learning': 'Machine Learning', 'Deep learning': 'Deep Learning',
  'Vector databases': 'Vector Databases', 'Infrastructure as code': 'Infrastructure as Code', 'REST APIs': 'REST APIs',
  'Function calling': 'Tool Calling', 'Data modeling': 'Data Modeling', 'Distributed systems': 'Distributed Systems',
  'Event-driven architecture': 'Event-Driven Architecture', 'System design': 'System Design', 'Semantic search': 'Semantic Search',
  'Prompt engineering': 'Prompt Engineering', 'Fine-tuning': 'Fine-Tuning', 'Generative AI': 'Generative AI'
};
const REDUNDANT_GENERIC = new Set(['SQL', 'JavaScript', 'ETL', 'Serverless', 'Vector databases', 'Semantic search', 'Embeddings', 'Infrastructure as code', 'REST APIs']);
// Too generic to headline a CV
const NOT_IN_TAGLINE = new Set(['AI', 'Testing', 'Observability', 'Security', 'Linux', 'Embeddings']);

function taglineFor(focus, importance) {
  const ranked = focus.filter(t => !NOT_IN_TAGLINE.has(t.name))
    .sort((a, b) => importance.get(b.name) - importance.get(a.name));
  const picked = [];
  for (const t of ranked) {
    // A generic skill next to the tool that proves it says the same thing twice ("SQL" and
    // "PostgreSQL", "JavaScript" and "TypeScript"): keep only the more important one
    const same = (g, x) => REDUNDANT_GENERIC.has(g.name) && (IMPLIED_BY[g.name] || []).some(a => countMatches(x.re, a) > 0);
    const related = picked.some(p => same(p, t) || same(t, p));
    if (related) continue;
    picked.push(t);
    if (picked.length === 8) break;
  }
  return picked.map(t => TAGLINE_LABEL[t.name] || t.name);
}

// Recent roles keep more detail; older roles are trimmed to what's most relevant.
// Bullets that don't help with the posting are only used to reach the minimum.
const BULLETS_PER_ROLE = [8, 7, 6, 5, 4];
const MIN_BULLETS_PER_ROLE = [5, 4, 3, 3, 2];
// Skills that don't relate to the posting: at most this many per group
const OTHER_SKILLS_PER_GROUP = 2;
const MAX_PROJECTS = 4;

/**
 * @param {{ title?: string, company?: string, description?: string, confirmedSkills?: string[] }} job
 * @param {string} profileMd
 * @param {{ template?: string, styles?: Record<string, object> }} [options]
 */
export function tailorCV({ title = '', company = '', description = '', confirmedSkills = [] }, profileMd, { template = DEFAULT_TEMPLATE, styles = {} } = {}) {
  const profile = parseProfile(profileMd);
  const confirmed = (confirmedSkills || []).map(s => String(s).trim()).filter(Boolean).slice(0, 60);
  const { matched, missing } = analyseJob(description, title, profileMd, confirmed);
  const terms = matched;
  const changes = [];

  // How central each requirement is to this job: named in the title, required rather
  // than optional, mentioned early and often. Bullets and skills are ranked by it.
  const importance = new Map(matched.map((t, rank) => {
    const inTitle = countMatches(t.re, String(title)) > 0;
    return [t.name, (t.soft ? 0.5 : t.required ? 3 : 1) + t.weight + (inTitle ? 6 : 0) + Math.max(0, 8 - rank)];
  }));

  // Text supports the posting when it names a matched skill, or a skill that proves one
  // (Pinecone supports "vector databases", GitHub Actions supports "CI/CD")
  const evidence = terms.flatMap(t => (IMPLIED_RE[t.name] || []).map(e => ({ ...e, w: importance.get(t.name) / 2 })));
  const relevance = (text) => terms.reduce((s, t) => s + (countMatches(t.re, text) > 0 ? importance.get(t.name) : 0), 0)
    + evidence.reduce((s, e) => s + (countMatches(e.re, text) > 0 ? e.w : 0), 0);

  // Experience: rank bullets by how many job requirements they evidence
  let dropped = 0, reordered = 0;
  const experience = profile.experience.map((job, i) => {
    const scored = job.bullets.map((text, idx) => ({ text, idx, score: relevance(text) }));
    const ranked = [...scored].sort((a, b) => b.score - a.score || a.idx - b.idx);
    const limit = BULLETS_PER_ROLE[i] ?? 2;
    const min = Math.min(MIN_BULLETS_PER_ROLE[i] ?? 2, limit);
    const relevant = ranked.filter(b => b.score > 0);
    const kept = (relevant.length >= min ? relevant : ranked).slice(0, Math.max(min, Math.min(limit, relevant.length)));
    dropped += job.bullets.length - kept.length;
    if (kept.some((b, n) => b.idx !== n)) reordered++;
    return { ...job, bullets: kept };
  });
  if (reordered) changes.push(`Reordered bullets in ${reordered} role${reordered > 1 ? 's' : ''} so the most relevant achievements come first`);
  if (dropped) changes.push(`Trimmed ${dropped} less relevant bullet${dropped > 1 ? 's' : ''} to keep the CV focused`);

  // Skills: matched items first inside each group, most relevant groups first
  const isMatch = (item) => terms.some(t => countMatches(t.re, item) > 0);
  let skills = profile.skills.filter(g => g.items.length).map(g => ({ group: g.group, items: g.items.map(name => ({ name, matched: isMatch(name) })) }));

  // Skills the posting asks for that the profile proves under another name (CI/CD shown
  // by GitHub Actions) or that the candidate confirmed are named in the skills section,
  // in the group that already holds that kind of skill
  const addToSkills = (t) => {
    if (skills.some(g => g.items.some(i => i.name.toLowerCase() === t.name.toLowerCase()))) return false;
    const home = skills.find(g => g.items.some(i => TERMS.some(x => x.category === t.category && countMatches(x.re, i.name) > 0)))
      || skills.find(g => g.group.toLowerCase() === String(t.category).toLowerCase());
    if (home) home.items.unshift({ name: t.name, matched: true });
    else skills.push({ group: t.category || 'Additional Skills', items: [{ name: t.name, matched: true }] });
    return true;
  };
  const shown = matched.filter(m => m.implied && !m.soft && addToSkills(m));
  if (shown.length) changes.push(`Named ${joinList(shown.map(m => `${m.name} (shown by ${m.implied})`))} in your skills, as the posting words it`);
  const added = matched.filter(m => m.confirmed && addToSkills(m)).map(m => m.name);
  if (added.length) changes.push(`Added ${added.length} skill${added.length > 1 ? 's' : ''} you confirmed: ${joinList(added)}`);

  // Every requirement you cover should appear in the posting's own words somewhere in the
  // CV (ATS systems match keywords literally): "vector databases", not only "vector search"
  const cvWords = () => [...skills.flatMap(g => g.items.map(i => i.name)), ...experience.flatMap(x => x.bullets.map(b => b.text))].join('\n');
  const worded = matched.filter(m => m.required && !m.soft && !m.implied && !m.confirmed
    && countMatches(m.re, cvWords()) === 0 && addToSkills(m)).map(m => m.name);
  if (worded.length) changes.push(`Used the posting's wording in your skills: ${joinList(worded)}`);

  // Sort every skill into the template's standard categories (Languages, Generative AI
  // and LLMs, …, Databases). Inside each category, what matches or supports the posting
  // comes first, plus a couple of others; categories with nothing relevant are left out.
  const before = skills.reduce((n, g) => n + g.items.length, 0);
  const byCategory = new Map();
  let order = 0;
  for (const g of skills) {
    for (const i of g.items) {
      const cat = categoryOf(i.name, g.group);
      if (!cat) continue;
      const key = i.name.toLowerCase();
      const list = byCategory.get(cat) || [];
      if (!list.some(x => x.name.toLowerCase() === key)) list.push({ ...i, idx: order++ });
      byCategory.set(cat, list);
    }
  }
  skills = [...byCategory.entries()].map(([group, list]) => {
    const rated = list.map(i => ({ ...i, rel: i.matched ? 2 : relevance(i.name) > 0 ? 1 : 0 }));
    const relevant = rated.filter(i => i.rel > 0).sort((a, b) => b.rel - a.rel || a.idx - b.idx);
    const others = rated.filter(i => i.rel === 0).slice(0, OTHER_SKILLS_PER_GROUP);
    const items = [...relevant, ...others].map(({ name, matched }) => ({ name: capitalise(name), matched }));
    return { group, items, score: relevant.reduce((n, i) => n + i.rel, 0) };
  }).filter((g, _, all) => g.score > 0 || g.group === 'Languages' || all.filter(x => x.score > 0).length < 3)
    // The template's fixed order: Languages first … Databases near the end
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.group) - CATEGORY_ORDER.indexOf(b.group));
  const matchedSkillCount = skills.reduce((n, g) => n + g.items.filter(i => i.matched).length, 0);
  const after = skills.reduce((n, g) => n + g.items.length, 0);
  if (matchedSkillCount) changes.push(`Moved ${matchedSkillCount} matching skill${matchedSkillCount > 1 ? 's' : ''} to the front of your skills section`);
  if (after < before) changes.push(`Left out ${before - after} skills that don't relate to this job`);

  // Headline and key-skills line
  const recent = profile.experience[0];
  const headline = cleanJobTitle(title) || profile.title || (recent ? recent.role : '');
  // Required skills lead; soft skills and very generic terms stay out of the headline areas
  const focus = terms.filter(t => !t.soft && !['AI', 'Testing', 'Observability', 'Security'].includes(t.name))
    .sort((a, b) => Number(b.required) - Number(a.required));
  const tagline = taglineFor(focus, importance);
  if (headline && headline !== (recent && recent.role)) changes.push(`Set the headline to the role you're applying for: ${headline}`);

  // Summary built only from profile facts
  const years = yearsOfExperience(profile.experience);
  const metrics = [];
  // Results from the bullets most relevant to this job
  for (const b of experience.flatMap(x => x.bullets).sort((x, y) => y.score - x.score)) {
    const phrase = b.score > 0 ? metricPhrase(b.text) : null;
    if (phrase) metrics.push(phrase);
    if (metrics.length === 2) break;
  }
  // What kind of work to name, from the role itself
  const shortTitle = (headline || 'Engineer').split(/\s+[-–|:(]\s*|,\s/)[0].trim() || 'Engineer';
  const domain = /\b(data|analytics|etl|warehouse)\b/i.test(shortTitle) ? 'data platforms and pipelines'
    : /\b(ai|ml|machine learning|llm|genai|nlp|applied scientist)\b/i.test(shortTitle) ? 'software and AI systems'
    : /\b(devops|sre|site reliability|platform|cloud|infrastructure)\b/i.test(shortTitle) ? 'cloud infrastructure and platforms'
    : /\b(designer|ux|ui|product design)\b/i.test(shortTitle) ? 'digital products'
    : /\b(front[- ]?end|full[- ]?stack|web)\b/i.test(shortTitle) ? 'web applications'
    : /\b(mobile|ios|android)\b/i.test(shortTitle) ? 'mobile applications'
    : 'software systems';
  // "Agentic workflows" reads as "agentic workflows" mid-sentence; names like Python stay
  const inSentence = (n) => (/^[A-Z][a-z]+(\s[a-z][a-z/-]*)+$/.test(n) ? n[0].toLowerCase() + n.slice(1) : n);
  // The template's four-part summary:
  //   1. title, years and the kind of systems built
  //   2. "Strong expertise in …" (the posting's key skills the candidate has)
  //   3. "Experienced across the full … lifecycle, including …" (only stages the profile shows)
  //   4. proven results from the profile
  const expertise = focus.slice(0, 9).map(t => inSentence(t.name));
  // A stage is named only when the profile shows it AND the posting asks for it
  const allText = [workText(profile), ...confirmed].join('\n');
  const jobText = `${title}\n${description}`;
  const both = (re) => re.test(allText) && re.test(jobText);
  const aiWork = domain === 'software and AI systems';
  const stages = [
    both(/\b(architect\w*|system design|design(ing)? (and|&) build)/i) && 'system design and architecture',
    both(/\b(data pipelines?|etl|elt|ingestion|data preparation|airflow|spark|dbt|data model\w*)\b/i) && 'data pipelines',
    both(/\b(rag|retrieval|vector|embeddings?|semantic search)\b/i) && 'retrieval design',
    both(/\b(agents?|agentic|langgraph|tool calling|mcp)\b/i) && 'agent development',
    both(/\b(apis?|backend|services|microservices)\b/i) && 'API and backend development',
    both(/\b(front[- ]?end|react|next\.js|ui)\b/i) && 'frontend development',
    aiWork ? both(/\b(evals?|evaluation|langsmith|ragas|quality)\b/i) && 'evaluation'
      : both(/\b(test\w*|qa|quality)\b/i) && 'testing',
    both(/\b(deploy\w*|docker|kubernetes|ci\/cd|release|production)\b/i) && 'deployment',
    both(/\b(monitor\w*|observability|alerting|reliability|on-call)\b/i) && 'monitoring',
    both(/\b(optimi[sz]\w*|performance|latency|scal\w*|cost)\b/i) && 'optimisation'
  ].filter(Boolean);
  const lifecycle = domain === 'software and AI systems' ? 'full AI product lifecycle'
    : domain === 'data platforms and pipelines' ? 'full data lifecycle'
    : 'full delivery lifecycle';
  const sentences = [];
  sentences.push(`${shortTitle} with ${years ? `${years}+ years of ` : ''}experience building and deploying production ${domain}.`);
  if (expertise.length) sentences.push(`Strong expertise in ${joinList(expertise)}.`);
  if (stages.length >= 3) sentences.push(`Experienced across the ${lifecycle}, including ${joinList(stages.slice(0, 6))}.`);
  // One sentence from the profile's own summary that speaks to this posting (not written
  // in the first person, not restating years, not too long)
  const own = profile.summary.split(/(?<=[.!?])\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean)
    // mostly about this job: at least half the technologies it names are ones the posting wants
    .map(x => ({ x, score: relevance(x), named: TERMS.filter(t => countMatches(t.re, x) > 0), wanted: terms.filter(t => countMatches(t.re, x) > 0) }))
    .filter(o => o.score > 0 && o.wanted.length * 2 >= o.named.length && words(o.x) <= 45 && !/\b(i|i'm|i am|my|me)\b/i.test(o.x) && !/\d+\+?\s*years/i.test(o.x))
    .sort((a, b) => b.score - a.score)[0];
  if (metrics.length) sentences.push(`Proven impact includes ${joinList(metrics)}.`);
  else if (own) sentences.push(own.x);
  const summary = sentences.join(' ');
  changes.unshift(focus.length
    ? `Wrote a new summary around ${joinList(focus.slice(0, 3).map(t => t.name))}`
    : 'Wrote a general summary (no specific technologies detected in the posting)');


  // Projects: all of them (up to four), the ones most relevant to this posting first.
  // Each description becomes bullets, and the technologies it names are its subtitle.
  const projects = profile.projects
    .map((pr, idx) => ({ ...pr, idx, score: relevance(`${pr.name} ${pr.desc}`) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, MAX_PROJECTS)
    .map(({ name, desc }) => ({
      name,
      desc,
      bullets: String(desc || '').split(/(?<=[.!?])\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean).slice(0, 3),
      tech: TERMS.filter(t => countMatches(t.re, `${name} ${desc}`) > 0 && t.category !== 'Ways of Working' && t.name !== 'AI').map(t => t.name).slice(0, 4)
    }));
  if (projects.length) {
    const lead = projects.filter(pr => relevance(`${pr.name} ${pr.desc}`) > 0).length;
    changes.push(`Kept ${projects.length} project${projects.length > 1 ? 's' : ''}${lead ? `, the ${lead} most relevant to this job first` : ''}`);
  }

  const requiredTotal = matched.filter(t => t.required).length + missing.filter(t => t.required).length;
  const requiredMatched = matched.filter(t => t.required).length;
  const matchScore = requiredTotal ? Math.round((requiredMatched / requiredTotal) * 100) : (matched.length ? 100 : 0);

  const cv = {
    name: profile.name,
    headline,
    tagline,
    email: profile.email,
    phone: profile.phone,
    linkedin: profile.linkedin,
    github: /^(https?:\/\/)?(www\.)?github\.com\//i.test(profile.github) ? profile.github : '',
    location: profile.location.replace(/\s*\(.*\)\s*$/, ''),
    summary,
    skills: skills.map(({ group, items }) => ({ group, items })),
    experience: experience.map(({ bullets, ...job }) => ({ ...job, bullets: bullets.map(b => b.text) })),
    // Shown by the layouts that have a projects section
    projects,
    education: profile.education,
    certifications: profile.certifications,
    languages: []
  };

  const layoutId = CV_TEMPLATES[template] ? template : DEFAULT_TEMPLATE;
  const layout = renderLayout(layoutId, cv, terms, title, company, styles[layoutId]);
  return {
    job: { title, company },
    coverage: cvCoverage(cv, matched),
    template: layoutId,
    analysis: {
      matchScore,
      matched: matched.map(t => ({ name: t.name, required: t.required, soft: t.soft, confirmed: t.confirmed, implied: t.implied || null })),
      missing: missing.map(t => ({ name: t.name, required: t.required, soft: t.soft, note: t.note || null }))
    },
    changes,
    cv,
    html: layout.html,
    css: layout.css,
    text: renderText(cv),
    latex: layout.latex,
    layouts: renderLayouts(cv, terms, title, company, styles),
    filename: cvFilename(company, title)
  };
}

// The CV in every available layout, each with its own style choices:
// { id: { label, html, css, latex, defaults } }
function renderLayouts(cv, terms, title, company, styles = {}) {
  return Object.fromEntries(Object.keys(CV_TEMPLATES).map(id => [id, renderLayout(id, cv, terms, title, company, styles && styles[id])]));
}

// ----- Editing a CV (Edit CV panel and the CV Editor) -----

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const str = (v, max = 300) => String(v ?? '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (v, max = 2000) => String(v ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
// Links and emails go into \href{…} unescaped, so only characters that are safe there are kept
const cleanUrl = (v) => str(v, 200).replace(/[^A-Za-z0-9._~:/?=&@+#-]/g, '').replace(/#/g, '');
const cleanEmail = (v) => str(v, 120).replace(/[^A-Za-z0-9._+@-]/g, '');

/**
 * A CV sent back by the editor, checked and cleaned: every field has a type and a
 * length limit, empty entries are dropped, and links can't carry LaTeX commands.
 */
export function normalizeCV(input) {
  const c = input && typeof input === 'object' ? input : {};
  return {
    name: str(c.name, 120),
    headline: str(c.headline, 150),
    tagline: list(c.tagline, 12).map(x => str(x, 40)).filter(Boolean),
    email: cleanEmail(c.email),
    phone: str(c.phone, 60),
    linkedin: cleanUrl(c.linkedin),
    github: cleanUrl(c.github),
    location: str(c.location, 120),
    summary: text(c.summary, 2500),
    skills: list(c.skills, 20).map(g => ({
      group: str(g && g.group, 60),
      items: list(g && g.items, 60).map(i => ({ name: str(typeof i === 'string' ? i : i && i.name, 60), matched: false })).filter(i => i.name)
    })).filter(g => g.items.length),
    experience: list(c.experience, 15).map(x => ({
      role: str(x && x.role, 150),
      company: str(x && x.company, 150),
      period: str(x && x.period, 60),
      location: str(x && x.location, 120),
      bullets: list(x && x.bullets, 15).map(b => str(b, 600)).filter(Boolean)
    })).filter(x => x.role || x.company),
    projects: list(c.projects, 10).map(pr => {
      const bullets = list(pr && pr.bullets, 8).map(b => str(b, 600)).filter(Boolean);
      return { name: str(pr && pr.name, 150), desc: bullets.join(' ') || str(pr && pr.desc, 1200), bullets, tech: list(pr && pr.tech, 12).map(t => str(t, 40)).filter(Boolean) };
    }).filter(pr => pr.name),
    education: list(c.education, 8).map(e => ({ degree: str(e && e.degree, 200), school: str(e && e.school, 200), period: str(e && e.period, 60) })).filter(e => e.degree || e.school),
    certifications: list(c.certifications, 20).map(x => str(x, 250)).filter(Boolean),
    languages: []
  };
}

/** The whole profile as a CV (not tailored to any job), to edit on your own. */
export function profileToCV(profileMd) {
  const profile = parseProfile(profileMd);
  return normalizeCV({
    name: profile.name,
    headline: profile.title || (profile.experience[0] ? profile.experience[0].role : ''),
    tagline: profile.skills.flatMap(g => g.items).slice(0, 8),
    email: profile.email,
    phone: profile.phone,
    linkedin: profile.linkedin,
    github: /^(https?:\/\/)?(www\.)?github\.com\//i.test(profile.github) ? profile.github : '',
    location: profile.location.replace(/\s*\(.*\)\s*$/, ''),
    summary: profile.summary,
    skills: profile.skills.filter(g => g.items.length).map(g => ({ group: g.group || 'Skills', items: g.items })),
    experience: profile.experience,
    projects: profile.projects.map(pr => ({
      name: pr.name,
      desc: pr.desc,
      bullets: String(pr.desc || '').split(/(?<=[.!?])\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean),
      tech: TERMS.filter(t => countMatches(t.re, pr.desc || '') > 0 && t.category !== 'Ways of Working' && t.name !== 'AI').map(t => t.name).slice(0, 4)
    })),
    education: profile.education,
    certifications: profile.certifications
  });
}

/**
 * Re-render a CV after its content changed (edited by hand or rewritten by Claude):
 * checks the content, re-marks which skills match the posting (when there is one)
 * and rebuilds the HTML, text and LaTeX in every layout with the chosen styles.
 * @param {any} cv
 * @param {{ title?: string, company?: string, description?: string, confirmedSkills?: string[] }} job
 * @param {string} profileMd
 * @param {{ template?: string, styles?: Record<string, object> }} [options]
 */
export function renderTailoredCV(cv, { title = '', company = '', description = '', confirmedSkills = [] } = {}, profileMd = '', { template = DEFAULT_TEMPLATE, styles = {} } = {}) {
  const clean = normalizeCV(cv);
  const hasJob = Boolean(String(description).trim() || String(title).trim());
  const matched = hasJob ? analyseJob(description, title, profileMd, confirmedSkills).matched : [];
  const isMatch = (item) => matched.some(t => countMatches(t.re, item) > 0);
  const out = { ...clean, skills: clean.skills.map(g => ({ group: g.group, items: g.items.map(i => ({ name: i.name, matched: isMatch(i.name) })) })) };
  const layoutId = CV_TEMPLATES[template] ? template : DEFAULT_TEMPLATE;
  const layout = renderLayout(layoutId, out, matched, title, company, styles && styles[layoutId]);
  return {
    cv: out,
    coverage: hasJob ? cvCoverage(out, matched) : null,
    template: layoutId,
    html: layout.html,
    css: layout.css,
    text: renderText(out),
    latex: layout.latex,
    layouts: renderLayouts(out, matched, title, company, styles)
  };
}

const words = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

// Everything the profile says about the candidate's work, for summary facts
const workText = (profile) => [
  profile.summary,
  ...profile.experience.flatMap(x => [x.role, ...x.bullets]),
  ...profile.skills.flatMap(g => g.items),
  ...profile.projects.map(p => `${p.name} ${p.desc}`)
].join('\n');

/**
 * How well the finished CV presents the candidate for this job: of the posting's
 * required skills the candidate meets, how many the CV actually shows (in any wording
 * the posting uses). After tailoring this should be 100%.
 */
function cvCoverage(cv, matched) {
  const text = [
    cv.headline, cv.summary, ...(cv.tagline || []),
    ...cv.skills.flatMap(g => g.items.map(i => (typeof i === 'string' ? i : i.name))),
    ...cv.experience.flatMap(x => x.bullets),
    ...(cv.projects || []).map(p => `${p.name} ${p.desc}`)
  ].join('\n');
  const needed = matched.filter(t => t.required && !t.soft);
  const shown = needed.filter(t => countMatches(t.re, text) > 0);
  return {
    cvScore: needed.length ? Math.round((shown.length / needed.length) * 100) : 100,
    cvShown: shown.length,
    cvNeeded: needed.length,
    notShown: needed.filter(t => !shown.includes(t)).map(t => t.name)
  };
}

function joinList(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function cvFilename(company, title) {
  const clean = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 32);
  return `main_${clean(company) || 'Company'}_${clean(title) || 'Role'}.tex`;
}

// ---------- Renderers ----------

const linkedinShort = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const contactParts = (cv) => [cv.location, cv.email, cv.phone, cv.linkedin ? linkedinShort(cv.linkedin) : ''].filter(Boolean);
const texPeriod = (p) => escTex(String(p || '').replace(/\s*[–—-]\s*/g, ' -- '));

function renderText(cv) {
  const lines = [
    cv.name, cv.headline, cv.tagline.join(' | '), contactParts(cv).join(' | '), '',
    'PROFESSIONAL SUMMARY', cv.summary, '',
    'TECHNICAL SKILLS', ...cv.skills.map(g => `${g.group}: ${g.items.map(i => i.name).join(', ')}`), '',
    'PROFESSIONAL EXPERIENCE'
  ];
  for (const x of cv.experience) {
    lines.push(`${x.role} | ${x.company} | ${x.period}`, ...x.bullets.map(b => `- ${b}`), '');
  }
  if (cv.projects.length) lines.push('SELECTED PROJECTS', ...cv.projects.map(p => `- ${p.name}: ${p.desc}`), '');
  lines.push('EDUCATION', ...cv.education.map(e => `${e.degree}${e.period ? ` | ${e.period}` : ''}\n${e.school}`), '');
  if (cv.certifications.length) lines.push('CERTIFICATIONS', ...cv.certifications.map(c => `- ${c}`), '');
  if (cv.languages.length) lines.push('LANGUAGES', cv.languages.map(l => `${l.name} (${l.level})`).join(', '));
  return lines.join('\n').trim();
}

// ----- Style options (ported from the CV adjustment kit, lib/latex/style.ts) -----
//
// The toolbar's choices: font, size, header alignment, accent colour, line and
// section spacing, bold/italic headings, and which sections show in what order.
// Every option is optional and falls back to the layout's own look, so an
// untouched toolbar reproduces each LaTeX template exactly as supplied.

export const CV_SECTION_IDS = ['summary', 'experience', 'education', 'skills', 'projects', 'certifications'];
export const CV_FONT_FAMILIES = ['template', 'helvetica', 'times', 'palatino', 'century-gothic'];
// article.cls supports these base sizes
export const CV_FONT_SIZES = [10, 11, 12];

const FONT_PREAMBLES = {
  template: '',
  helvetica: '\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}',
  times: '\\usepackage{tgtermes}\n\\renewcommand{\\familydefault}{\\rmdefault}',
  palatino: '\\usepackage{tgpagella}\n\\renewcommand{\\familydefault}{\\rmdefault}',
  // TeX Gyre Adventor: the Century Gothic-style font that ships with TeX Live
  'century-gothic': '\\usepackage{tgadventor}\n\\renewcommand{\\familydefault}{\\sfdefault}'
};
// The same families in the browser preview
const FONT_CSS = {
  helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  times: "'TeX Gyre Termes', 'Times New Roman', Times, serif",
  palatino: "'TeX Gyre Pagella', 'Palatino Linotype', Palatino, 'Book Antiqua', serif",
  'century-gothic': "'Century Gothic', 'TeX Gyre Adventor', 'URW Gothic', sans-serif"
};

const HEX = /^#?([0-9a-fA-F]{6})$/;
const toHex = (color, fallback) => (HEX.exec(String(color || '').trim()) || HEX.exec(fallback) || [0, '000000'])[1].toUpperCase();
const clampNum = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback);
const pts = (v) => String(Math.round(v * 100) / 100);

/** The toolbar's choices merged over a layout's defaults, plus the LaTeX/CSS values they imply. */
export function resolveStyle(style, defaults) {
  const st = style && typeof style === 'object' ? style : {};
  const fontFamily = CV_FONT_FAMILIES.includes(st.fontFamily) ? st.fontFamily : defaults.fontFamily;
  const fontSize = CV_FONT_SIZES.includes(Number(st.fontSize)) ? Number(st.fontSize) : defaults.fontSize;
  const headerAlign = ['left', 'center', 'right'].includes(st.headerAlign) ? st.headerAlign : defaults.headerAlign;
  const accentHex = toHex(st.accentColor, defaults.accentColor);
  const lineSpacing = clampNum(st.lineSpacing ?? defaults.lineSpacing, 0.8, 2, defaults.lineSpacing);
  const sectionSpacing = clampNum(st.sectionSpacing ?? defaults.sectionSpacing, 0.4, 2.5, defaults.sectionSpacing);
  const boldHeadings = typeof st.boldHeadings === 'boolean' ? st.boldHeadings : defaults.boldHeadings;
  const italicHeadings = typeof st.italicHeadings === 'boolean' ? st.italicHeadings : defaults.italicHeadings;
  // Unknown or repeated ids are dropped, so a stale saved choice can't hide or double a section
  const requested = Array.isArray(st.sections) ? st.sections.filter((id, i, all) => CV_SECTION_IDS.includes(id) && all.indexOf(id) === i) : [];
  const sections = requested.length ? requested : defaults.sections;
  return {
    fontFamily, fontSize, headerAlign, lineSpacing, sectionSpacing, boldHeadings, italicHeadings, sections,
    accentColor: `#${accentHex}`,
    accentHex,
    accentChanged: accentHex !== toHex(defaults.accentColor, '#000000'),
    fontPreamble: FONT_PREAMBLES[fontFamily],
    gap: (v) => pts(v * sectionSpacing),
    headingStyle: `${boldHeadings ? '\\bfseries' : ''}${italicHeadings ? '\\itshape' : ''}`,
    heading: (text) => { const t = italicHeadings ? `\\textit{${text}}` : text; return boldHeadings ? `\\textbf{${t}}` : t; },
    alignEnv: headerAlign === 'center' ? 'center' : headerAlign === 'right' ? 'flushright' : 'flushleft',
    alignBlock: (content) => (headerAlign === 'center' ? `\\begin{center}\n${content}\n\\end{center}`
      : headerAlign === 'right' ? `\\begin{flushright}\n${content}\n\\end{flushright}` : content),
    linespread: lineSpacing === 1 ? '' : `\n\\linespread{${pts(lineSpacing)}}`,
    shows: (id) => sections.includes(id)
  };
}

/** The sections in the order chosen, skipping hidden ones and ones the layout has no renderer for. */
function renderSections(s, renderers) {
  return s.sections.filter(id => s.shows(id)).map(id => (renderers[id] ? renderers[id]() : '')).join('');
}

/** Preview CSS that mirrors the style choices over a layout's own CSS. */
function styleCss(s, d, { lineHeight, h2Top, h2Bottom, accent = 'h2' }) {
  const ratio = s.fontSize / d.fontSize;
  return `
  ${s.fontFamily !== 'template' ? `body { font-family: ${FONT_CSS[s.fontFamily]}; }` : ''}
  ${ratio !== 1 ? `.page { zoom: ${pts(ratio)}; }` : ''}
  body { line-height: ${pts(lineHeight * s.lineSpacing)}; }
  .cv-header, .cv-header p { text-align: ${s.headerAlign}; }
  h2 { margin-top: ${pts(h2Top * s.sectionSpacing)}px; margin-bottom: ${pts(h2Bottom * s.sectionSpacing)}px; font-weight: ${s.boldHeadings ? 700 : 400}; font-style: ${s.italicHeadings ? 'italic' : 'normal'}; }
  ${s.accentChanged ? `${accent} { color: ${s.accentColor}; border-color: ${s.accentColor}; }` : ''}`;
}

const SHARED_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { color: #000; background: #fff; overflow-wrap: anywhere; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .row .r { white-space: nowrap; text-align: right; }
  mark { background: none; color: inherit; }
  body.highlight mark { background: #fff2b3; border-radius: 2px; box-shadow: 0 0 0 1px #fff2b3; }
  @media print { .page { padding: 0 !important; zoom: 1 !important; } body.highlight mark { background: none; box-shadow: none; } }
  @media screen and (max-width: 600px) { .page { padding: 22px 16px 28px !important; } .row { flex-wrap: wrap; gap: 0 8px; } .row .r { white-space: normal; } }`;

// Shared helpers for the layouts
const hrefOf = (url) => (/^https?:/i.test(url) ? url : `https://${url}`);
const texLink = (url) => `\\href{${hrefOf(url)}}{${escTex(linkedinShort(url))}}`;
const htmlLink = (url) => escHtml(linkedinShort(url));
// A project's description as bullets (older results may carry only the description)
const projectBullets = (pr) => (pr.bullets && pr.bullets.length ? pr.bullets : [pr.desc].filter(Boolean));
const skillLine = (g) => `${g.items.map(i => (typeof i === 'string' ? i : i.name)).join(', ')}`;
// Right-hand columns are narrow: "United Arab Emirates / Remote" -> "United Arab Emirates"
const shortPlace = (loc) => { const l = String(loc || '').trim(); return l.length > 22 ? l.split(/\s*[/|]\s*/)[0] : l; };
const skillNames = (cv, max) => cv.skills.flatMap(g => g.items.map(i => (typeof i === 'string' ? i : i.name))).slice(0, max);
const periodText = (p) => String(p || '').replace(/\s*[–—-]\s*/g, ' – ');
// Titles held, for the titles line under the name ("Senior AI Engineer • Full Stack Engineer")
const titlesLine = (cv) => [...new Set([cv.headline, ...cv.experience.map(x => x.role)].filter(Boolean))].slice(0, 2);
const skillHtml = (i) => (i.matched ? `<mark>${escHtml(i.name)}</mark>` : escHtml(i.name));
const texHeader = (cv, title, company) => `%% Tailored CV - ${escTex(cv.name)}
%% Target: ${escTex(title)}${company ? ` at ${escTex(company)}` : ''}
%% Generated by the Kairo Tailor CV tool from the candidate profile.
`;
const accentPreamble = (s, loadXcolor) => (s.accentChanged ? `${loadXcolor ? '\n\\usepackage{xcolor}' : ''}\n\\definecolor{accent}{HTML}{${s.accentHex}}` : '');
const withAccent = (s, text) => (s.accentChanged ? `{\\color{accent}${text}}` : text);

// ----- Template 1: ATS Classic (Helvetica) -----

const atsClassic = {
  id: 'ats-classic',
  label: 'ATS Classic (Helvetica)',
  defaultStyle: { fontFamily: 'template', fontSize: 10, headerAlign: 'center', accentColor: '#000000', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'] },

  css(s) {
    return `${SHARED_CSS}
  @page { size: letter; margin: 0.48in 0.60in; }
  body { font-family: Helvetica, Arial, 'Liberation Sans', sans-serif; font-size: 10pt; line-height: 1.32; }
  .page { padding: 0.48in 0.60in; max-width: 8.5in; margin: 0 auto; }
  .cv-header { text-align: center; }
  h1 { font-size: 17pt; font-weight: 700; line-height: 1.15; }
  .cv-headline { font-size: 10pt; font-weight: 700; margin-top: 3px; }
  .cv-tagline, .cv-contact { font-size: 9pt; margin-top: 3px; }
  .cv-contact span { margin: 0 5px; }
  h2 { font-size: 10pt; border-bottom: 0.5pt solid #000; padding-bottom: 1px; }
  .cv-skill { margin: 0 0 4px; }
  .cv-job { margin-top: 7px; break-inside: avoid; }
  .cv-job:first-of-type { margin-top: 0; }
  .cv-job-head { display: flex; justify-content: space-between; gap: 12px; font-weight: 700; }
  .cv-job-head span { white-space: nowrap; }
  .cv-company { margin-bottom: 2px; }
  ul { padding-left: 0.19in; margin-top: 3px; }
  li { margin: 1.2px 0; }
  .cv-edu { display: flex; justify-content: space-between; gap: 12px; }
  @media screen and (max-width: 600px) { .cv-job-head, .cv-edu { flex-wrap: wrap; gap: 0 8px; } .cv-job-head span { white-space: normal; } }
  ${styleCss(s, this.defaultStyle, { lineHeight: 1.32, h2Top: 10, h2Bottom: 5 })}`;
  },

  html(cv, terms, s) {
    const hl = (x) => markup(x, terms, escHtml, (m) => `<mark>${m}</mark>`);
    const sections = {
      summary: () => (cv.summary ? `<section><h2>Professional Summary</h2><p>${hl(cv.summary)}</p></section>` : ''),
      skills: () => (cv.skills.length ? `<section><h2>Technical Skills</h2>${cv.skills.map(g => `<p class="cv-skill"><strong>${escHtml(g.group)}:</strong> ${g.items.map(skillHtml).join(', ')}</p>`).join('')}</section>` : ''),
      experience: () => (cv.experience.length ? `<section><h2>Professional Experience</h2>${cv.experience.map(x => `
  <div class="cv-job"><div class="cv-job-head"><div>${escHtml(x.role)}</div><span>${escHtml(x.period)}</span></div>
    <div class="cv-company">${escHtml(x.company)}</div><ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      projects: () => (cv.projects.length ? `<section><h2>Projects</h2>${cv.projects.map(pr => `
  <div class="cv-job"><div class="cv-job-head"><div>${escHtml(pr.name)}</div><span></span></div>
    ${pr.tech.length ? `<div class="cv-company">${escHtml(pr.tech.join(', '))}</div>` : ''}<ul>${projectBullets(pr).map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      education: () => (cv.education.length ? `<section><h2>Education</h2>${cv.education.map(e => `<div class="cv-edu"><strong>${escHtml(e.degree)}</strong>${e.period ? `<strong>${escHtml(e.period)}</strong>` : ''}</div><div>${escHtml(e.school)}</div>`).join('')}</section>` : ''),
      certifications: () => (cv.certifications.length ? `<section><h2>Certifications</h2><ul>${cv.certifications.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></section>` : '')
    };
    return `
<header class="cv-header">
  <h1>${escHtml(cv.name)}</h1>
  ${cv.headline ? `<p class="cv-headline">${escHtml(cv.headline)}</p>` : ''}
  ${cv.tagline.length ? `<p class="cv-tagline">${cv.tagline.map(escHtml).join(' | ')}</p>` : ''}
  <p class="cv-contact">${contactParts(cv).map(escHtml).join('<span>|</span>')}</p>
</header>
${renderSections(s, sections)}`;
  },

  latex(cv, title, company, s) {
    const contact = [
      cv.location && escTex(cv.location),
      cv.email && `\\href{mailto:${cv.email}}{${escTex(cv.email)}}`,
      cv.phone && escTex(cv.phone),
      cv.linkedin && texLink(cv.linkedin)
    ].filter(Boolean).join(' \\;|\\;\n    ');
    const rule = withAccent(s, '\\rule{\\textwidth}{0.5pt}');
    const sections = {
      summary: () => (cv.summary ? `
%====================
% PROFESSIONAL SUMMARY
%====================

\\section{Professional Summary}

${escTex(cv.summary)}
` : ''),
      skills: () => (cv.skills.length ? `
%====================
% TECHNICAL SKILLS
%====================

\\section{Technical Skills}

${cv.skills.map(g => `\\textbf{${escTex(g.group)}:} ${escTex(skillLine(g))}`).join('\n\n')}
` : ''),
      experience: () => (cv.experience.length ? `
%====================
% EXPERIENCE
%====================

\\section{Professional Experience}
${cv.experience.map((x, i) => `
%====================
% ${escTex(x.company).toUpperCase()}
%====================
${i ? `\n\\vspace{${s.gap(5)}pt}\n` : ''}
\\role{${escTex(x.role)}}{${escTex(x.company)}}{${texPeriod(x.period)}}

\\begin{itemize}
${x.bullets.map(b => `    \\item ${escTex(b)}`).join('\n\n')}
\\end{itemize}`).join('\n')}
` : ''),
      projects: () => (cv.projects.length ? `
%====================
% PROJECTS
%====================

\\section{Projects}
${cv.projects.map((pr, i) => `${i ? `\n\\vspace{${s.gap(5)}pt}\n` : ''}
\\role{${escTex(pr.name)}}{${escTex(pr.tech.join(', '))}}{}

\\begin{itemize}
${projectBullets(pr).map(b => `    \\item ${escTex(b)}`).join('\n\n')}
\\end{itemize}`).join('\n')}
` : ''),
      education: () => (cv.education.length ? `
%====================
% EDUCATION
%====================

\\section{Education}
${cv.education.map(e => `\\textbf{${escTex(e.degree)}}${e.period ? ` \\hfill ${texPeriod(e.period)}` : ''}\\\\\n${escTex(e.school)}`).join('\n\n\\vspace{3pt}\n\n')}
` : ''),
      certifications: () => (cv.certifications.length ? `
%====================
% CERTIFICATIONS
%====================

\\section{Certifications}

\\begin{itemize}
${cv.certifications.map(c => `    \\item ${escTex(c)}`).join('\n')}
\\end{itemize}
` : '')
    };
    return `${texHeader(cv, title, company)}\\documentclass[${s.fontSize}pt,letterpaper]{article}

%====================
% PAGE SETUP
%====================
\\usepackage[
    top=0.48in,
    bottom=0.48in,
    left=0.60in,
    right=0.60in
]{geometry}

%====================
% FONT AND ATS
%====================
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{helvet}
\\renewcommand{\\familydefault}{\\sfdefault}${s.fontPreamble ? `\n${s.fontPreamble}` : ''}

% Improve ATS text extraction
\\input{glyphtounicode}
\\pdfgentounicode=1

%====================
% PACKAGES
%====================
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage{microtype}${accentPreamble(s, true)}${s.linespread}

%====================
% GENERAL SETTINGS
%====================
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}

\\raggedright
\\sloppy
\\hyphenpenalty=10000
\\exhyphenpenalty=10000

%====================
% SECTION FORMATTING
%====================
\\titleformat{\\section}
    {\\normalsize${s.headingStyle}${s.accentChanged ? '\\color{accent}' : ''}}
    {}
    {0pt}
    {}
    [\\vspace{-4pt}${rule}]

\\titlespacing*{\\section}
    {0pt}
    {${s.gap(8)}pt}
    {${s.gap(4)}pt}

%====================
% EXPERIENCE HEADER
%====================
\\newcommand{\\role}[3]{%
    \\textbf{\\normalsize #1} \\hfill \\textbf{#3}\\\\
    #2
    \\vspace{-2pt}
}

%====================
% BULLET SETTINGS
%====================
\\setlist[itemize]{
    leftmargin=0.19in,
    label=\\textbullet,
    itemsep=1.2pt,
    topsep=3pt,
    parsep=0pt,
    partopsep=0pt
}

%====================
% DOCUMENT
%====================
\\begin{document}

%====================
% HEADER
%====================

\\begin{${s.alignEnv}}
    {\\LARGE \\textbf{${escTex(cv.name)}}}\\\\[3pt]
${cv.headline ? `    {\\normalsize \\textbf{${escTex(cv.headline)}}}\\\\[3pt]\n` : ''}${cv.tagline.length ? `    {\\small ${cv.tagline.map(escTex).join(' | ')}}\\\\[4pt]\n` : ''}    {\\small ${contact}}
\\end{${s.alignEnv}}
${renderSections(s, sections)}
\\end{document}
`;
  }
};

// ----- Template 2: Modern (Latin Modern serif, small-caps headings) -----

const modernSerif = {
  id: 'modern-serif',
  label: 'Modern (Latin Modern)',
  defaultStyle: { fontFamily: 'template', fontSize: 10, headerAlign: 'center', accentColor: '#000000', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: ['summary', 'experience', 'projects', 'education', 'skills', 'certifications'] },

  css(s) {
    return `${SHARED_CSS}
  @page { size: A4; margin: 0.55in 0.62in; }
  body { font-family: 'Latin Modern Roman', 'CMU Serif', 'Computer Modern', Georgia, 'Times New Roman', serif; font-size: 10pt; line-height: 1.3; }
  .page { padding: 0.55in 0.62in; max-width: 8.27in; margin: 0 auto; }
  .cv-header { text-align: center; margin-bottom: 2px; }
  h1 { font-size: 24pt; font-weight: 700; font-variant: small-caps; line-height: 1.15; }
  .cv-contact { font-size: 9pt; margin-top: 4px; }
  .cv-contact span { margin: 0 4px; }
  h2 { font-size: 12pt; font-variant: small-caps; border-bottom: 0.6pt solid #000; padding-bottom: 1px; }
  p, li, .small { font-size: 9pt; }
  .sub { margin-top: 5px; break-inside: avoid; }
  .sub .row:first-child { font-weight: 700; font-size: 10pt; }
  .sub .row:nth-child(2) { font-style: italic; font-size: 9pt; }
  ul { padding-left: 0.22in; margin-top: 2px; }
  li { margin: 2px 0; }
  .plain { list-style: none; padding-left: 0; }
  ${styleCss(s, this.defaultStyle, { lineHeight: 1.3, h2Top: 10, h2Bottom: 5 })}`;
  },

  html(cv, terms, s) {
    const hl = (x) => markup(x, terms, escHtml, (m) => `<mark>${m}</mark>`);
    const contact = [cv.phone && escHtml(cv.phone), cv.email && escHtml(cv.email), cv.location && escHtml(cv.location),
      cv.linkedin && htmlLink(cv.linkedin), cv.github && htmlLink(cv.github)].filter(Boolean);
    const sections = {
      summary: () => (cv.summary ? `<section><h2>Summary</h2><p>${hl(cv.summary)}</p></section>` : ''),
      experience: () => (cv.experience.length ? `<section><h2>Experience</h2>${cv.experience.map(x => `
  <div class="sub"><div class="row"><span>${escHtml(x.role)}</span><span class="r">${escHtml(x.period)}</span></div>
  <div class="row"><span>${escHtml(x.company)}</span><span class="r">${escHtml(shortPlace(x.location))}</span></div>
  <ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      projects: () => (cv.projects.length ? `<section><h2>Projects</h2>${cv.projects.map(pr => `
  <div class="sub"><div class="row"><strong>${escHtml(pr.name)}</strong><em class="r small">${escHtml(pr.tech.join(', '))}</em></div>
  <ul>${projectBullets(pr).map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      education: () => (cv.education.length ? `<section><h2>Education</h2>${cv.education.map(e => `
  <div class="sub"><div class="row"><span>${escHtml(e.school)}</span><span class="r">${escHtml(e.period)}</span></div>
  <div class="row"><span>${escHtml(e.degree)}</span><span class="r"></span></div></div>`).join('')}</section>` : ''),
      skills: () => (cv.skills.length ? `<section><h2>Technical Skills</h2>${cv.skills.map(g => `<p><strong>${escHtml(g.group)}:</strong> ${g.items.map(skillHtml).join(', ')}</p>`).join('')}</section>` : ''),
      certifications: () => (cv.certifications.length ? `<section><h2>Certifications</h2><ul class="plain">${cv.certifications.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></section>` : '')
    };
    return `
<header class="cv-header"><h1>${escHtml(cv.name)}</h1><p class="cv-contact">${contact.join('<span>|</span>')}</p></header>
${renderSections(s, sections)}`;
  },

  latex(cv, title, company, s) {
    const contact = [
      cv.phone && escTex(cv.phone),
      cv.email && `\\href{mailto:${cv.email}}{${escTex(cv.email)}}`,
      cv.location && escTex(cv.location),
      cv.linkedin && texLink(cv.linkedin),
      cv.github && texLink(cv.github)
    ].filter(Boolean).join(' \\textbar{} ');
    const sections = {
      summary: () => (cv.summary ? `
\\section{Summary}

{\\small
${escTex(cv.summary)}
}
` : ''),
      experience: () => (cv.experience.length ? `
\\section{Experience}
${cv.experience.map(x => `
\\resumeSubheading
{${escTex(x.role)}}
{${texPeriod(x.period)}}
{${escTex(x.company)}}
{${escTex(shortPlace(x.location))}}

\\begin{resumeItemList}
${x.bullets.map(b => `  \\resumeItem{${escTex(b)}}`).join('\n')}
\\end{resumeItemList}`).join('\n')}
` : ''),
      projects: () => (cv.projects.length ? `
\\section{Projects}
${cv.projects.map(pr => `
\\resumeProjectHeading
{${escTex(pr.name)}}
{${escTex(pr.tech.join(', '))}}

\\begin{resumeItemList}
${projectBullets(pr).map(b => `  \\resumeItem{${escTex(b)}}`).join('\n')}
\\end{resumeItemList}`).join('\n')}
` : ''),
      education: () => (cv.education.length ? `
\\section{Education}
${cv.education.map(e => `
\\resumeSubheading
{${escTex(e.school)}}
{${texPeriod(e.period)}}
{${escTex(e.degree)}}
{}`).join('\n')}
` : ''),
      skills: () => (cv.skills.length ? `
\\section{Technical Skills}

{\\small
${cv.skills.map(g => `\\textbf{${escTex(g.group)}:} ${escTex(skillLine(g))}`).join(' \\\\\n')}
}
` : ''),
      certifications: () => (cv.certifications.length ? `
\\section{Certifications}

\\begin{resumeNoBulletList}
${cv.certifications.map(c => `  \\item {\\small ${escTex(c)}}`).join('\n')}
\\end{resumeNoBulletList}
` : '')
    };
    return `${texHeader(cv, title, company)}\\documentclass[a4paper,${s.fontSize}pt]{article}

\\usepackage[
  a4paper,
  top=0.55in,
  bottom=0.55in,
  left=0.62in,
  right=0.62in
]{geometry}

\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}${s.fontPreamble ? `\n${s.fontPreamble}` : ''}
\\usepackage{microtype}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{xcolor}
\\usepackage{tabularx}
\\usepackage{array}
\\usepackage[english]{babel}${accentPreamble(s, false)}${s.linespread}

\\pdfgentounicode=1

\\pagestyle{empty}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\setlength{\\tabcolsep}{0pt}

\\urlstyle{same}
\\raggedbottom
\\raggedright

\\titleformat{\\section}
  {\\large${s.headingStyle}\\scshape\\raggedright${s.accentChanged ? '\\color{accent}' : ''}}
  {}
  {0em}
  {}
  [\\titlerule]

\\titlespacing*{\\section}
  {0pt}
  {${s.gap(8)}pt}
  {${s.gap(4)}pt}

\\newcommand{\\resumeItem}[1]{
  \\item {\\small #1}
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{1pt}
  \\begin{tabularx}{\\textwidth}{@{}X r@{}}
    \\textbf{#1} & \\textbf{#2} \\\\
    \\textit{\\small #3} & \\textit{\\small #4}
  \\end{tabularx}
  \\vspace{2pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
  \\begin{tabularx}{\\textwidth}{@{}X r@{}}
    \\textbf{#1} & \\textit{\\small #2}
  \\end{tabularx}
  \\vspace{-5pt}
}

\\newenvironment{resumeItemList}{
  \\begin{itemize}[
    leftmargin=0.22in,
    label=\\textbullet,
    before=\\vspace{-7pt},
    itemsep=2pt,
    topsep=2pt,
    parsep=0pt,
    partopsep=0pt
  ]
}{
  \\end{itemize}
}

\\newenvironment{resumeNoBulletList}{
  \\begin{itemize}[
    leftmargin=0in,
    label={},
    itemsep=1pt,
    topsep=1pt,
    parsep=0pt,
    partopsep=0pt
  ]
}{
  \\end{itemize}
}

\\begin{document}

\\begin{${s.alignEnv}}

  {\\fontsize{24}{28}\\selectfont
  \\textbf{\\scshape ${escTex(cv.name)}}}

  \\vspace{4pt}
  {\\small ${contact}}

\\end{${s.alignEnv}}

\\vspace{-3pt}
${renderSections(s, sections)}
\\end{document}
`;
  }
};

// ----- Template 3: Traditional (Times serif, UPPERCASE headings) -----

const traditional = {
  id: 'traditional',
  label: 'Traditional (Times)',
  defaultStyle: { fontFamily: 'template', fontSize: 11, headerAlign: 'center', accentColor: '#000000', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: ['summary', 'education', 'experience', 'projects', 'certifications', 'skills'] },

  css(s) {
    return `${SHARED_CSS}
  @page { size: A4; margin: 0.55in 0.6in; }
  body { font-family: 'TeX Gyre Termes', 'Times New Roman', Times, 'Liberation Serif', serif; font-size: 11pt; line-height: 1.3; }
  .page { padding: 0.55in 0.6in; max-width: 8.27in; margin: 0 auto; }
  .cv-header { text-align: center; }
  h1 { font-size: 17pt; font-weight: 700; text-transform: uppercase; line-height: 1.2; }
  .cv-contact { margin-top: 3px; font-size: 10.5pt; }
  .cv-contact span { margin: 0 5px; }
  h2 { font-size: 11pt; text-transform: uppercase; border-bottom: 0.5pt solid #000; padding-bottom: 2.5px; }
  .entry { margin-top: 7px; break-inside: avoid; }
  .entry:first-of-type { margin-top: 0; }
  ul { padding-left: 0.45in; margin-top: 2px; }
  li { margin: 1px 0; padding-left: 0.05in; }
  @media screen and (max-width: 600px) { ul { padding-left: 0.3in; } }
  ${styleCss(s, this.defaultStyle, { lineHeight: 1.3, h2Top: 12, h2Bottom: 5 })}`;
  },

  html(cv, terms, s) {
    const hl = (x) => markup(x, terms, escHtml, (m) => `<mark>${m}</mark>`);
    const contact = [cv.location && escHtml(cv.location), cv.email && escHtml(cv.email), cv.phone && escHtml(cv.phone),
      cv.linkedin && htmlLink(cv.linkedin), cv.github && htmlLink(cv.github)].filter(Boolean);
    const sections = {
      summary: () => (cv.summary ? `<section><h2>Summary</h2><p>${hl(cv.summary)}</p></section>` : ''),
      education: () => (cv.education.length ? `<section><h2>Education</h2>${cv.education.map(e => `
  <div class="entry"><div class="row"><strong>${escHtml(e.school)}</strong><span class="r"></span></div>
  <div class="row"><span>${escHtml(e.degree)}</span><span class="r">${escHtml(e.period)}</span></div></div>`).join('')}</section>` : ''),
      experience: () => (cv.experience.length ? `<section><h2>Professional Experience</h2>${cv.experience.map(x => `
  <div class="entry"><div class="row"><strong>${escHtml(x.company)}</strong><span class="r">${escHtml(shortPlace(x.location))}</span></div>
  <div class="row"><span>${escHtml(x.role)}</span><span class="r">${escHtml(x.period)}</span></div>
  <ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      projects: () => (cv.projects.length ? `<section><h2>Projects</h2>${cv.projects.map(pr => `
  <div class="entry"><div class="row"><strong>${escHtml(pr.name)}</strong><span class="r">${escHtml(pr.tech.join(', '))}</span></div>
  <ul>${projectBullets(pr).map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      certifications: () => (cv.certifications.length ? `<section><h2>Certifications</h2><ul>${cv.certifications.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></section>` : ''),
      skills: () => (cv.skills.length ? `<section><h2>Other</h2><ul>${cv.skills.map(g => `<li><strong>${escHtml(g.group)}</strong>: ${g.items.map(skillHtml).join(', ')}</li>`).join('')}</ul></section>` : '')
    };
    return `
<header class="cv-header"><h1>${escHtml(cv.name)}</h1><p class="cv-contact">${contact.join('<span>•</span>')}</p></header>
${renderSections(s, sections)}`;
  },

  latex(cv, title, company, s) {
    const contact = [
      cv.location && escTex(cv.location),
      cv.email && `\\href{mailto:${cv.email}}{${escTex(cv.email)}}`,
      cv.phone && escTex(cv.phone),
      cv.linkedin && texLink(cv.linkedin),
      cv.github && texLink(cv.github)
    ].filter(Boolean).join(' \\textbullet\\ ');
    const sections = {
      summary: () => (cv.summary ? `
\\cvsection{Summary}

\\noindent ${escTex(cv.summary)}\\par
` : ''),
      education: () => (cv.education.length ? `
\\cvsection{Education}
${cv.education.map(e => `
\\cvrow
{\\textbf{${escTex(e.school)}}}
{}

\\cvrow
{${escTex(e.degree)}}
{${texPeriod(e.period)}}`).join('\n\n\\entrygap\n')}
` : ''),
      experience: () => (cv.experience.length ? `
\\cvsection{Professional Experience}
${cv.experience.map(x => `
\\cvrow
{\\textbf{${escTex(x.company)}}}
{${escTex(shortPlace(x.location))}}

\\cvrow
{${escTex(x.role)}}
{${texPeriod(x.period)}}

\\begin{itemize}
${x.bullets.map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{itemize}`).join('\n\n\\entrygap\n')}
` : ''),
      projects: () => (cv.projects.length ? `
\\cvsection{Projects}
${cv.projects.map(pr => `
\\cvrow
{\\textbf{${escTex(pr.name)}}}
{${escTex(pr.tech.join(', '))}}

\\begin{itemize}
${projectBullets(pr).map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{itemize}`).join('\n\n\\entrygap\n')}
` : ''),
      certifications: () => (cv.certifications.length ? `
\\cvsection{Certifications}

\\begin{itemize}
${cv.certifications.map(c => `  \\item ${escTex(c)}`).join('\n')}
\\end{itemize}
` : ''),
      skills: () => (cv.skills.length ? `
\\cvsection{Other}

\\begin{itemize}
${cv.skills.map(g => `  \\item \\textbf{${escTex(g.group)}}: ${escTex(skillLine(g))}`).join('\n')}
\\end{itemize}
` : '')
    };
    return `${texHeader(cv, title, company)}\\documentclass[${s.fontSize}pt,a4paper]{article}

\\usepackage[
  a4paper,
  top=0.55in,
  bottom=0.55in,
  left=0.6in,
  right=0.6in
]{geometry}

\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}

\\IfFileExists{tgtermes.sty}{%
  \\usepackage{tgtermes}%
}{%
  \\usepackage{lmodern}%
}${s.fontPreamble ? `\n${s.fontPreamble}` : ''}

\\usepackage{enumitem}
\\usepackage{ragged2e}
\\usepackage[hidelinks]{hyperref}${accentPreamble(s, true)}${s.linespread}

\\IfFileExists{needspace.sty}{%
  \\usepackage{needspace}%
}{%
  \\newcommand{\\Needspace}[1]{}%
}

\\pdfgentounicode=1

\\pagestyle{empty}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}

\\urlstyle{same}
\\raggedbottom

\\newcommand{\\cvsection}[1]{%
  \\vspace{${s.gap(9)}pt}%
  \\Needspace{4\\baselineskip}%
  \\noindent${withAccent(s, s.heading('\\MakeUppercase{#1}'))}\\par
  \\vspace{2.5pt}%
  ${s.accentChanged ? '{\\color{accent}\\hrule height 0.5pt}' : '\\hrule height 0.5pt'}
  \\vspace{${s.gap(4)}pt}%
}

\\newcommand{\\cvrow}[2]{%
  \\Needspace{2\\baselineskip}%
  \\noindent
  \\begin{minipage}[t]{0.71\\textwidth}%
    \\RaggedRight #1%
  \\end{minipage}%
  \\hfill
  \\begin{minipage}[t]{0.27\\textwidth}%
    \\RaggedLeft #2%
  \\end{minipage}\\par
}

\\setlist[itemize]{
  leftmargin=0.45in,
  labelsep=0.2in,
  label=\\textbullet,
  itemsep=1pt,
  topsep=2pt,
  parsep=0pt,
  partopsep=0pt
}

\\newcommand{\\entrygap}{\\vspace{7pt}}

\\begin{document}

\\begin{${s.alignEnv}}

{\\fontsize{17}{20}\\selectfont\\bfseries\\MakeUppercase{${escTex(cv.name)}}}

\\vspace{3pt}

${contact}

\\end{${s.alignEnv}}

\\vspace{1pt}
${renderSections(s, sections)}
\\end{document}
`;
  }
};

// ----- Template 4: Executive (centred headings between rules, 3-column skills) -----

// Skills shown in the 3-column grid (most relevant first); keeps the CV to two pages
const EXECUTIVE_SKILLS = 18;

const executive = {
  id: 'executive',
  label: 'Executive (centred headings)',
  defaultStyle: { fontFamily: 'template', fontSize: 11, headerAlign: 'center', accentColor: '#000000', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: ['summary', 'skills', 'experience', 'projects', 'certifications', 'education'] },

  css(s) {
    return `${SHARED_CSS}
  @page { size: A4; margin: 0.6in 0.75in; }
  body { font-family: 'Latin Modern Sans', 'CMU Sans Serif', 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; line-height: 1.3; }
  .page { padding: 0.6in 0.75in; max-width: 8.27in; margin: 0 auto; }
  .cv-header { text-align: center; }
  h1 { font-size: 12pt; font-weight: 700; text-transform: uppercase; }
  .cv-contact { font-size: 9.5pt; margin-top: 2px; }
  .cv-contact span { margin: 0 4px; }
  .rule { border-top: 0.6pt solid #000; margin-top: 4px; }
  .cv-title { text-align: center; font-weight: 700; text-transform: uppercase; margin: 9px 0 7px; }
  .justify { text-align: justify; }
  h2 { text-align: center; font-size: 11pt; text-transform: uppercase; border-top: 0.6pt solid #000; border-bottom: 0.6pt solid #000; padding: 2px 0; }
  .cols { columns: 3; column-gap: 14px; list-style: none; padding-left: 0; }
  .cols li { padding-left: 1.1em; position: relative; margin: 1.5px 0; break-inside: avoid; }
  .cols li::before { content: '■'; font-size: 7pt; position: absolute; left: 0; top: 2px; }
  .entry { margin-top: 4px; break-inside: avoid; }
  .entry .row:first-child span:first-child { font-weight: 700; }
  .role { font-weight: 700; font-style: italic; }
  ul { padding-left: 1.4em; margin-top: 2px; } li { margin: 1.5px 0; }
  @media screen and (max-width: 600px) { .cols { columns: 2; } }
  ${styleCss(s, this.defaultStyle, { lineHeight: 1.3, h2Top: 10, h2Bottom: 6 })}`;
  },

  html(cv, terms, s) {
    const hl = (x) => markup(x, terms, escHtml, (m) => `<mark>${m}</mark>`);
    const contact = [cv.location, cv.phone, cv.email, cv.linkedin && linkedinShort(cv.linkedin), cv.github && linkedinShort(cv.github)].filter(Boolean).map(escHtml);
    const skillHits = new Set(cv.skills.flatMap(g => g.items.filter(i => i.matched).map(i => i.name)));
    const sections = {
      summary: () => (cv.summary ? `<p class="justify">${hl(cv.summary)}</p>` : ''),
      skills: () => (cv.skills.length ? `<section><h2>Skills and Technology</h2><ul class="cols">${skillNames(cv, EXECUTIVE_SKILLS).map(n => `<li>${skillHits.has(n) ? `<mark>${escHtml(n)}</mark>` : escHtml(n)}</li>`).join('')}</ul></section>` : ''),
      experience: () => (cv.experience.length ? `<section><h2>Professional Experience</h2>${cv.experience.map(x => `
  <div class="entry"><div class="row"><span>${escHtml([x.company, x.location].filter(Boolean).join(', '))}</span><span class="r">${escHtml(periodText(x.period))}</span></div>
  <div class="role">${escHtml(x.role)}</div>
  <ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      projects: () => (cv.projects.length ? `<section><h2>Projects</h2>${cv.projects.map(pr => `
  <div class="entry"><div class="row"><span>${escHtml(pr.name)}</span><span class="r"></span></div>
  <ul>${projectBullets(pr).map(b => `<li>${hl(b)}</li>`).join('')}${pr.tech.length ? `<li>Technologies: ${escHtml(pr.tech.join(', '))}</li>` : ''}</ul></div>`).join('')}</section>` : ''),
      certifications: () => (cv.certifications.length ? `<section><h2>Certifications and Affiliations</h2><ul>${cv.certifications.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></section>` : ''),
      education: () => (cv.education.length ? `<section><h2>Education</h2>${cv.education.map(e => `<p>${escHtml([e.degree, e.school, e.period].filter(Boolean).join(', '))}</p>`).join('')}</section>` : '')
    };
    return `
<header class="cv-header"><h1>${escHtml(cv.name)}</h1><p class="cv-contact">${contact.join('<span>|</span>')}</p></header>
<div class="rule"></div>
${cv.headline ? `<p class="cv-title">${escHtml(cv.headline)}</p>` : ''}
${renderSections(s, sections)}`;
  },

  latex(cv, title, company, s) {
    const contact = [cv.location && escTex(cv.location), cv.phone && escTex(cv.phone),
      cv.email && `\\href{mailto:${cv.email}}{${escTex(cv.email)}}`, cv.linkedin && texLink(cv.linkedin), cv.github && texLink(cv.github)]
      .filter(Boolean).join(' \\textbar\\ ');
    const rule = withAccent(s, '\\rule{\\textwidth}{0.6pt}');
    const sections = {
      summary: () => (cv.summary ? `
\\justifying
${escTex(cv.summary)}
\\par
` : ''),
      skills: () => (cv.skills.length ? `
\\cvsection{Skills and Technology}

\\begin{multicols}{3}
\\begin{itemize}[label=\\squarelabel]
${skillNames(cv, EXECUTIVE_SKILLS).map(n => `  \\item ${escTex(n)}`).join('\n')}
\\end{itemize}
\\end{multicols}
` : ''),
      experience: () => (cv.experience.length ? `
\\cvsection{Professional Experience}
${cv.experience.map(x => `
\\cventry
{${escTex([x.company, x.location].filter(Boolean).join(', '))}}
{${escTex(periodText(x.period).replace(/ – /g, '-'))}}
{${escTex(x.role)}}

\\begin{itemize}
${x.bullets.map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{itemize}

\\vspace{4pt}`).join('\n')}
` : ''),
      projects: () => (cv.projects.length ? `
\\cvsection{Projects}
${cv.projects.map(pr => `
\\cventry
{${escTex(pr.name)}}
{}
{}

\\begin{itemize}
${projectBullets(pr).map(b => `  \\item ${escTex(b)}`).join('\n')}${pr.tech.length ? `\n  \\item Technologies: ${escTex(pr.tech.join(', '))}` : ''}
\\end{itemize}

\\vspace{4pt}`).join('\n')}
` : ''),
      certifications: () => (cv.certifications.length ? `
\\cvsection{Certifications and Affiliations}

\\begin{itemize}
${cv.certifications.map(c => `  \\item ${escTex(c)}`).join('\n')}
\\end{itemize}
` : ''),
      education: () => (cv.education.length ? `
\\cvsection{Education}

${cv.education.map(e => `\\noindent ${escTex([e.degree, e.school, periodText(e.period)].filter(Boolean).join(', '))}\\par`).join('\n\n\\vspace{3pt}\n\n')}

\\vspace{5pt}
` : '')
    };
    return `${texHeader(cv, title, company)}\\documentclass[${s.fontSize}pt,a4paper]{article}

\\usepackage[
  top=0.6in,
  bottom=0.6in,
  left=0.75in,
  right=0.75in,
  headsep=10pt
]{geometry}

\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}

\\usepackage{amssymb}
\\usepackage{enumitem}
\\usepackage{multicol}
\\usepackage{fancyhdr}
\\usepackage{tabularx}
\\usepackage{xcolor}
\\usepackage{ragged2e}
\\usepackage[hidelinks]{hyperref}${accentPreamble(s, false)}${s.linespread}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\setlength{\\tabcolsep}{0pt}
\\setlength{\\columnsep}{14pt}

\\renewcommand{\\familydefault}{\\sfdefault}${s.fontPreamble ? `\n${s.fontPreamble}` : ''}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\small\\bfseries ${escTex(cv.name)}}
\\fancyhead[R]{\\small\\bfseries Page \\thepage}
\\renewcommand{\\headrulewidth}{0.6pt}

\\newcommand{\\cvsection}[1]{%
  \\par\\vspace{${s.gap(9)}pt}%
  \\noindent{${rule}}\\par
  \\vspace{2pt}%
  \\centerline{${withAccent(s, `${s.headingStyle}\\MakeUppercase{#1}`)}}
  \\vspace{2pt}%
  \\noindent{${rule}}\\par
  \\vspace{${s.gap(6)}pt}%
}

\\newcommand{\\skillgroup}[1]{%
  \\par\\noindent{\\underline{\\bfseries\\itshape #1}}\\par
  \\vspace{2pt}%
}

\\newcommand{\\cventry}[3]{%
  \\noindent
  \\begin{tabularx}{\\textwidth}{@{}X@{\\hspace{8pt}}r@{}}
    \\textbf{#1} & {#2}
  \\end{tabularx}\\par
  \\if\\relax\\detokenize{#3}\\relax
  \\else
    \\noindent{\\bfseries\\itshape #3}\\par
  \\fi
  \\vspace{1pt}%
}

\\newcommand{\\squarelabel}{%
  \\raisebox{0.15ex}{\\scriptsize$\\blacksquare$}%
}

\\setlist[itemize]{
  leftmargin=1.4em,
  label=\\textbullet,
  itemsep=1.5pt,
  topsep=2pt,
  parsep=0pt,
  partopsep=0pt
}

\\begin{document}

\\thispagestyle{empty}

\\begin{${s.alignEnv}}

{\\large\\bfseries\\MakeUppercase{${escTex(cv.name)}}}

\\vspace{2pt}

{\\small ${contact}}

\\end{${s.alignEnv}}

\\vspace{3pt}

\\noindent{\\rule{\\textwidth}{0.6pt}}\\par

\\vspace{8pt}
${cv.headline ? `
\\centerline{\\bfseries\\MakeUppercase{${escTex(cv.headline)}}}

\\vspace{7pt}
` : ''}${renderSections(s, sections)}
\\end{document}
`;
  }
};

// ----- Template 5: Compact (left-aligned header) -----

const compact = {
  id: 'compact',
  label: 'Compact (left-aligned)',
  defaultStyle: { fontFamily: 'template', fontSize: 11, headerAlign: 'left', accentColor: '#000000', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: ['summary', 'experience', 'projects', 'education', 'skills', 'certifications'] },

  css(s) {
    return `${SHARED_CSS}
  @page { size: A4; margin: 0.5in 0.55in; }
  body { font-family: 'Latin Modern Roman', 'CMU Serif', Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.3; }
  .page { padding: 0.5in 0.55in; max-width: 8.27in; margin: 0 auto; }
  .cv-header { text-align: left; }
  h1 { font-size: 22pt; font-weight: 700; line-height: 1.15; }
  .cv-contact { margin-top: 3px; }
  .cv-contact span { margin: 0 4px; }
  h2 { font-size: 11pt; text-transform: uppercase; border-bottom: 0.6pt solid #000; padding-bottom: 2px; }
  .entry { margin-top: 7px; break-inside: avoid; }
  .entry:first-of-type { margin-top: 0; }
  .entry .row:first-child { font-weight: 700; }
  ul { padding-left: 1.6em; margin-top: 2px; } li { margin: 1px 0; }
  ${styleCss(s, this.defaultStyle, { lineHeight: 1.3, h2Top: 12, h2Bottom: 5 })}`;
  },

  html(cv, terms, s) {
    const hl = (x) => markup(x, terms, escHtml, (m) => `<mark>${m}</mark>`);
    const contact = [cv.email, cv.phone, cv.location, cv.linkedin && linkedinShort(cv.linkedin), cv.github && linkedinShort(cv.github)].filter(Boolean).map(escHtml);
    const sections = {
      summary: () => (cv.summary ? `<section><h2>Summary</h2><p>${hl(cv.summary)}</p></section>` : ''),
      experience: () => (cv.experience.length ? `<section><h2>Experience</h2>${cv.experience.map(x => `
  <div class="entry"><div class="row"><span>${escHtml(x.company)}</span><span class="r">${escHtml(x.period)}</span></div>
  <div class="row"><span>${escHtml(x.role)}</span><span class="r">${escHtml(shortPlace(x.location))}</span></div>
  <ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      projects: () => (cv.projects.length ? `<section><h2>Projects</h2>${cv.projects.map(pr => `
  <div class="entry"><div class="row"><span>${escHtml(pr.name)}</span><span class="r" style="font-weight:400">${escHtml(pr.tech.join(', '))}</span></div>
  <ul>${projectBullets(pr).map(b => `<li>${hl(b)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''),
      education: () => (cv.education.length ? `<section><h2>Education</h2>${cv.education.map(e => `
  <div class="entry"><div class="row"><span>${escHtml(e.school)}</span><span class="r">${escHtml(e.period)}</span></div>
  <div class="row"><span>${escHtml(e.degree)}</span><span class="r"></span></div></div>`).join('')}</section>` : ''),
      skills: () => (cv.skills.length ? `<section><h2>Skills</h2><ul>${cv.skills.map(g => `<li><strong>${escHtml(g.group)}:</strong> ${g.items.map(skillHtml).join(', ')}</li>`).join('')}</ul></section>` : ''),
      certifications: () => (cv.certifications.length ? `<section><h2>Certifications</h2><ul>${cv.certifications.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></section>` : '')
    };
    return `
<header class="cv-header"><h1>${escHtml(cv.name)}</h1><p class="cv-contact">${contact.join('<span>|</span>')}</p></header>
${renderSections(s, sections)}`;
  },

  latex(cv, title, company, s) {
    const contact = [cv.email && `\\href{mailto:${cv.email}}{${escTex(cv.email)}}`, cv.phone && escTex(cv.phone), cv.location && escTex(cv.location),
      cv.linkedin && texLink(cv.linkedin), cv.github && texLink(cv.github)].filter(Boolean).join(' \\textbar{} ');
    const sections = {
      summary: () => (cv.summary ? `
\\cvsection{Summary}

\\noindent ${escTex(cv.summary)}\\par
` : ''),
      experience: () => (cv.experience.length ? `
\\cvsection{Experience}
${cv.experience.map(x => `
\\cventry
{${escTex(x.company)}}
{${texPeriod(x.period)}}
{${escTex(x.role)}}
{${escTex(shortPlace(x.location))}}

\\begin{cvbullets}
${x.bullets.map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{cvbullets}`).join('\n\n\\entrygap\n')}
` : ''),
      projects: () => (cv.projects.length ? `
\\cvsection{Projects}
${cv.projects.map(pr => `
\\cvproject
{${escTex(pr.name)}}
{${escTex(pr.tech.join(', '))}}

\\begin{cvbullets}
${projectBullets(pr).map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{cvbullets}`).join('\n\n\\entrygap\n')}
` : ''),
      education: () => (cv.education.length ? `
\\cvsection{Education}
${cv.education.map(e => `
\\cventry
{${escTex(e.school)}}
{${texPeriod(e.period)}}
{${escTex(e.degree)}}
{}`).join('\n\n\\entrygap\n')}
` : ''),
      skills: () => (cv.skills.length ? `
\\cvsection{Skills}

\\begin{cvbullets}
${cv.skills.map(g => `  \\item \\textbf{${escTex(g.group)}:} ${escTex(skillLine(g))}`).join('\n')}
\\end{cvbullets}
` : ''),
      certifications: () => (cv.certifications.length ? `
\\cvsection{Certifications}

\\begin{cvbullets}
${cv.certifications.map(c => `  \\item ${escTex(c)}`).join('\n')}
\\end{cvbullets}
` : '')
    };
    return `${texHeader(cv, title, company)}\\documentclass[${s.fontSize}pt,a4paper]{article}

\\usepackage[
  a4paper,
  top=0.5in,
  bottom=0.5in,
  left=0.55in,
  right=0.55in
]{geometry}

\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}${s.fontPreamble ? `\n${s.fontPreamble}` : ''}
\\usepackage{microtype}
\\usepackage{enumitem}
\\usepackage{tabularx}
\\usepackage{array}
\\usepackage[hidelinks]{hyperref}${accentPreamble(s, true)}${s.linespread}

\\IfFileExists{needspace.sty}{%
  \\usepackage{needspace}%
}{%
  \\newcommand{\\Needspace}[1]{}%
}

\\pdfgentounicode=1

\\pagestyle{empty}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\setlength{\\tabcolsep}{0pt}

\\urlstyle{same}
\\raggedbottom
\\raggedright

\\newcommand{\\cvsection}[1]{%
  \\vspace{${s.gap(10)}pt}%
  \\Needspace{4\\baselineskip}%
  \\noindent${withAccent(s, s.heading('\\MakeUppercase{#1}'))}\\par
  \\vspace{2pt}%
  ${s.accentChanged ? '{\\color{accent}\\hrule height 0.6pt}' : '\\hrule height 0.6pt'}
  \\vspace{${s.gap(5)}pt}%
}

\\newcommand{\\cvhead}[2]{%
  \\Needspace{3\\baselineskip}%
  \\noindent
  \\begin{tabularx}{\\textwidth}{@{}X@{\\hspace{12pt}}r@{}}
    \\textbf{#1} & \\textbf{#2}
  \\end{tabularx}\\par
  \\vspace{1pt}%
}

\\newcommand{\\cventry}[4]{%
  \\Needspace{3\\baselineskip}%
  \\noindent
  \\begin{tabularx}{\\textwidth}{@{}X@{\\hspace{12pt}}r@{}}
    \\textbf{#1} & \\textbf{#2} \\\\
    #3 & #4
  \\end{tabularx}\\par
  \\vspace{1pt}%
}

\\newcommand{\\cvproject}[2]{%
  \\Needspace{3\\baselineskip}%
  \\noindent
  \\begin{tabularx}{\\textwidth}{@{}X@{\\hspace{12pt}}r@{}}
    \\textbf{#1} & #2
  \\end{tabularx}\\par
  \\vspace{1pt}%
}

\\newenvironment{cvbullets}{%
  \\begin{itemize}[
    leftmargin=1.6em,
    label=\\textbullet,
    before=\\vspace{-4pt},
    itemsep=1pt,
    topsep=2pt,
    parsep=0pt,
    partopsep=0pt
  ]
}{%
  \\end{itemize}%
}

\\newcommand{\\entrygap}{\\vspace{7pt}}

\\begin{document}

${s.alignBlock(`\\noindent{\\fontsize{22}{26}\\selectfont\\bfseries ${escTex(cv.name)}}\\par

\\vspace{3pt}

\\noindent ${contact}\\par`)}

\\vspace{2pt}
${renderSections(s, sections)}
\\end{document}
`;
  }
};

// ----- Template 6: Navy Accent -----

const navy = {
  id: 'navy',
  label: 'Navy Accent',
  defaultStyle: { fontFamily: 'template', fontSize: 10, headerAlign: 'center', accentColor: '#1F4E79', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'] },

  css(s) {
    return `${SHARED_CSS}
  @page { size: A4; margin: 0.5in 0.6in; }
  body { font-family: 'Latin Modern Sans', 'CMU Sans Serif', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; line-height: 1.32; color: #222; }
  .page { padding: 0.5in 0.6in; max-width: 8.27in; margin: 0 auto; }
  .cv-header { text-align: center; }
  h1 { font-size: 22pt; font-weight: 700; text-transform: uppercase; color: ${s.accentColor}; line-height: 1.15; }
  .cv-titles { font-size: 9pt; margin-top: 4px; }
  .cv-contact { font-size: 8pt; margin-top: 3px; color: #265694; }
  .cv-contact span { margin: 0 6px; color: #222; }
  h2 { font-size: 10pt; text-transform: uppercase; color: ${s.accentColor}; border-top: 1pt solid ${s.accentColor}; border-bottom: 0.4pt solid ${s.accentColor}; padding: 3px 0 2.5px; }
  .justify { text-align: justify; }
  .entry { margin-top: 3px; break-inside: avoid; }
  .entry .row .r { font-style: italic; font-size: 9pt; }
  .note { font-style: italic; font-size: 9pt; margin-top: 1.5px; }
  ul { padding-left: 1.35em; margin-top: 2px; } li { margin: 1.5px 0; }
  ${styleCss(s, this.defaultStyle, { lineHeight: 1.32, h2Top: 10, h2Bottom: 5, accent: '.never' })}`;
  },

  html(cv, terms, s) {
    const hl = (x) => markup(x, terms, escHtml, (m) => `<mark>${m}</mark>`);
    const line1 = [cv.phone, cv.email, cv.location].filter(Boolean).map(escHtml);
    const line2 = [cv.linkedin && linkedinShort(cv.linkedin), cv.github && linkedinShort(cv.github)].filter(Boolean).map(escHtml);
    const sections = {
      summary: () => (cv.summary ? `<section><h2>Professional Summary</h2><p class="justify">${hl(cv.summary)}</p></section>` : ''),
      skills: () => (cv.skills.length ? `<section><h2>Core Competencies</h2><ul>${cv.skills.map(g => `<li><strong>${escHtml(g.group)}:</strong> ${g.items.map(skillHtml).join(', ')}</li>`).join('')}</ul></section>` : ''),
      experience: () => (cv.experience.length ? `<section><h2>Professional Experience</h2>${cv.experience.map(x => `
  <div class="entry"><div class="row"><span><strong>${escHtml(x.role)}</strong> | ${escHtml(x.company)}</span><span class="r">${escHtml(x.period)}</span></div>
  <ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul>${x.location ? `<p class="note">${escHtml(x.location)}</p>` : ''}</div>`).join('')}</section>` : ''),
      projects: () => (cv.projects.length ? `<section><h2>Independent Projects</h2>${cv.projects.map(pr => `
  <div class="entry"><div class="row"><strong>${escHtml(pr.name)}</strong><span class="r"></span></div>
  <ul>${projectBullets(pr).map(b => `<li>${hl(b)}</li>`).join('')}</ul>${pr.tech.length ? `<p style="font-size:9pt"><strong>Technologies:</strong> ${escHtml(pr.tech.join(', '))}</p>` : ''}</div>`).join('')}</section>` : ''),
      education: () => (cv.education.length ? `<section><h2>Education</h2>${cv.education.map(e => `
  <div class="entry"><div class="row"><strong>${escHtml(e.degree)}</strong><span class="r">${escHtml(e.period)}</span></div><p>${escHtml(e.school)}</p></div>`).join('')}</section>` : ''),
      certifications: () => (cv.certifications.length ? `<section><h2>Certifications</h2>${cv.certifications.map(c => `<div class="row"><span>${escHtml(c)}</span><span class="r"></span></div>`).join('')}</section>` : '')
    };
    return `
<header class="cv-header"><h1>${escHtml(cv.name)}</h1>
  ${titlesLine(cv).length ? `<p class="cv-titles">${titlesLine(cv).map(escHtml).join(' • ')}</p>` : ''}
  <p class="cv-contact">${line1.join('<span>|</span>')}</p>${line2.length ? `<p class="cv-contact">${line2.join('<span>|</span>')}</p>` : ''}</header>
${renderSections(s, sections)}`;
  },

  latex(cv, title, company, s) {
    const line1 = [cv.phone && escTex(cv.phone), cv.email && `\\href{mailto:${cv.email}}{${escTex(cv.email)}}`, cv.location && escTex(cv.location)].filter(Boolean).join(' \\ \\textbar\\ \\ ');
    const line2 = [cv.linkedin && texLink(cv.linkedin), cv.github && texLink(cv.github)].filter(Boolean).join(' \\ \\textbar\\ \\ ');
    const titles = titlesLine(cv).map(escTex).join(' \\textbullet\\ ');
    const sections = {
      summary: () => (cv.summary ? `
\\cvsection{Professional Summary}

\\justifying
${escTex(cv.summary)}
\\par
` : ''),
      skills: () => (cv.skills.length ? `
\\cvsection{Core Competencies}

\\begin{itemize}
${cv.skills.map(g => `  \\item \\textbf{${escTex(g.group)}:} ${escTex(skillLine(g))}`).join('\n')}
\\end{itemize}
` : ''),
      experience: () => (cv.experience.length ? `
\\cvsection{Professional Experience}
${cv.experience.map(x => `
\\cventry
{\\textbf{${escTex(x.role)}} \\ \\textbar\\ \\ ${escTex(x.company)}}
{${texPeriod(x.period)}}

\\begin{itemize}
${x.bullets.map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{itemize}${x.location ? `\n\\cvnote{${escTex(x.location)}}` : ''}

\\vspace{3pt}`).join('\n')}
` : ''),
      projects: () => (cv.projects.length ? `
\\cvsection{Independent Projects}
${cv.projects.map(pr => `
\\cventry
{\\textbf{${escTex(pr.name)}}}
{}

\\begin{itemize}
${projectBullets(pr).map(b => `  \\item ${escTex(b)}`).join('\n')}
\\end{itemize}${pr.tech.length ? `
{\\small
\\textbf{Technologies:}
{\\normalfont ${escTex(pr.tech.join(', '))}}
}\\par` : ''}

\\vspace{3pt}`).join('\n')}
` : ''),
      education: () => (cv.education.length ? `
\\cvsection{Education}
${cv.education.map(e => `
\\cventry
{\\textbf{${escTex(e.degree)}}}
{${texPeriod(e.period)}}

${escTex(e.school)}\\par

\\vspace{3pt}`).join('\n')}
` : ''),
      certifications: () => (cv.certifications.length ? `
\\cvsection{Certifications}
${cv.certifications.map(c => `
\\cventry
{${escTex(c)}}
{}`).join('\n')}
` : '')
    };
    return `${texHeader(cv, title, company)}\\documentclass[${s.fontSize}pt,a4paper]{article}

\\usepackage[
  top=0.5in,
  bottom=0.5in,
  left=0.6in,
  right=0.6in
]{geometry}

\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}

\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage{tabularx}
\\usepackage{ragged2e}${s.linespread}

\\definecolor{navyheading}{HTML}{${s.accentHex}}
\\definecolor{navyrule}{HTML}{${s.accentHex}}
\\definecolor{linkblue}{RGB}{38,86,148}
\\definecolor{bodytext}{RGB}{34,34,34}

\\usepackage[
  colorlinks=true,
  urlcolor=linkblue,
  linkcolor=linkblue,
  citecolor=linkblue
]{hyperref}

\\pagestyle{empty}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\setlength{\\tabcolsep}{0pt}

\\renewcommand{\\familydefault}{\\sfdefault}${s.fontPreamble ? `\n${s.fontPreamble}` : ''}

\\color{bodytext}

\\newcommand{\\cvsection}[1]{%
  \\par\\vspace{${s.gap(8)}pt}%
  \\noindent{\\color{navyrule}\\rule{\\textwidth}{1pt}}\\par
  \\vspace{3pt}%
  \\noindent{\\normalsize${s.headingStyle}\\color{navyheading}\\MakeUppercase{#1}}\\par
  \\vspace{2.5pt}%
  \\noindent{\\color{navyrule}\\rule{\\textwidth}{0.4pt}}\\par
  \\vspace{${s.gap(5)}pt}%
}

\\newcommand{\\cventry}[2]{%
  \\noindent
  \\begin{tabularx}{\\textwidth}{@{}X@{\\hspace{8pt}}r@{}}
    #1 & {\\itshape\\small #2}
  \\end{tabularx}\\par
  \\vspace{1.5pt}%
}

\\newcommand{\\cvnote}[1]{%
  \\noindent{\\itshape\\small #1}\\par
  \\vspace{1.5pt}%
}

\\setlist[itemize]{
  leftmargin=1.35em,
  label=\\textbullet,
  itemsep=1.5pt,
  topsep=1.5pt,
  parsep=0pt,
  partopsep=0pt
}

\\begin{document}

\\begin{${s.alignEnv}}

{\\fontsize{22}{26}\\selectfont\\bfseries\\color{navyheading}
\\MakeUppercase{${escTex(cv.name)}}}
${titles ? `
\\vspace{4pt}

{\\small ${titles}}
` : ''}
\\vspace{4pt}

{\\footnotesize ${line1}}
${line2 ? `
\\vspace{2pt}

{\\footnotesize ${line2}}
` : ''}
\\end{${s.alignEnv}}
${renderSections(s, sections)}
\\end{document}
`;
  }
};

// Available CV layouts (the six supplied LaTeX templates)
export const CV_TEMPLATES = Object.fromEntries([atsClassic, modernSerif, traditional, executive, compact, navy].map(t => [t.id, t]));
export const DEFAULT_TEMPLATE = atsClassic.id;

/** Each layout's own style, for the toolbar's "untouched" state. */
export const LAYOUT_DEFAULTS = Object.fromEntries(Object.values(CV_TEMPLATES).map(t => [t.id, t.defaultStyle]));

/** One layout rendered with the given style: { label, html, css, latex, style }. */
export function renderLayout(id, cv, terms, title, company, style) {
  const t = CV_TEMPLATES[id] || CV_TEMPLATES[DEFAULT_TEMPLATE];
  const s = resolveStyle(style, t.defaultStyle);
  return { label: t.label, html: t.html(cv, terms, s), css: t.css(s), latex: t.latex(cv, title, company, s), defaults: t.defaultStyle };
}

// Write the tailored LaTeX next to the master CV (cv/main_*.tex is gitignored).
export function saveTailoredCV(result, rootDir) {
  const dir = path.join(rootDir, 'cv');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(result.filename));
  fs.writeFileSync(file, result.latex);
  return path.relative(rootDir, file);
}
