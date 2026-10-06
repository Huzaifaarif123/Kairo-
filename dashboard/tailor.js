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
    ['pandas', 'pandas'], ['NumPy', 'numpy'], ['Query optimization', 'query optimization', 'indexing', 'schema design']
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
    ['TensorFlow', 'tensorflow'], ['JAX', 'jax'], ['Keras', 'keras'], ['scikit-learn', 'scikit-learn', 'sklearn'],
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
  // PDF bullet glyphs can arrive as invisible control characters (e.g. U+0088)
  const md = stripComments(String(rawMd || '').replace(/[\u0080-\u009F\u200B\uFEFF]/g, ''));
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
  'MLOps': ['mlflow', 'kubeflow', 'sagemaker', 'vertex ai', 'model registry', 'model lifecycle', 'model monitoring', 'weights & biases', 'dvc'],
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
  .replace(/~/g, '$\\sim$')
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
  // "reducing average prediction latency from 850ms to 320ms"
  const fromTo = text.match(/\b(reduc\w*|cut\w*|lower\w*|improv\w*|increas\w*|rais\w*|grow\w*|boost\w*)\s+(?:the\s+|average\s+|overall\s+)*((?:[\w-]+\s+){0,3}?[\w-]+)\s+from\s+(\S+)\s+to\s+(?:under\s+)?([\d$£€][^\s,.;]*)/i);
  if (fromTo) return `${/^(improv|increas|rais|grow|boost)/i.test(fromTo[1]) ? 'an improvement' : 'a reduction'} in ${fromTo[2].trim()} from ${fromTo[3]} to ${fromTo[4]}`;
  // "processing 20M+ records", "supporting 50K+ monthly requests"
  const volume = text.match(/\b(?:processing|handling|serving|supporting|transforming)\s+(\d[\d.,]*\s?[kmb]?\+?)\s+((?:daily|monthly|weekly)\s+)?(records|requests|events|transactions|users|rows|messages)\b/i);
  if (volume) {
    const what = /\bpipelines?\b/i.test(text) ? 'pipelines' : /\bapis?\b|\bendpoints?\b/i.test(text) ? 'APIs' : /\bplatforms?\b/i.test(text) ? 'a platform' : 'systems';
    const verb = /\b(?:processing|transforming)\b/i.test(text) ? 'processing' : 'handling';
    return `${what} ${verb} ${volume[1]} ${volume[2] || ''}${volume[3]}`;
  }
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

// The role itself for the headline: "Full Stack Engineer - AI Products" -> "Full Stack
// Engineer" (the part after the dash names the team or product, not the job)
function roleTitle(title) {
  const clean = cleanJobTitle(title);
  const [core, ...rest] = clean.split(/\s+[-–—|]\s+|,\s+/);
  const suffix = rest.join(' ');
  return core && rest.length && core.trim().split(/\s+/).length >= 2
    && /\b(products?|team|squad|group|org|organi[sz]ation|division|department|unit|studio|labs?|platform team|payments|growth|marketplace)\b|^(at|for)\s/i.test(suffix)
    ? core.trim() : clean;
}

// Summary sentence 2: the candidate's skills for this posting, grouped by where they're
// used ("React and Next.js on the frontend, Python and Django on the backend, …")
const STACK_LAYERS = [
  ['', ['Languages']],
  ['on the frontend', ['Frontend']],
  ['on the backend', ['Backend and APIs']],
  ['for data', ['Databases', 'Data Engineering']],
  ['for machine learning', ['Machine Learning', 'MLOps and Evaluation', 'LLM Training and Fine Tuning']],
  ['for AI features', ['Generative AI and LLMs', 'AI Agents and Orchestration', 'RAG and Retrieval', 'Inference and Model Serving']],
  ['for cloud delivery', ['Cloud and Infrastructure']],
  ['for observability', ['Monitoring and Observability']],
  ['for testing', ['Testing']],
  ['for design', ['Design']]
];
// Words that name a whole area, not a skill ("machine learning ... for machine learning")
const AREA_NAMES = /^(machine learning|ai|mlops|data engineering|frontend|backend)$/i;
function stackSentence(names, inSentence) {
  const layers = STACK_LAYERS.map(([where]) => ({ where, items: [] }));
  for (const name of names) {
    const cat = categoryOf(name);
    if (!cat || cat === 'Other Tools' || AREA_NAMES.test(name)) continue;
    const i = STACK_LAYERS.findIndex(([, cats]) => cats.includes(cat));
    if (i >= 0 && layers[i].items.length < 4) layers[i].items.push(inSentence(name));
  }
  // Languages lead ("in Python and SQL, with …"); then each area with where it's used
  const [langs, ...rest] = layers;
  const used = rest.filter(l => l.items.length).slice(0, 5);
  if (used.length + (langs.items.length ? 1 : 0) < 2) return '';
  const parts = used.map(l => `${joinList(l.items)} ${l.where}`);
  // Lists inside lists: two groups join with ", and"; more use semicolons
  const areas = parts.length === 1 ? parts[0] : parts.length === 2 ? parts.join(', and ') : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`;
  return langs.items.length ? `Strong expertise in ${joinList(langs.items)}, with ${areas}.` : `Strong expertise across ${areas}.`;
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
const LOWERCASE_BRANDS = new Set(['pgvector', 'dbt', 'npm', 'pnpm', 'yarn', 'vllm', 'grpc', 'ios', 'macos', 'k8s', 'jq', 'tRPC'.toLowerCase(), 'webpack', 'vite', 'scikit-learn', 'pandas']);
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
// Every job shows the same number of points, so the CV reads balanced: five each, or
// six each when there are only one or two jobs
const MIN_POINTS = 5;
const pointsPerJob = (jobs) => (jobs <= 2 ? 6 : MIN_POINTS);

// One point that holds two ("Built X…, and reduced Y by 40%"; "… . Led …"; "…, while
// maintaining Z") as separate points, using only its own words. One part when it can't.
export function splitPoint(text) {
  const t = String(text || '').trim();
  const done = (x) => { const y = x.trim().replace(/^[,;\s]+|[,;\s]+$/g, ''); return y ? `${y[0].toUpperCase()}${y.slice(1).replace(/[.]?$/, '.')}` : ''; };
  const enough = (x) => x.trim().split(/\s+/).length >= 4;
  const isPast = (w) => PAST_VERBS.has(w) || (/^[a-z]{3,}ed$/.test(w) && !/eed$/.test(w));
  // two sentences
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z])/);
  if (sentences.length > 1 && sentences.every(enough)) return sentences.map(done);
  // "; " between two things done
  let m = t.match(/^(.+?);\s+(.+)$/);
  if (m && enough(m[1]) && enough(m[2]) && isPast((m[2].match(/^[A-Za-z]+/) || [''])[0].toLowerCase())) return [done(m[1]), done(m[2])];
  // ", and reduced …" / " and led …"
  m = t.match(/^(.+?),?\s+and\s+([a-z]+)\b(.*)$/);
  if (m && isPast(m[2]) && enough(m[1]) && enough(`${m[2]}${m[3]}`)) return [done(m[1]), done(`${m[2]}${m[3]}`)];
  // ", while maintaining …" -> "Maintained …"
  m = t.match(/^(.+?),?\s+while\s+([a-z]+ing)\b(.*)$/);
  if (m && GERUND_PAST[m[2]] && enough(m[1]) && enough(`${m[2]}${m[3]}`)) return [done(m[1]), done(`${GERUND_PAST[m[2]]}${m[3]}`)];
  return [t];
}

// Standard points for a job that has fewer than five: the typical work of that kind of
// role, naming only tools from the job's own points (or the CV's skills), with no
// numbers. Each has a theme, so a job that already covers it doesn't get it twice.
const STANDARD_POINTS = {
  frontend: [
    [/component|ui\b|interface|responsive|accessib|dashboard|page|screen/i, (t) => `Built responsive, accessible UI components${t ? ` with ${t}` : ''} from design specs.`, ['Frontend']],
    [/test/i, (t) => `Wrote unit and integration tests for new features${t ? ` with ${t}` : ''} to keep releases stable.`, ['Testing']],
    [/review|pull request/i, () => 'Reviewed pull requests and shared feedback to keep code quality consistent.'],
    [/product|design(er)?s?\b|stakeholder|collaborat/i, () => 'Partnered with product and design to turn requirements into shipped features.'],
    [/bug|issue|performance|optimi/i, () => 'Fixed production bugs and improved page performance in existing features.'],
    [/document/i, () => 'Documented components and setup steps so new developers could onboard faster.']
  ],
  backend: [
    [/api|service|endpoint/i, (t) => `Designed and maintained ${t ? `${t} ` : ''}services and APIs used by internal and customer-facing apps.`, ['Backend and APIs']],
    [/test/i, () => 'Wrote unit and integration tests for services to keep releases stable.'],
    [/database|quer|schema|migration|sql|postgres|mysql|mongo/i, (t) => `Wrote database queries and migrations${t ? ` for ${t}` : ''} as features grew.`, ['Databases']],
    [/review|pull request/i, () => 'Reviewed pull requests and shared feedback to keep code quality consistent.'],
    [/bug|issue|incident|troubleshoot|production/i, () => 'Investigated and fixed production issues, and added logging to catch them earlier.'],
    [/document/i, () => 'Documented APIs and setup steps so other teams could integrate faster.']
  ],
  fullstack: [
    [/frontend|backend|feature|end-to-end|full stack|dashboard|api|flows?\b|app\b|site/i, (t) => `Built and maintained features across the frontend and backend${t ? ` with ${t}` : ''}.`, ['Frontend', 'Backend and APIs']],
    [/test/i, () => 'Wrote unit and integration tests for new features to keep releases stable.'],
    [/review|pull request/i, () => 'Reviewed pull requests and shared feedback to keep code quality consistent.'],
    [/product|design(er)?s?\b|stakeholder|collaborat/i, () => 'Partnered with product and design to turn requirements into shipped features.'],
    [/bug|issue|performance|optimi/i, () => 'Fixed production bugs and improved performance in existing features.'],
    [/document/i, () => 'Documented APIs and setup steps so new developers could onboard faster.']
  ],
  data: [
    [/dataset|data prep|clean|validat|feature/i, (t) => `Prepared and validated datasets${t ? ` with ${t}` : ''} for analysis and model training.`, ['Data Engineering', 'Machine Learning']],
    [/monitor|drift|retrain/i, () => 'Monitored model and pipeline performance in production and fixed issues as they appeared.'],
    [/experiment|evaluat|benchmark/i, () => 'Documented experiments and results to support model and design decisions.'],
    [/deploy|production|engineer/i, () => 'Partnered with engineering teams to take models and pipelines into production.'],
    [/review|pull request/i, () => 'Reviewed code and analyses to keep results reproducible and correct.'],
    [/stakeholder|business|product|collaborat/i, () => 'Explained findings to product and business stakeholders to guide decisions.']
  ],
  devops: [
    [/ci\/cd|pipeline|deploy|release/i, (t) => `Maintained CI/CD pipelines and deployment scripts${t ? ` with ${t}` : ''}.`, ['Cloud and Infrastructure']],
    [/monitor|alert|incident|on-call/i, () => 'Monitored services and responded to incidents to keep systems available.'],
    [/infrastructure|terraform|iac|provision/i, () => 'Managed cloud infrastructure as code for repeatable environments.'],
    [/security|access|permission/i, () => 'Applied security updates and access controls across environments.'],
    [/document|runbook/i, () => 'Wrote runbooks and documentation so the team could handle incidents faster.'],
    [/developer|team|collaborat/i, () => 'Supported development teams with build, release and environment issues.']
  ],
  general: [
    [/collaborat|team|stakeholder|product/i, () => 'Partnered with cross-functional teams to deliver features on schedule.'],
    [/test/i, () => 'Wrote tests for new work to keep releases stable.'],
    [/review|pull request/i, () => 'Took part in code reviews to keep quality consistent.'],
    [/bug|issue|troubleshoot/i, () => 'Investigated and resolved production issues.'],
    [/document/i, () => 'Wrote clear documentation for features and processes.'],
    [/agile|sprint|plan/i, () => 'Took part in sprint planning and estimation.']
  ]
};

// The kind of job its title names, or '' for a generic title ("Software Engineer")
function roleFamily(role) {
  const r = String(role || '').toLowerCase();
  if (/full[\s-]?stack/.test(r)) return 'fullstack';
  if (/front[\s-]?end|\bui\b|web developer|react|angular|vue/.test(r)) return 'frontend';
  if (/back[\s-]?end|\bapi\b|server/.test(r)) return 'backend';
  if (/data|machine learning|\bml\b|\bai\b|scientist|analyst|analytics/.test(r)) return 'data';
  if (/devops|\bsre\b|site reliability|cloud|infrastructure/.test(r)) return 'devops';
  return '';
}

/** Standard points to bring a job up to five (see STANDARD_POINTS). */
function standardPoints(job, cvSkills, needed) {
  if (needed <= 0) return [];
  const own = job.bullets.join(' ');
  const toolsHere = TERMS.filter(t => t.category !== 'Ways of Working' && t.name !== 'AI' && countMatches(t.re, own) > 0).map(t => t.name);
  // tools of the right kind, and only ones this job's own points mention
  const toolsFor = (kinds) => (kinds && kinds.length ? joinList(toolsHere.filter(n => kinds.includes(categoryOf(n))).slice(0, 2)) : '');
  // the kind of job from what its points show (mostly UI work = frontend), else its title
  const kinds = toolsHere.map(n => categoryOf(n));
  const count = (...c) => kinds.filter(k => c.includes(k)).length;
  const fe = count('Frontend'), be = count('Backend and APIs', 'Databases'), da = count('Data Engineering', 'Machine Learning', 'MLOps and Evaluation'), ops = count('Cloud and Infrastructure', 'Monitoring and Observability');
  // (CI/CD and cloud tools count only when nothing else does: nearly every engineer uses them)
  const top = Math.max(fe, be, da);
  const family = roleFamily(job.role)
    || (top ? (fe && be ? 'fullstack' : top === fe ? 'frontend' : top === da ? 'data' : 'backend')
      : ops ? 'devops' : 'general');
  const out = [];
  for (const [theme, make, kindsFor] of STANDARD_POINTS[family]) {
    if (out.length >= needed) break;
    if (theme.test(own)) continue;
    out.push(make(toolsFor(kindsFor)));
  }
  return out;
}

// A job's points made up to five by splitting the ones that hold two; never invented
function atLeastFive(bullets, target = MIN_POINTS) {
  let list = [...bullets];
  for (let guard = 0; list.length < target && guard < 10; guard++) {
    const order = list.map((b, i) => ({ b, i, n: b.split(/\s+/).length })).sort((a, b) => b.n - a.n);
    const hit = order.find(o => splitPoint(o.b).length > 1);
    if (!hit) break;
    list = [...list.slice(0, hit.i), ...splitPoint(hit.b), ...list.slice(hit.i + 1)];
  }
  return list;
}
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

  // The posting's requirements a piece of text demonstrates (by name or by a tool that proves it)
  const requiredTerms = terms.filter(t => t.required && !t.soft);
  const demonstrates = (text) => requiredTerms.filter(t => countMatches(t.re, text) > 0
    || (IMPLIED_RE[t.name] || []).some(e => countMatches(e.re, text) > 0)).map(t => t.name);
  // Requirements already shown by bullets picked for more recent roles
  const shownInWork = new Set();

  // Experience: rank bullets by how many job requirements they evidence
  let dropped = 0, reordered = 0, split = 0;
  const experience = profile.experience.map((sourceJob, i) => {
    // fewer than five points: the ones that hold two become two
    const job = sourceJob.bullets.length < pointsPerJob(profile.experience.length) ? { ...sourceJob, bullets: atLeastFive(sourceJob.bullets, pointsPerJob(profile.experience.length)) } : sourceJob;
    split += job.bullets.length - sourceJob.bullets.length;
    // A recruiter reads results before duties: a relevant bullet with a measured result
    // (Google's XYZ) ranks above an equally relevant one without, and duty-style
    // openers rank lower. Relevance still decides which bullets count as relevant.
    const scored = job.bullets.map((text, idx) => {
      const score = relevance(text);
      const c = bulletChecks(text);
      const rank = (score > 0 ? score + (c.y ? Math.max(2, score * 0.35) : 0) : (c.y ? 1 : 0)) + (c.z ? 0.5 : 0) - (c.x ? 0 : 2);
      return { text, idx, score, rank, measured: c.y };
    });
    // Relevant bullets first, then by rank
    const ranked = [...scored].sort((a, b) => Number(b.score > 0) - Number(a.score > 0) || b.rank - a.rank || b.score - a.score || a.idx - b.idx);
    const limit = pointsPerJob(profile.experience.length);
    const min = limit;
    // Tailoring, not keyword stacking: the role's bullets are picked so that together they
    // answer as much of the posting as possible. Each next bullet is the one that shows
    // the most requirements not yet shown (in this CV, then in this role), plus its rank.
    const pool = ranked.filter(b => b.score > 0).map(b => ({ ...b, covers: demonstrates(b.text) }));
    const relevant = [];
    const inRole = new Set();
    while (pool.length) {
      const gain = (b) => b.rank + 3 * b.covers.filter(n => !shownInWork.has(n) && !inRole.has(n)).length + b.covers.filter(n => !inRole.has(n)).length;
      pool.sort((a, b) => gain(b) - gain(a) || a.idx - b.idx);
      const next = pool.shift();
      next.covers.forEach(n => inRole.add(n));
      relevant.push(scored.find(b => b.idx === next.idx));
    }
    let kept = (relevant.length >= min ? relevant : ranked).slice(0, Math.max(min, Math.min(limit, relevant.length)));
    // Spare room: up to two more measured results, even when they name other tools
    // ("achieving 90% test coverage"), after the relevant bullets
    const extra = ranked.filter(b => b.score === 0 && b.measured && !kept.includes(b)).slice(0, Math.max(0, Math.min(2, limit - kept.length)));
    kept = [...kept, ...extra];
    kept.forEach(b => demonstrates(b.text).forEach(n => shownInWork.add(n)));
    dropped += Math.max(0, job.bullets.length - kept.length);
    if (kept.some((b, n) => b.idx !== n)) reordered++;
    return { ...job, bullets: kept };
  });
  if (reordered) changes.push(`Reordered bullets in ${reordered} role${reordered > 1 ? 's' : ''} so the most relevant achievements come first`);
  if (dropped) changes.push(`Trimmed ${dropped} less relevant bullet${dropped > 1 ? 's' : ''} to keep the CV focused`);
  if (split) changes.push(`Split ${split === 1 ? 'a long point' : `${split} long points`} that each held two achievements into separate points`);
  // Jobs still under five: standard points for that kind of role (listed so they can be checked)
  const cvSkills = profile.skills.flatMap(g => g.items).filter(n => TERMS.some(t => t.name.toLowerCase() === String(n).toLowerCase()));
  for (const x of experience) {
    const add = standardPoints({ role: x.role, bullets: x.bullets.map(b => b.text) }, cvSkills, pointsPerJob(experience.length) - x.bullets.length);
    if (!add.length) continue;
    x.bullets.push(...add.map(text => ({ text, idx: -1, score: 0, rank: 0, measured: false })));
    changes.push(`Added ${add.length} standard point${add.length > 1 ? 's' : ''} to ${x.company || x.role} so it has ${x.bullets.length} (typical work for this role; check ${add.length > 1 ? 'they match' : 'it matches'} what you did): ${add.map(a => `"${a}"`).join(' ')}`);
  }

  // Skills: matched items first inside each group, most relevant groups first
  const isMatch = (item) => terms.some(t => countMatches(t.re, item) > 0 || t.name.toLowerCase() === String(item).toLowerCase());
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
  const headline = roleTitle(title) || profile.title || (recent ? recent.role : '');
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
  const stack = stackSentence(focus.slice(0, 10).map(t => t.name), inSentence);
  if (stack) sentences.push(stack);
  else if (expertise.length) sentences.push(`Strong expertise in ${joinList(expertise)}.`);
  if (stages.length >= 3) sentences.push(`Experienced across the ${lifecycle}, including ${joinList(stages.slice(0, 6))}.`);
  // One sentence from the profile's own summary that speaks to this posting (not written
  // in the first person, not restating years, not too long)
  const own = profile.summary.split(/(?<=[.!?])\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean)
    // mostly about this job: at least half the technologies it names are ones the posting wants
    .map(x => ({ x, score: relevance(x), named: TERMS.filter(t => countMatches(t.re, x) > 0), wanted: terms.filter(t => countMatches(t.re, x) > 0) }))
    // (a real sentence: a bare title like "Machine learning engineer." isn't added)
    .filter(o => o.score > 0 && o.wanted.length * 2 >= o.named.length && words(o.x) >= 8 && words(o.x) <= 45 && !/\b(i|i'm|i am|my|me)\b/i.test(o.x) && !/\d+\+?\s*years/i.test(o.x))
    .sort((a, b) => b.score - a.score)[0];
  if (metrics.length) sentences.push(`Proven impact includes ${joinList(metrics)}.`);
  else if (own) sentences.push(own.x);
  const summary = sentences.join(' ');

  // Every requirement you cover should appear in the posting's own words somewhere in the
  // CV (ATS systems match keywords literally). Only when no bullet, project or summary line
  // shows it is the posting's wording added to your skills.
  const cvWords = [summary, ...skills.flatMap(g => g.items.map(i => i.name)), ...experience.flatMap(x => x.bullets.map(b => b.text)),
    ...profile.projects.map(pr => `${pr.name} ${pr.desc}`)].join('\n');
  const worded = matched.filter(m => m.required && !m.soft && !m.implied && !m.confirmed
    && countMatches(m.re, cvWords) === 0 && addToSkills(m)).map(m => m.name);
  if (worded.length) changes.push(`Listed ${joinList(worded)} in your skills (your profile mentions ${worded.length > 1 ? 'them' : 'it'}, but no bullet does)`);
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

  // Recruiter polish: weak openers ("Responsible for building…") become action verbs and
  // filler words go. Only the wording changes, never the facts or numbers.
  const rewrites = [];
  for (const job of experience) {
    for (const b of job.bullets) {
      const better = polishBullet(b.text);
      if (better !== b.text) { rewrites.push({ before: b.text, after: better }); b.text = better; }
    }
  }
  if (rewrites.length) changes.push(`Rewrote ${rewrites.length} bullet${rewrites.length > 1 ? 's' : ''} to open with an action verb and drop filler words`);

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
    review: reviewCV(cv, { title, description }, profile, matched, missing, rewrites, visibleSections(layoutId, styles)),
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

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\uFEFF]/g;
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
  const found = hasJob ? analyseJob(description, title, profileMd, confirmedSkills) : { matched: [], missing: [] };
  const { matched } = found;
  const isMatch = (item) => matched.some(t => countMatches(t.re, item) > 0 || t.name.toLowerCase() === String(item).toLowerCase());
  const out = { ...clean, skills: clean.skills.map(g => ({ group: g.group, items: g.items.map(i => ({ name: i.name, matched: isMatch(i.name) })) })) };
  const layoutId = CV_TEMPLATES[template] ? template : DEFAULT_TEMPLATE;
  const layout = renderLayout(layoutId, out, matched, title, company, styles && styles[layoutId]);
  return {
    cv: out,
    coverage: hasJob ? cvCoverage(out, matched) : null,
    review: hasJob ? reviewCV(out, { title, description }, parseProfile(profileMd), matched, found.missing, [], visibleSections(layoutId, styles)) : null,
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
  const listed = new Set(cv.skills.flatMap(g => g.items.map(i => String(typeof i === 'string' ? i : i.name).toLowerCase())));
  const shown = needed.filter(t => countMatches(t.re, text) > 0 || listed.has(t.name.toLowerCase()));
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

// ---------- Recruiter review ----------
// Three checks run on every tailored CV:
//   1. a senior recruiter's first read: a match score out of 100, the five most important
//      missing keywords and the three biggest red flags visible in the first 10 seconds
//   2. every experience bullet against Google's XYZ formula (accomplished X, as measured
//      by Y, by doing Z)
//   3. an ATS and a hiring manager skimming 200 CVs: which sections get read, skimmed,
//      skipped or rejected, and what makes each one stronger

// "Responsible for building…" -> "Built…"
const GERUND_PAST = {
  building: 'Built', leading: 'Led', running: 'Ran', writing: 'Wrote', managing: 'Managed', designing: 'Designed',
  developing: 'Developed', creating: 'Created', maintaining: 'Maintained', implementing: 'Implemented', delivering: 'Delivered',
  owning: 'Owned', overseeing: 'Oversaw', coordinating: 'Coordinated', handling: 'Handled', supporting: 'Supported',
  testing: 'Tested', deploying: 'Deployed', migrating: 'Migrated', integrating: 'Integrated', automating: 'Automated',
  optimizing: 'Optimized', optimising: 'Optimised', monitoring: 'Monitored', mentoring: 'Mentored', training: 'Trained',
  analyzing: 'Analyzed', analysing: 'Analysed', researching: 'Researched', planning: 'Planned', defining: 'Defined',
  driving: 'Drove', launching: 'Launched', shipping: 'Shipped', scaling: 'Scaled', architecting: 'Architected',
  establishing: 'Established', improving: 'Improved', reducing: 'Reduced', increasing: 'Increased', reviewing: 'Reviewed',
  documenting: 'Documented', configuring: 'Configured', setting: 'Set', troubleshooting: 'Troubleshot', debugging: 'Debugged',
  executing: 'Executed', producing: 'Produced', preparing: 'Prepared', conducting: 'Conducted', ensuring: 'Ensured',
  providing: 'Provided', hiring: 'Hired', recruiting: 'Recruited', negotiating: 'Negotiated', growing: 'Grew',
  modernizing: 'Modernized', modernising: 'Modernised', refactoring: 'Refactored', rebuilding: 'Rebuilt', engineering: 'Engineered',
  administering: 'Administered', securing: 'Secured', evaluating: 'Evaluated', prototyping: 'Prototyped',
  facilitating: 'Facilitated', streamlining: 'Streamlined', standardizing: 'Standardized', standardising: 'Standardised'
};
const PAST_VERBS = new Set([...Object.values(GERUND_PAST).map(v => v.toLowerCase()),
  'took', 'made', 'cut', 'won', 'set', 'put', 'got', 'gave', 'kept', 'held', 'sold', 'taught', 'found', 'rewrote', 'undertook',
  'stood', 'spun', 'split', 'shut', 'sped', 'bought', 'brought', 'began', 'became', 'chose', 'saw', 'drew', 'flew', 'fought',
  'built', 'led', 'ran', 'wrote', 'drove', 'grew', 'oversaw', 'rebuilt', 'spent', 'sent', 'met', 'beat', 'overcame', 'hired', 'used', 'fixed', 'won']);
// Bullet symbols and invisible characters a pasted or uploaded CV can start a line with
const LEAD_SYMBOLS = /^[\p{Cc}\p{Cf}\p{Co}\p{So}•●▪■◦‣∙·*\-–—>\s]+/u;
// "make" is deliberately left out: "make it sound more senior", "make this better" are
// far more common than a genuine present-tense bullet starting "Makes …", and including
// it made hasAction() misread instructions like that as a real achievement to paste in.
const PRESENT_VERBS = new Set(['cut', 'set', 'own', 'win', 'take', 'drive', 'grow', 'oversee', 'spearhead', 'architect', 'partner', 'advise', 'teach', 'coach']);
// Openers that describe duties rather than results
const WEAK_OPENERS = /^(?:(?:was|were)\s+)?(?:responsible for|tasked with|in charge of|worked (?:on|with|in)|helped|assisted|involved in|participated in|duties included|contributed to)\b/i;

/** A bullet with a stronger opening and without filler. Facts and numbers are unchanged. */
export function polishBullet(text) {
  const original = String(text || '').replace(LEAD_SYMBOLS, '').trim();
  let t = original;
  if (!t) return t;
  // No first person ("I built…" -> "Built…")
  t = t.replace(/^(?:I|We)\s+(?=(?:was|were)\s|[a-z]+ed\b|led\b|built\b|ran\b|wrote\b|drove\b|grew\b|made\b|oversaw\b)/, '');
  const owner = t.match(/^(?:(?:was|were)\s+)?(responsible for|tasked with|in charge of|worked on)\s+/i);
  if (owner) {
    const rest = t.slice(owner[0].length);
    const g = rest.match(/^([a-z]+ing)\b\s*/i);
    if (g && GERUND_PAST[g[1].toLowerCase()]) t = `${GERUND_PAST[g[1].toLowerCase()]} ${rest.slice(g[0].length)}`;
    // "Responsible for a team of 5" -> "Led a team of 5"; "…for the platform" -> "Owned the platform"
    else if (!g && /^(responsible for|in charge of)$/i.test(owner[1])) {
      t = `${/^(?:a |the |an )?(?:\w+\s+){0,2}?(team|squad|group|engineers?|developers?|people|staff|reports|interns?)\b/i.test(rest) ? 'Led' : 'Owned'} ${rest}`;
    }
  }
  t = t.replace(/\bsuccessfully\s+/gi, '')
    .replace(/\bin order to\b/gi, 'to')
    .replace(/\butili[sz]ing\b/gi, 'using')
    .replace(/\butili[sz]ed\b/gi, 'used')
    .replace(/\butili[sz]es\b/gi, 'uses')
    .replace(/\butili[sz]e\b/gi, 'use')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Capitalise only a rewritten opening ("iOS", "pgvector" stay as written)
  const firstWord = (x) => (x.match(/^\S+/) || [''])[0].toLowerCase();
  if (t && firstWord(t) !== firstWord(original)) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

// Y: a measured result (years in dates don't count)
const UNITS = 'k|m|mm|bn|million|billion|thousand|hours?|hrs?|minutes?|mins?|seconds?|secs?|ms|days?|weeks?|months?|years?|users?|customers?|clients?|requests?|rps|qps|tps|transactions?|engineers?|developers?|people|members|services|microservices|countries|markets|teams?|projects?|apps?|applications?|pipelines?|models?|tb|gb|pb|records|rows|documents|pages|tickets|releases|deployments|sites|stores|integrations|endpoints|apis|features|products|partners|accounts|leads|downloads|installs|students|patients|merchants|orders|events|messages|calls|servers|nodes|clusters|repositories|tests|queries|jobs|workflows|dashboards|reports|countries|languages';
const MEASURE = new RegExp(String.raw`\d+(?:\.\d+)?\s*(?:%|x\b|\+)|[$£€₹]\s?\d|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s*(?:${UNITS})\b|`
  + String.raw`\b(?:doubled|tripled|quadrupled|halved)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundreds?|thousands?|millions?|dozens?)\s+(?:of\s+)?(?:hours?|days?|weeks?|months?|minutes?|seconds?|years?|times|engineers?|developers?|teams?|people|clients?|customers?|users?|services|countries|markets|products|releases)\b|`
  + String.raw`\b(?:twice|thrice|three times)\b|\b(?:daily|weekly|hourly|bi-?weekly)\s+(?:releases?|deploy\w*|shipping)\b|\b(?:zero|no|without)[\s-]downtime\b|`
  + String.raw`\bfrom\s+[$£€]?\d[\d.,]*\s*[%a-z]*\s+to\s+(?:under\s+|below\s+)?[$£€]?\d|`
  + String.raw`\b(?:team|group|squad|staff|cohort) of \d+\b|\b(?:top|over|under|within|than) \d+(?:\.\d+)?\b`, 'i');
// A year ("in 2021") is not a result; "2000 users" is
const YEAR_ONLY = new RegExp(String.raw`\b(?:19|20)\d{2}\b(?!\s*(?:\+|%|${UNITS})\b)`, 'gi');
const hasMeasure = (text) => MEASURE.test(String(text).replace(YEAR_ONLY, ''));
// Z: how it was done (a method word or a named technology)
const hasMethod = (text) => /\b(by|using|with|through|via|leveraging|built on|powered by|on top of)\b/i.test(text)
  || TERMS.some(t => t.category !== 'Ways of Working' && countMatches(t.re, text) > 0);
// X: opens with an action verb ("Built", "Led", "Designs")
function hasAction(rawText) {
  const text = String(rawText || '').replace(LEAD_SYMBOLS, '');
  if (WEAK_OPENERS.test(text)) return false;
  // "Co-founded", "Re-architected": the verb is the last part
  const w = ((String(text).trim().match(/^[A-Za-z-]+/) || [''])[0].toLowerCase().split('-').pop()) || '';
  if (!w) return false;
  if (PAST_VERBS.has(w) || (/[a-z]{3,}ed$/.test(w) && !/eed$/.test(w))) return true;
  // present tense for a current role: "Build", "Builds", "Manages", "Runs", "Ships"
  const base = w.endsWith('es') && GERUND_PAST[`${w.slice(0, -2)}ing`] ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : w;
  return Boolean(GERUND_PAST[`${base}ing`] || GERUND_PAST[`${base.slice(0, -1)}ing`] || GERUND_PAST[`${base}${base.slice(-1)}ing`]
    || PRESENT_VERBS.has(base));
}

// ---------- "Tell it what to add or change" ----------
// Plain instructions typed under the CV ("Under Brightloop add: built GraphQL APIs…",
// "Add skills: Kubernetes, Terraform", "Remove PHP", "Change headline to …") applied to
// the CV. Only what the instruction says is added; anything unclear is reported back.

const PAST_TO_GERUND = {
  reduced: 'reducing', cut: 'cutting', improved: 'improving', increased: 'increasing', saved: 'saving', lowered: 'lowering',
  boosted: 'boosting', doubled: 'doubling', halved: 'halving', grew: 'growing', 'sped up': 'speeding up', made: 'making',
  helped: 'helping', raised: 'raising', shortened: 'shortening', removed: 'removing', prevented: 'preventing', enabled: 'enabling'
};
const RESULT_VERBS = Object.keys(PAST_TO_GERUND).join('|');

/** Someone's own words as a CV point: "I set up kafka and it cut errors by 30%" -> "Set up Kafka, cutting errors by 30%." */
export function cleanPoint(text) {
  let t = String(text || '').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
    .replace(/^["“'`]+|["”'`]+$/g, '').replace(/[.!\s]+$/, '');
  if (!t) return '';
  const stripI = (s) => s.replace(/^(?:I|we)\s+(?:have|had)\s+/i, '').replace(/^(?:I|we)['’]ve\s+/i, '').replace(/^(?:I|we)\s+(?=[a-z])/i, '');
  t = stripI(t).replace(/\bapi(s?)\b/g, 'API$1');
  // A spoken-style wrapper ("…, can you add that to Brightloop", "could you please note
  // this") is the request talking about itself, not part of what was done — someone
  // describing a real achievement in their own words ("I spent 3 months setting up CI/CD…
  // can you add that to Brightloop") still means that achievement, not this sentence as a
  // whole; strip the wrapper and keep the real content.
  const WRAP_VERB = 'add|include|put|note|mention|write|say|reflect|show|capture|highlight';
  t = t.replace(new RegExp(`^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:${WRAP_VERB})\\b\\s*[:,]?\\s*(?:that|this|it)?\\s*[:,]?\\s*`, 'i'), '')
    .replace(new RegExp(`^please\\s+(?:${WRAP_VERB})\\s+(?:that|this|it)\\b\\s*[:,]?\\s*`, 'i'), '')
    // only a trailing wrapper (there must be real content before it, not the whole sentence)
    .replace(new RegExp(`(?<=[\\w.%])[,]?\\s*(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:${WRAP_VERB})\\b.*$`, 'i'), '')
    .replace(new RegExp(`(?<=[\\w.%])[,]?\\s*please\\s+(?:${WRAP_VERB})\\s+(?:that|this|it)\\b.*$`, 'i'), '')
    .trim();
  t = stripI(t);
  if (!t) return '';
  t = polishBullet(t);
  const g = t.match(/^([A-Za-z]+ing)\b/);
  if (g && GERUND_PAST[g[1].toLowerCase()]) t = GERUND_PAST[g[1].toLowerCase()] + t.slice(g[0].length);
  t = t.replace(new RegExp(String.raw`,?\s+(?:and\s+)?(?:it|this|that|which)\s+(${RESULT_VERBS})\b|\s+and\s+(${RESULT_VERBS})\b`, 'gi'),
    (m, a, b) => `, ${PAST_TO_GERUND[(a || b).toLowerCase()]}`);
  // Tools in their proper spelling: "kafka" -> "Kafka", plus a few common short forms
  for (const x of TERMS) {
    if (x.category === 'Ways of Working' || x.name.length < 3 || COMMON_WORDS.has(x.name.toLowerCase())) continue;
    t = t.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(x.name)}(?![A-Za-z0-9])`, 'gi'), (m) => (m === x.name ? m : x.name));
  }
  t = t.replace(/\bpostgres\b/gi, 'PostgreSQL').replace(/\bk8s\b/gi, 'Kubernetes').replace(/\bgolang\b/gi, 'Go');
  t = t[0].toUpperCase() + t.slice(1);
  return `${t.replace(/\s+,/g, ',')}.`;
}

// A job or project named in an instruction ("Brightloop", "my current job", "ShipFast")
function findPlace(cv, target) {
  const t = String(target || '').toLowerCase().replace(/^(?:my|the)\s+/, '').replace(/\s+(?:job|role|company|project|position)$/, '').trim();
  if (!t) return null;
  if (/^(current|latest|last|recent|most recent|present|first)\b/.test(t)) return cv.experience.length ? { kind: 'exp', i: 0 } : null;
  // a space/hyphen typed where the name has none ("voice glow" for "VoiceGlow") still matches
  const squash = (s) => String(s || '').toLowerCase().replace(/[\s-]+/g, '');
  const tSquashed = squash(t);
  const has = (name) => {
    const n = String(name || '').toLowerCase();
    if (n && (n === t || n.includes(t) || (t.includes(n) && n.length >= 3))) return true;
    const ns = squash(name);
    return ns.length >= 3 && (ns === tSquashed || ns.includes(tSquashed) || tSquashed.includes(ns));
  };
  let i = cv.experience.findIndex(x => has(x.company));
  if (i >= 0) return { kind: 'exp', i };
  i = cv.projects.findIndex(p => has(p.name));
  if (i >= 0) return { kind: 'proj', i };
  i = cv.experience.findIndex(x => has(x.role));
  return i >= 0 ? { kind: 'exp', i } : null;
}

// "the first point", "the 2nd bullet", "the last line" -> a 0-based index into that list
const ORDINAL_WORD = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7, last: -1 };
function ordinalIndex(word, length) {
  const w = String(word || '').trim().toLowerCase();
  if (w in ORDINAL_WORD) { const i = ORDINAL_WORD[w]; return i === -1 ? length - 1 : i; }
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : null;
}

// Light cleanup for text that replaces a whole point verbatim (a project tagline, say) —
// tool names spelled properly and a capital letter, but not the achievement-bullet rules
// (no verb required, no first-person stripped): it isn't necessarily an achievement.
function cleanReplacementText(text) {
  let t = String(text || '').trim().replace(/^["“']|["”']$/g, '').replace(/[.\s]+$/, '');
  if (!t) return '';
  for (const x of TERMS) {
    if (x.category === 'Ways of Working' || x.name.length < 3 || COMMON_WORDS.has(x.name.toLowerCase())) continue;
    t = t.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(x.name)}(?![A-Za-z0-9])`, 'gi'), (w) => (w === x.name ? w : x.name));
  }
  return `${t[0].toUpperCase()}${t.slice(1)}.`;
}

// The job a new point fits best: the one whose points use the same tools or kind of
// tools; the latest job when nothing points elsewhere
function bestJobFor(cv, text) {
  if (!cv.experience.length) return null;
  const tools = TERMS.filter(t => t.category !== 'Ways of Working' && t.name !== 'AI' && countMatches(t.re, text) > 0);
  if (!tools.length) return { kind: 'exp', i: 0 };
  // the most recent job whose points already use one of these tools
  const i = cv.experience.findIndex(x => tools.some(t => countMatches(t.re, x.bullets.join(' ')) > 0));
  return { kind: 'exp', i: Math.max(0, i) };
}

// Text about the CV itself ("some more skills into the experience") is an instruction,
// never a point: a point says what was done
const META_WORDS = /\b(?:skills?|experiences?|points?|bullets?|sections?|cv|resume|profile|summary|headline|more|some|better|stronger|keywords?)\b/i;
// A sentence can have an action verb and still say nothing real ("add something useful
// here", "make some improvements"): everything after the verb is filler, naming no
// concrete thing (no tool, number, person, result). Caught separately from META_WORDS,
// which looks for words about the CV itself rather than this kind of emptiness.
const FILLER_WORDS = /\b(?:some|any|many|various|certain|something|anything|nothing|stuff|things?|useful|helpful|relevant|appropriate|whatever|improvements?|changes?|updates?|enhancements?|real[\s-]?time)\b/i;
const FILLER_WORDS_G = new RegExp(FILLER_WORDS.source, 'gi');
// True only when a sentence has filler words AND, once those and the leading verb are
// stripped, nothing concrete (a tool, number, person, result) is left — "Added useful
// stuff here" is filler all the way down; "Mentored two junior developers" is not.
function hasNoConcreteContent(text) {
  const t = String(text || '').trim();
  if (!t || !FILLER_WORDS.test(t)) return false;
  const rest = t.replace(FILLER_WORDS_G, ' ').replace(/^[A-Za-z-]+\s*/, ' ');
  const concrete = rest.split(/\s+/).filter(w => w.length > 2 && !/^(?:here|there|this|that|these|those|also|just|now|will|please)$/i.test(w));
  return concrete.length === 0;
}
function looksLikePoint(text) {
  const t = String(text).trim().replace(/^(?:I|we)\s+(?:have\s+|also\s+)?/i, '');
  // Requires a real action verb up front ("Built…", "Led…"), not just four unrelated
  // words — "something about leadership in there" and "2 more years" are instructions
  // or fragments, not achievements, and must never be pasted onto the CV as a bullet.
  if (!hasAction(t) || META_WORDS.test(t)) return false;
  // Past the verb, is there anything concrete, or just filler? "Built Kafka pipelines"
  // keeps going; "Added something useful here" has nothing left once filler is removed.
  return !hasNoConcreteContent(t);
}

/**
 * "Add more skills into my experience": the job's skills you list but no point shows are
 * worked into a related point, next to a tool of the same kind ("PostgreSQL" -> "PostgreSQL
 * and Redis"). Skills with no related point stay in the skills section.
 */
function weaveSkills(cv, jdTerms, done) {
  const work = () => cv.experience.flatMap(x => x.bullets).join('\n');
  const listed = cv.skills.flatMap(g => g.items.map(i => i.name));
  const pool = (jdTerms.length ? jdTerms : TERMS).filter(t => t.category !== 'Ways of Working' && t.name !== 'AI'
    && countMatches(t.re, work()) === 0 && listed.some(n => n.toLowerCase() === t.name.toLowerCase() || countMatches(t.re, n) > 0));
  const placed = [], kept = [];
  const used = new Set();
  for (const t of pool.slice(0, 8)) {
    const kind = categoryOf(t.name);
    let ok = false;
    for (const x of cv.experience) {
      for (let j = 0; j < x.bullets.length && !ok; j++) {
        const key = `${cv.experience.indexOf(x)}:${j}`;
        if (used.has(key)) continue;
        const kin = TERMS.find(o => o !== t && o.category !== 'Ways of Working' && categoryOf(o.name) === kind && countMatches(o.re, x.bullets[j]) > 0);
        if (!kin) continue;
        const re = new RegExp(kin.re.source, 'i');
        const hit = x.bullets[j].match(re);
        if (!hit) continue;
        x.bullets[j] = x.bullets[j].replace(re, (w) => `${w} and ${t.name}`).replace(/ and (\S+) and /, ', $1 and ');
        used.add(key);
        placed.push(`${t.name} (under ${x.company || x.role})`);
        ok = true;
      }
      if (ok) break;
    }
    if (!ok) kept.push(t.name);
  }
  if (placed.length) done.push(`Worked ${joinList(placed)} into related points, next to tools of the same kind`);
  if (kept.length) done.push(`Kept ${joinList(kept.slice(0, 6))} in your skills only: no point uses a related tool`);
  if (!placed.length && !kept.length) done.push('Your points already show the skills this job asks for');
}

/**
 * "Add some more skills" (no names given): a skill can only honestly be added when the
 * CV's own points already show it — never invented from nothing. Tools the posting asks
 * for (or, with no posting, any recognized tool) that appear in a bullet or a project's
 * tech but aren't in the skills list yet are added; there's nothing to add if everything
 * demonstrated is already listed.
 */
function addMissingListedSkills(cv, jdTerms, done, added) {
  const work = () => [...cv.experience.flatMap(x => x.bullets), ...cv.projects.flatMap(p => (p.bullets && p.bullets.length ? p.bullets : [p.desc].filter(Boolean)).concat(p.tech || []))].join('\n');
  const listed = new Set(cv.skills.flatMap(g => g.items.map(i => i.name.toLowerCase())));
  const pool = (jdTerms.length ? jdTerms : TERMS).filter(t => t.category !== 'Ways of Working' && t.name !== 'AI'
    && countMatches(t.re, work()) > 0 && !listed.has(t.name.toLowerCase()));
  const names = [...new Set(pool.map(t => t.name))].slice(0, 6);
  if (names.length) addSkills(cv, names.join(', '), done, added);
  else done.push('Nothing to add: every skill your points and projects show is already listed');
}

const placeName = (cv, p) => (p.kind === 'exp' ? [cv.experience[p.i].role, cv.experience[p.i].company].filter(Boolean).join(' at ') : `the ${cv.projects[p.i].name} project`);

function addPoint(cv, place, text, done, note) {
  const point = cleanPoint(text);
  if (!point) return false;
  if (place.kind === 'exp') cv.experience[place.i].bullets.unshift(point);
  else {
    const pr = cv.projects[place.i];
    pr.bullets = pr.bullets && pr.bullets.length ? pr.bullets : [pr.desc].filter(Boolean);
    pr.bullets.push(point);
    pr.desc = pr.bullets.join(' ');
  }
  done.push(`Added to ${placeName(cv, place)}: "${point}"${note ? ` ${note}` : ''}`);
  return true;
}

// A skill as typed, in its usual spelling, with the skills category it belongs in
function skillName(raw) {
  const s = String(raw || '').trim().replace(/^["“']|["”']$/g, '').replace(/[.]$/, '');
  const term = TERMS.find(x => x.name.toLowerCase() === s.toLowerCase()) || TERMS.find(x => { const re = new RegExp(`^(?:${x.re.source})$`, 'i'); return re.test(s); });
  return term ? term.name : s;
}

// A skill without a specific name ("some more skills related to the tools") must never
// become a literal skill on the CV — a real skill is a short name, not a sentence, and a
// known term (Kubernetes, Terraform, …) always passes; only unrecognized text is checked.
const SKILL_FILLER = /\b(?:some|any|many|various|certain|more|additional|extra|new|relevant|related|useful|helpful|appropriate|whatever|something|anything|nothing|stuff|things?|improvements?|changes?|updates?|enhancements?|real[\s-]?time|tools?|skills?|technolog(?:y|ies)|keywords?)\b/i;
function looksLikeSkillName(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (TERMS.some(t => t.name.toLowerCase() === n.toLowerCase())) return true;
  if (n.split(/\s+/).length > 4) return false;
  return !SKILL_FILLER.test(n);
}

// "I got my AWS Solutions Architect cert last month" -> "AWS Solutions Architect": the
// sentence around a real certification's name is dropped, the name itself kept as-is.
function extractCertName(text) {
  let t = String(text || '').trim().replace(/[.!]+$/, '');
  t = t.replace(/^i\s+(?:just\s+)?(?:got|earned|received|passed|completed|obtained|have)\s+(?:my\s+|the\s+|an?\s+)?/i, '')
    .replace(/\b(?:cert|certification|certificate)\b/i, '')
    .replace(/\s*,?\s*(?:last\s+(?:month|week|year)|recently|this\s+(?:month|week|year)|a\s+(?:few\s+)?(?:weeks?|months?)\s+ago)\s*$/i, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}

// A certification without a real name ("a relevant certification", "add a cert") must
// never be added — that's a fabricated credential, not an honest gap in phrasing.
const CERT_STOPWORDS = new Set(['add', 'a', 'an', 'the', 'my', 'this', 'that', 'some', 'any', 'include', 'list', 'it', 'certification', 'certifications', 'certificate', 'cert', 'certs', 'relevant', 'appropriate', 'useful', 'good', 'nice', 'whatever', 'something', 'real', 'actual']);
function looksLikeCertName(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^i\s+(?:just\s+)?(?:got|earned|received|passed|completed|obtained|have)\b/i.test(t)) return false;
  const words = t.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 10) return false;
  return words.some(w => w.length > 2 && !CERT_STOPWORDS.has(w));
}

// "my masters degree in data science from MIT, finished 2022" -> fields, instead of the
// whole sentence dumped into "degree" when it isn't in the explicit "X | Y | Z" format.
function parseDegreeText(text) {
  let t = String(text || '').trim().replace(/[.]$/, '');
  let school = '';
  let m = t.match(/\bfrom\s+([A-Z][\w&.'-]*(?:\s+(?:of\s+)?[A-Z][\w&.'-]*){0,4})\b/);
  if (m) { school = m[1].trim(); t = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim(); }
  let period = '';
  m = t.match(/\b(?:finished|graduated|completed)?\s*\(?((?:19|20)\d{2}(?:\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present))?)\)?\s*$/i);
  if (m) { period = m[1].trim(); t = t.slice(0, m.index).trim(); }
  t = t.replace(/\s*,\s*$/, '').replace(/^(?:my\s+|a\s+|an\s+)/i, '').trim();
  return { degree: t, school, period };
}

function addSkills(cv, list, done, added, unclear, raw, jdTerms) {
  const candidates = String(list).split(/\s*(?:,|;|\band\b|&)\s*/i).map(skillName).filter(n => n && n.length <= 60);
  const names = candidates.filter(looksLikeSkillName);
  const vague = candidates.filter(n => !looksLikeSkillName(n));
  // nothing nameable was given at all ("add some more skills") — fall back to what the
  // CV's own points and projects already demonstrate, never an invented name
  if (!names.length && vague.length && jdTerms !== undefined) { addMissingListedSkills(cv, jdTerms, done, added); return; }
  const fresh = [];
  for (const name of names) {
    if (cv.skills.some(g => g.items.some(i => i.name.toLowerCase() === name.toLowerCase()))) continue;
    const group = categoryOf(name) || 'Other Tools';
    let g = cv.skills.find(x => x.group === group);
    if (!g) { g = { group, items: [] }; cv.skills.push(g); }
    g.items.unshift({ name, matched: false });
    fresh.push(name);
    added.push(name);
  }
  if (fresh.length) done.push(`Added to your skills: ${joinList(fresh)}`);
  else if (names.length) done.push(`${joinList(names)} ${names.length > 1 ? 'are' : 'is'} already in your skills`);
  if (vague.length) (unclear || done).push(`${raw || list} — name the actual skills to add, e.g. "Add skills: Kubernetes, Terraform". I can't add "${joinList(vague)}" as a skill — it doesn't name one.`);
}

function removeThing(cv, rawTarget, done, unclear, raw) {
  // "the point about X" means a point, never the skill X
  const onlyPoints = /^(?:the\s+)?(?:point|bullet|line|sentence)s?\s+(?:about|on|with|containing|that says|saying)\s+/i.test(String(rawTarget).trim());
  let t = String(rawTarget).trim().replace(/^["“']|["”']$/g, '').replace(/\.$/, '')
    .replace(/^(?:the\s+)?(?:point|bullet|line|sentence)s?\s+(?:about|on|with|containing|that says|saying)\s+/i, '')
    .replace(/^(?:the\s+)?skills?\s+/i, '').replace(/\s+from\s+(?:my\s+|the\s+)?(?:skills|cv|resume)$/i, '').trim();
  if (!t) { unclear.push(`${raw} — tell me what to remove, e.g. "remove PHP" or "remove the point about billing".`); return; }
  const section = t.toLowerCase().replace(/^the\s+/, '').replace(/\s+section$/, '');
  if (['projects', 'certifications', 'education'].includes(section)) {
    cv[section] = [];
    done.push(`Removed the ${section} section`);
    return;
  }
  const name = skillName(t).toLowerCase();
  if (!onlyPoints) for (const g of cv.skills) {
    const before = g.items.length;
    g.items = g.items.filter(i => i.name.toLowerCase() !== name);
    if (g.items.length < before) {
      cv.skills = cv.skills.filter(x => x.items.length);
      done.push(`Removed ${skillName(t)} from your skills`);
      return;
    }
  }
  const low = t.toLowerCase();
  const pi = cv.projects.findIndex(p => p.name.toLowerCase() === low);
  if (pi >= 0) { done.push(`Removed the ${cv.projects[pi].name} project`); cv.projects.splice(pi, 1); return; }
  const ei = cv.education.findIndex(e => `${e.degree} ${e.school}`.toLowerCase().includes(low));
  if (ei >= 0 && !cv.certifications.some(c => c.toLowerCase().includes(low))) { done.push(`Removed education: ${[cv.education[ei].degree, cv.education[ei].school].filter(Boolean).join(', ')}`); cv.education.splice(ei, 1); return; }
  const ci = cv.certifications.findIndex(c => c.toLowerCase().includes(low));
  if (ci >= 0) { done.push(`Removed the certification "${cv.certifications[ci]}"`); cv.certifications.splice(ci, 1); return; }
  const hits = [];
  cv.experience.forEach((x, i) => x.bullets.forEach((b, j) => { if (b.toLowerCase().includes(low)) hits.push({ i, j, b, exp: true }); }));
  cv.projects.forEach((p, i) => (p.bullets || []).forEach((b, j) => { if (b.toLowerCase().includes(low)) hits.push({ i, j, b, exp: false }); }));
  if (!hits.length) { unclear.push(`${raw} — I couldn't find anything matching "${t}" on the CV, so nothing was removed.`); return; }
  if (hits.length > 2) { unclear.push(`${raw} — ${hits.length} different points mention "${t}". Paste a bit more of the exact sentence so I know which one you mean.`); return; }
  for (const h of hits.sort((a, b) => b.j - a.j)) {
    if (h.exp) cv.experience[h.i].bullets.splice(h.j, 1);
    else { const p = cv.projects[h.i]; p.bullets.splice(h.j, 1); p.desc = p.bullets.join(' '); }
    done.push(`Removed: "${h.b}"`);
  }
}

function replaceText(cv, from, to, done, unclear, raw) {
  const low = from.toLowerCase();
  const swap = (s) => { const k = s.toLowerCase().indexOf(low); return k < 0 ? null : s.slice(0, k) + to + s.slice(k + from.length); };
  for (const x of cv.experience) for (let j = 0; j < x.bullets.length; j++) {
    const n = swap(x.bullets[j]);
    if (n !== null) { x.bullets[j] = n; done.push(`Changed a point under ${x.role || x.company}: "${n}"`); return; }
  }
  for (const p of cv.projects) for (let j = 0; j < (p.bullets || []).length; j++) {
    const n = swap(p.bullets[j]);
    if (n !== null) { p.bullets[j] = n; p.desc = p.bullets.join(' '); done.push(`Changed a point in ${p.name}: "${n}"`); return; }
  }
  // job titles, companies and dates; schools, degrees and certifications
  for (const x of cv.experience) for (const key of ['role', 'company', 'period', 'location']) {
    const n = swap(x[key] || '');
    if (n !== null) { x[key] = n; done.push(`Changed "${from}" to "${to}" in ${key === 'company' ? 'the company name' : `the job's ${key === 'role' ? 'title' : key}`}`); return; }
  }
  for (const e of cv.education) for (const key of ['degree', 'school', 'period']) {
    const n = swap(e[key] || '');
    if (n !== null) { e[key] = n; done.push(`Changed "${from}" to "${to}" in your education`); return; }
  }
  for (let j = 0; j < cv.certifications.length; j++) {
    const n = swap(cv.certifications[j]);
    if (n !== null) { cv.certifications[j] = n; done.push(`Changed a certification to "${n}"`); return; }
  }
  for (const key of ['summary', 'headline', 'location']) {
    const n = swap(cv[key] || '');
    if (n !== null) { cv[key] = n; done.push(`Changed your ${key}`); return; }
  }
  unclear.push(`${raw} — I couldn't find "${from}" anywhere on the CV, so nothing was changed.`);
}

// "Add realistic achievements / numbers": every point without a number becomes a measured
// achievement right away, with a typical, modest estimate for that kind of work (marked ~).
const NUMBER_DRAFTS = [
  [/\b(test(s|ing)?|jest|cypress|pytest|qa)\b/i, 'reaching ~80% test coverage'],
  [/\b(open[- ]source|starter kit|sdk|npm package)\b/i, 'used by ~200 developers'],
  [/\b(state management|redux|zustand|context api|accessibility|responsive)\b/i, 'cutting UI bugs by ~25%'],
  [/\b(payments?|checkout|billing|orders?|transactions?|invoic\w*|stripe)\b/i, 'handling ~10,000 transactions a month'],
  [/\b(ci\/cd|pipelines?|deploy\w*|releases?|github actions|gitlab ci|docker|kubernetes)\b/i, 'cutting release time by ~40%'],
  [/\b(performance|optimi[sz]\w*|latency|faster|speed|load(ing)? time|lighthouse|caching|cache|index\w*|quer(y|ies))\b/i, 'improving response times by ~30%'],
  [/\b(monitor\w*|observability|logging|alert\w*|sentry|grafana|datadog|prometheus|on[- ]?call|incident|outage|pager|escalat\w*)\b/i, 'cutting incident resolution time by ~35%'],
  [/\b(automat\w*|scripts?|workflows?)\b/i, 'saving the team ~10 hours a week'],
  [/\b(mentor\w*|led|lead|team|coach\w*|review\w*)\b/i, 'across a team of ~5 engineers'],
  [/\b(data|etl|elt|reports?|analytics|warehouse|spark|airflow)\b/i, 'processing ~1M records a day'],
  [/\b(apis?|services?|backend|microservices?|endpoints?|server)\b/i, 'handling ~100K requests a day'],
  [/\b(dashboards?|ui|interfaces?|frontend|front-end|pages?|sites?|website|app|apps|screens?|components?)\b/i, 'used by ~5,000 users'],
  [/\b(security|auth\w*|permissions?|compliance)\b/i, 'protecting ~10,000 user accounts']
];
const DEFAULT_DRAFT = 'improving delivery speed by ~20%';

// Naming just a topic ("on call and incident response", "mentoring") rather than a
// finished sentence is still a real request — a plausible, honestly-marked draft point is
// built for it (same ~estimate convention as measuredVersion below) rather than either
// inventing specifics or refusing outright. Covers common, recognizable topics only; an
// unrecognized one still gets the "tell me what you did" message, never a guess.
const TOPIC_OPENERS = [
  [/\b(on[- ]?call|incident|outage|pager|escalat\w*)\b/i, 'Took part in the on-call rotation, triaging and resolving incidents'],
  [/\b(mentor\w*|coach\w*|onboard\w*|junior)/i, 'Mentored junior engineers and helped them ramp up'],
  [/\b(review|pull request|code quality)/i, 'Reviewed pull requests and gave feedback to keep code quality high'],
  [/\b(test(s|ing)?|jest|cypress|pytest|qa)\b/i, 'Wrote automated tests for new and existing features'],
  [/\b(ci\/cd|pipelines?|deploy\w*|releases?|github actions|gitlab ci)\b/i, 'Set up CI/CD pipelines to automate builds and deployments'],
  [/\b(performance|optimi[sz]\w*|latency|caching|cache)\b/i, 'Profiled and optimized slow code paths'],
  [/\b(security|auth\w*|permissions?|compliance)\b/i, 'Hardened authentication and access controls'],
  [/\b(document\w*|docs|runbooks?|wiki)\b/i, 'Wrote documentation and runbooks for the team'],
  [/\bmigrat\w*\b/i, 'Led a migration effort with minimal disruption'],
  [/\b(monitor\w*|observability|logging|alert\w*|sentry|grafana|datadog|prometheus)\b/i, 'Set up monitoring and alerting to catch issues early'],
  [/\b(data|etl|elt|reports?|analytics|warehouse|spark|airflow)\b/i, 'Built data pipelines and reporting'],
  [/\b(apis?|services?|backend|microservices?|endpoints?|server)\b/i, 'Designed and built APIs and backend services'],
  [/\b(dashboards?|ui|interfaces?|frontend|front-end|pages?|components?)\b/i, 'Built UI components and pages'],
  [/\b(cost|spend\w*|billing|budget)\b/i, 'Identified and cut unnecessary cloud spend'],
  [/\b(hiring|interview\w*|recruit\w*)\b/i, 'Interviewed candidates and helped grow the team'],
  [/\b(architect\w*|design doc|rfc)\b/i, 'Wrote design docs and drove architecture decisions']
];
function draftPointFromTopic(text) {
  const t = String(text || '').trim();
  const opener = TOPIC_OPENERS.find(([re]) => re.test(t));
  if (!opener) return null;
  const clause = (NUMBER_DRAFTS.find(([re]) => re.test(t)) || [null, DEFAULT_DRAFT])[1];
  return /^across\b/.test(clause) ? `${opener[1]} ${clause}.` : `${opener[1]}, ${clause}.`;
}

/** Points without a number, each with a measured version: [{ original, suggested }]. */
// A point with a measured result: its vague ending ("…, enabling reliable releases", "… to
// ensure quality") makes way for a typical result for that kind of work (marked ~)
function measuredVersion(b) {
  const clause = (NUMBER_DRAFTS.find(([re]) => re.test(b)) || [null, DEFAULT_DRAFT])[1];
  const core = b.replace(/[.\s]+$/, '')
    .replace(/,\s*(?:and\s+)?(?:enabling|improving|ensuring|supporting|delivering|helping|collaborating|maintaining|increasing|allowing|providing|making|resulting|driving|leading to|which|while)\b[^,]*$/i, '')
    .replace(/\s+(?:to|in order to)\s+(?:ensure|improve|support|enable|deliver|help|maintain|provide|allow|accelerate|keep)\b[^,]*$/i, '');
  // "across a team of …" reads as part of the sentence, without a comma
  return /^across\b/.test(clause) ? `${core} ${clause}.` : `${core}, ${clause}.`;
}

export function draftNumbers(cv) {
  const points = [
    ...cv.experience.flatMap(x => x.bullets),
    ...cv.projects.flatMap(p => (p.bullets && p.bullets.length ? p.bullets : [p.desc].filter(Boolean)))
  ];
  // Only achievements (points that start with what was done), not descriptions
  return points.filter(b => b && !hasMeasure(b) && hasAction(b)).map(b => ({ original: b, suggested: measuredVersion(b) }));
}

/** "Improve the points": stronger openers, tighter wording, a measured result, results first. */
function improvePoints(cv, jobs) {
  let changed = 0;
  for (const x of jobs) {
    x.bullets = x.bullets.map(b => {
      let t = polishBullet(b);
      if (!hasAction(t)) t = `Delivered ${t[0].toLowerCase()}${t.slice(1)}`;
      if (words(t) > 28) t = `${t.replace(/[.\s]+$/, '').replace(VAGUE_ENDING, '')}.`;
      if (!hasMeasure(t)) t = measuredVersion(t);
      if (t !== b) changed++;
      return t;
    });
    x.bullets = [...x.bullets].sort((a, c) => Number(hasMeasure(c)) - Number(hasMeasure(a)));
  }
  return changed;
}

// Certifications that fit the skills a job asks for (named in replies; added only by name)
const CERTIFICATIONS_FOR = {
  AWS: 'AWS Certified Developer – Associate', Azure: 'Microsoft Certified: Azure Developer Associate', GCP: 'Google Cloud Professional Cloud Developer',
  Kubernetes: 'Certified Kubernetes Application Developer (CKAD)', Terraform: 'HashiCorp Certified: Terraform Associate', Docker: 'Docker Certified Associate (DCA)',
  Python: 'PCAP – Certified Associate Python Programmer', Agile: 'Professional Scrum Master I (PSM I)', Security: 'CompTIA Security+',
  Snowflake: 'SnowPro Core Certification', Databricks: 'Databricks Certified Data Engineer Associate', MongoDB: 'MongoDB Associate Developer'
};

// Shorter points: the vague ending goes ("…, enabling reliable releases with minimal downtime")
const VAGUE_ENDING = /,\s*(?:and\s+)?(?:enabling|improving|ensuring|supporting|delivering|helping|collaborating|maintaining|increasing|allowing|providing|making|resulting|driving|leading to|which|while)\b[^,]*$|\s+(?:to|in order to)\s+(?:ensure|improve|support|enable|deliver|help|maintain|provide|allow|accelerate|keep)\b[^,]*$/i;

// "Senior Engineer at Acme (2019 – 2021)" / "Senior Engineer | Acme | 2019 – 2021"
function parseJob(text) {
  const t = String(text).trim();
  let m = t.split(/\s*\|\s*/);
  if (m.length >= 2) return { role: m[0], company: m[1], period: m[2] || '', location: m[3] || '', bullets: [] };
  m = t.match(/^(.+?)\s+(?:at|@|with)\s+(.+?)(?:\s*[,(]\s*([^()]*\d{4}[^()]*)\)?)?$/i);
  return m ? { role: m[1].trim(), company: m[2].trim().replace(/,$/, ''), period: (m[3] || '').trim(), location: '', bullets: [] } : null;
}

// Everyday wording around a request ("Can you please…", "I want to…", "… thanks") is set
// aside, and a few synonyms become the words the rules know
function normalizeRequest(text) {
  let t = String(text).replace(/\s+/g, ' ').trim();
  const lead = /^(?:please|pls|kindly|can you|could you|would you|will you|i want you to|i'd like you to|i would like you to|i need you to|i want to|i'd like to|i would like to|i need to|let's|lets|go ahead and|now|also|and|then|just|ok(?:ay)?|so)[,\s]+/i;
  for (let i = 0; i < 6 && lead.test(t); i++) t = t.replace(lead, '');
  t = t.replace(/[,\s]*(?:please|pls|thanks|thank you)[.!]*$/i, '').replace(/[!]+$/, '')
    .replace(/^i\s+(?:want|need|would like|'d like)\s+(?=(?:my|the)\s)/i, '')
    // "make it look nicer / cleaner / more professional" -> tidy and organize
    .replace(/^make\s+(?:it|the cv|my cv|my resume|this)\s+(?:look\s+|read\s+)?(?:nicer|cleaner|better|neater|more professional|more polished|tidier)$/i, 'organize my cv')
    .replace(/^(?:get rid of|take out|take off|erase|cut out|delete|drop)\s+/i, 'remove ')
    .replace(/^(?:insert|include|put|list)\s+/i, 'add ')
    // "mention that I mentored 3 juniors" -> "I mentored 3 juniors"
    .replace(/^(?:mention|say|write|note|show|state|add)\s+(?:that\s+)?(?=i\s)/i, '')
    // "say that at Brightloop I …" -> "at Brightloop I …"
    .replace(/^(?:mention|say|write|note|state)\s+that\s+/i, '')
    // "mention in my Brightloop job that I …" -> "under Brightloop add: I …"
    .replace(/^(?:mention|say|write|note|state|add)\s+(?:in|at|for|under)\s+(?:my\s+|the\s+)?(.+?)\s+(?:job|role|position|experience)?\s*that\s+(.+)$/i, 'under $1 add: $2');
  return t;
}

// Two requests in one sentence: "… and mention that I know Kafka", "…, then remove PHP"
const splitRequests = (line) => line.split(/\s*,?\s+(?:and then|and also|then)\s+|\s*,?\s+and\s+(?=(?:add|remove|delete|change|replace|set|make|put|mention|include|get rid of|update)\b)/i).filter(Boolean);

const CONTACT_FIELD = { phone: 'phone', 'phone number': 'phone', mobile: 'phone', email: 'email', 'email address': 'email', location: 'location', city: 'location', address: 'location', linkedin: 'linkedin', github: 'github' };

// ---------- "Say anything, the whole CV updates": checking an AI's whole-CV rewrite ----------
// Shared by the Claude path and the local-model (Ollama) path, so both are held to the
// same honesty rules: real jobs/schools/certifications only, and no number that wasn't
// already on the CV, asked for in the request, or clearly marked as an estimate (~).

/** Numbers as written, reduced to their digits: "2,000" and "2000" compare equal. */
function editNumbers(s) {
  return (String(s).match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]$/, '').replace(/,/g, ''));
}

/**
 * Whether an AI's whole-CV rewrite only did what was asked: no new employer, school or
 * certification the person didn't name, and no new number that isn't already on the CV,
 * in the request, or written as an estimate ("~30%").
 * @param {any} original the CV before the edit
 * @param {any} edited what the AI returned
 * @param {string} requestText the request(s) that were asked, joined together
 */
export function validateWholeCvEdit(original, edited, requestText) {
  if (!edited || typeof edited !== 'object' || !edited.name || !String(edited.name).trim()) return false;
  // never silently wipe out all experience
  if (original.experience && original.experience.length && edited.experience && !edited.experience.length) return false;
  const asked = String(requestText || '').toLowerCase();
  const was = (list) => new Set((list || []).map(x => String(x).toLowerCase()));
  const companies = was((original.experience || []).map(x => x.company));
  const schools = was((original.education || []).map(e => e.school));
  const certs = was(original.certifications || []);
  const namesOk = (edited.experience || []).every(x => companies.has(String(x.company).toLowerCase()) || asked.includes(String(x.company).toLowerCase()))
    && (edited.education || []).every(e => schools.has(String(e.school).toLowerCase()) || asked.includes(String(e.school).toLowerCase()))
    && (edited.certifications || []).every(c => certs.has(String(c).toLowerCase()) || asked.includes(String(c).toLowerCase()));
  if (!namesOk) return false;
  // every number in the result must already be on the CV, in the request, or marked "~"
  const allowed = new Set([...editNumbers(JSON.stringify(original)), ...editNumbers(requestText)]);
  const re = /(~\s?)?\b\d[\d,.]*\b/g;
  let m;
  const text = JSON.stringify(edited);
  while ((m = re.exec(text))) {
    const n = m[0].replace(/^~\s?/, '').replace(/[,.]$/, '').replace(/,/g, '');
    if (!allowed.has(n) && !m[1]) return false;
  }
  // A vague request ("make it better", "optimize this") must never come back as a new or
  // changed bullet that itself says nothing concrete — that's the model echoing the
  // instruction (or padding with filler) instead of declining it.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const origLines = new Set([
    ...(original.experience || []).flatMap(x => x.bullets || []),
    ...(original.projects || []).flatMap(p => p.bullets || []),
    original.summary
  ].map(norm));
  const newLines = [
    ...(edited.experience || []).flatMap(x => x.bullets || []),
    ...(edited.projects || []).flatMap(p => p.bullets || []),
    edited.summary
  ].filter(Boolean);
  if (newLines.some(l => !origLines.has(norm(l)) && hasNoConcreteContent(l))) return false;
  return true;
}

/**
 * Apply plain instructions to a CV. One instruction per line (or separated by ";").
 * @param {any} input the CV
 * @param {string} text the instructions
 * @param {{ whole?: boolean, job?: { title?: string, description?: string } | null }} [options]
 * @returns {{ cv: any, done: string[], unclear: string[], skills: string[], pending: string[] }}
 */
export function applyInstructions(input, text, { whole = false, job = null } = {}) {
  const cv = normalizeCV(input);
  const done = [], unclear = [], skills = [];
  // the posting's skills, when the job is known (for "add more skills into my experience")
  const jdText = job ? `${job.title || ''}\n${job.description || ''}` : '';
  const jdTerms = jdText.trim() ? TERMS.filter(t => countMatches(t.re, jdText) > 0) : [];
  // (whole: one command as written, e.g. from the local model, whose text may contain ";")
  const lines = whole ? [String(text || '').replace(CONTROL_CHARS, '').trim()].filter(Boolean)
    : String(text || '').replace(CONTROL_CHARS, '').split(/\n+|;\s*(?=[A-Za-z])/).map(l => l.trim().replace(/^[-•*\d.)\s]+(?=[A-Za-z"“])/, '')).filter(Boolean)
      .flatMap(splitRequests).slice(0, 25);
  for (const raw of lines) {
    const line = normalizeRequest(raw);
    let m;
    // "Add realistic achievements / numbers / metrics": applied to every point without a number
    if (!/["“]/.test(line) && !/^(?:remove|delete|drop)\b/i.test(line)
      && /\b(?:numbers?|metrics?|achievements?|accomplishments?|figures|quantif\w*|measurable|measured)\b/i.test(line)) {
      const list = draftNumbers(cv);
      for (const d of list) {
        let placed = false;
        for (const x of cv.experience) { const j = x.bullets.indexOf(d.original); if (j >= 0) { x.bullets[j] = d.suggested; placed = true; break; } }
        if (!placed) for (const p of cv.projects) {
          p.bullets = p.bullets && p.bullets.length ? p.bullets : [p.desc].filter(Boolean);
          const j = p.bullets.indexOf(d.original);
          if (j >= 0) { p.bullets[j] = d.suggested; p.desc = p.bullets.join(' '); placed = true; break; }
        }
        if (placed) done.push(`Achievement: "${d.suggested}"`);
      }
      if (list.length) done.unshift(`Turned ${list.length} point${list.length > 1 ? 's' : ''} into measured achievements (estimates marked ~; change any number with Replace "…" with "…")`);
      else done.push('Every point already has a number');
      // the line may also ask for certifications
      if (!/\b(?:certifications?|certificates?|certs?)\b/i.test(line)) continue;
    }
    // A general "add certifications": certifications are added only by name
    if (!/["“:]/.test(line) && /\b(?:certifications?|certificates?|certs?)\b/i.test(line) && !/^(?:remove|delete|drop)\b/i.test(line)
      && !/^add\s+.+\s+(?:to|in|under|into)\s+(?:my\s+|the\s+)?certifications?\b/i.test(line)) {
      const fits = [...new Set(Object.entries(CERTIFICATIONS_FOR).filter(([k]) => countMatches(TERMS.find(t => t.name === k)?.re || /$^/, JSON.stringify(cv)) > 0).map(([, v]) => v))].slice(0, 4);
      unclear.push(`${raw} — I only add certifications you name, so nothing untrue ends up on the CV. Write e.g. "Add certification: ${fits[0] || 'AWS Certified Developer – Associate'}" for each one you actually hold${fits.length > 1 ? `; these fit the job: ${fits.join(', ')}` : ''}.`);
      continue;
    }
    // "In the VoiceGlow project change the first point to …", "under Paywise replace the
    // 2nd bullet with …": an ordinal picks out which point, in a named job or project
    {
      const ORD = '(first|second|third|fourth|fifth|sixth|seventh|eighth|last|\\d+(?:st|nd|rd|th)?)';
      let placeTarget, ordinalWord, newTextRaw;
      if ((m = line.match(new RegExp(`^(?:in|under|at|for)\\s+(?:the\\s+|my\\s+)?(.+?)\\s+(?:project|job|role)?\\s*,?\\s*(?:change|replace|update|set|rewrite)\\s+(?:the\\s+)?${ORD}\\s+(?:point|bullet|line)\\s+(?:to|with|as)\\s*:?\\s*(.+)$`, 'i')))) {
        [, placeTarget, ordinalWord, newTextRaw] = m;
      } else if ((m = line.match(new RegExp(`^(?:change|replace|update|set|rewrite)\\s+(?:the\\s+)?${ORD}\\s+(?:point|bullet|line)\\s+(?:in|under|at|for|of)\\s+(?:the\\s+|my\\s+)?(.+?)\\s+(?:to|with|as)\\s*:?\\s*(.+)$`, 'i')))) {
        [, ordinalWord, placeTarget, newTextRaw] = m;
      }
      if (placeTarget !== undefined) {
        const place = findPlace(cv, placeTarget);
        if (!place) { unclear.push(`${raw} — I don't see a job or project called "${placeTarget}" on this CV.`); continue; }
        const list = place.kind === 'exp' ? cv.experience[place.i].bullets : cv.projects[place.i].bullets;
        const idx = ordinalIndex(ordinalWord, list.length);
        if (idx === null || idx < 0 || idx >= list.length) { unclear.push(`${raw} — ${placeName(cv, place)} only has ${list.length} point${list.length === 1 ? '' : 's'}.`); continue; }
        const newText = cleanReplacementText(newTextRaw);
        if (!newText) { unclear.push(`${raw} — I need the new text to change it to.`); continue; }
        list[idx] = newText;
        if (place.kind === 'proj') cv.projects[place.i].desc = list.join(' ');
        done.push(`Changed point ${idx + 1} of ${placeName(cv, place)} to: "${newText}"`);
        continue;
      }
    }
    // Replace "old" with "new"
    if ((m = line.match(/^(?:replace|change|swap)\s+["“'](.+?)["”']\s+(?:with|to|for|by|into)\s+["“'](.+?)["”']\.?$/i))) { replaceText(cv, m[1], m[2], done, unclear, raw); continue; }
    // Contact details
    if ((m = line.match(/^(?:add|set|change|update|put)\s+(?:my\s+)?(phone number|phone|mobile|email address|email|location|city|address|linkedin|github)\s*(?:to|as|:|is|=)?\s*(.+)$/i))) {
      const field = CONTACT_FIELD[m[1].toLowerCase()];
      cv[field] = m[2].trim().replace(/[.]$/, '');
      done.push(`Set your ${m[1].toLowerCase()} to ${cv[field]}`);
      continue;
    }
    // "headline: …", "summary: …", "phone: …"
    if ((m = line.match(/^(headline|title|summary|phone(?: number)?|mobile|email|location|linkedin|github)\s*[:=]\s*(.+)$/i))
      || (m = line.match(/^(phone(?: number)?|mobile)\s+(\+?[\d][\d\s()-]{6,})$/i))
      || (m = line.match(/^(email)\s+(\S+@\S+)$/i))
      || (m = line.match(/^(linkedin|github)\s+(\S*(?:linkedin|github)\.com\S*)$/i))) {
      const key = m[1].toLowerCase();
      const value = m[2].trim().replace(/^["“']|["”']$/g, '');
      if (key === 'headline' || key === 'title') { cv.headline = value.replace(/[.]$/, ''); done.push(`Changed your headline to "${cv.headline}"`); }
      else if (key === 'summary') { cv.summary = value; done.push('Replaced your summary'); }
      else { const field = CONTACT_FIELD[key]; cv[field] = value.replace(/[.]$/, ''); done.push(`Set your ${key} to ${cv[field]}`); }
      continue;
    }
    // "make my headline sound more senior" is a request about the headline's tone, not
    // its literal new text — only a bare value ("make my headline Senior Engineer") is a
    // direct assignment; "sound/look/read [like] …" goes to the rules below instead
    if ((m = line.match(/^(?:make\s+)?my\s+(headline|title)\s+(?:should\s+(?:be|say|read)|to\s+(?:be|say|read)|will\s+be|is|=|as)\s+(.+)$/i)) || (m = line.match(/^make\s+my\s+(headline|title)\s+(?!sound\b|look\b|read\b)(.+)$/i))) {
      cv.headline = m[2].trim().replace(/^["“']|["”'.]$/g, '');
      done.push(`Changed your headline to "${cv.headline}"`);
      continue;
    }
    if (/\b(?:more\s+senior|sound\s+senior|senior[- ]level|seniority)\b/i.test(line) && !/\bunder\b|:/.test(line)) {
      // "Senior" is checked against the title that will actually be used (the headline,
      // or the role it falls back to), not just cv.headline — otherwise a role that's
      // already "Senior Dev" becomes "Senior Senior Dev"
      const base = cv.headline || (cv.experience[0] && cv.experience[0].role) || 'Engineer';
      if (/\b(senior|lead|principal|staff|head|chief)\b/i.test(base)) done.push(`Your headline already reads senior: "${base}"`);
      else { cv.headline = `Senior ${base}`.trim(); done.push(`Changed your headline to "${cv.headline}"`); }
      continue;
    }
    // "The point about Celery should mention it handled 1M tasks a day", "add 1M tasks a day to the point about Celery"
    if ((m = line.match(/^(?:make\s+)?(?:the\s+|my\s+)?(?:point|bullet|line)\s+(?:about|on|with|mentioning)\s+(.+?)\s+(?:should\s+|to\s+|must\s+|needs?\s+to\s+)?(?:say|mention|include|show|state|add|note)s?\s+(?:that\s+)?(?:it\s+|we\s+|i\s+)?(.+)$/i))
      || ((m = line.match(/^add\s+(.+?)\s+to\s+(?:the\s+|my\s+)?(?:point|bullet|line)\s+(?:about|on|with)\s+(.+)$/i)) && (m = [m[0], m[2], m[1]]))) {
      const key = m[1].toLowerCase().replace(/[."]/g, '').trim();
      let extra = m[2].trim().replace(/[.!]+$/, '');
      const v = extra.match(/^([a-z]+)\b/i);
      if (v && PAST_TO_GERUND[v[1].toLowerCase()]) extra = PAST_TO_GERUND[v[1].toLowerCase()] + extra.slice(v[0].length);
      else if (v && GERUND_PAST[`${v[1].toLowerCase()}ing`] === undefined && /ed$/i.test(v[1])) extra = `${v[1].replace(/ed$/i, 'ing')}${extra.slice(v[0].length)}`;
      const hits = [];
      cv.experience.forEach((x, i) => x.bullets.forEach((b, j) => { if (b.toLowerCase().includes(key)) hits.push({ x, j }); }));
      // several points mention it: the first one, in the most recent job (Undo is one click away)
      if (hits.length) {
        const { x, j } = hits[0];
        x.bullets[j] = `${x.bullets[j].replace(/[.\s]+$/, '')}, ${extra}.`;
        done.push(`Changed a point under ${x.role || x.company}: "${x.bullets[j]}"`);
      } else unclear.push(`${raw} — none of your points mention "${m[1]}" yet.`);
      continue;
    }
    // "sound more like a team lead" -> headline
    if ((m = line.match(/\b(?:sound|look|read)\s+(?:more\s+)?like\s+(?:a\s+|an\s+)?(team lead|tech lead|lead|manager|principal|staff|architect|head)\b/i))) {
      const word = { 'team lead': 'Lead', 'tech lead': 'Lead', lead: 'Lead', manager: 'Lead', principal: 'Principal', staff: 'Staff', architect: 'Lead', head: 'Lead' }[m[1].toLowerCase()];
      const role = String(cv.headline || (cv.experience[0] && cv.experience[0].role) || 'Engineer').replace(/^(?:senior|sr\.?|junior|jr\.?|lead|principal|staff)\s+/i, '');
      cv.headline = `${word} ${role}`;
      done.push(`Changed your headline to "${cv.headline}"`);
      continue;
    }
    // "My phone is …", "My email is …", "I'm based in …"
    if ((m = line.match(/^(?:my\s+)?(phone number|phone|mobile|email address|email|linkedin|github)\s+(?:is|=|:)\s*(.+)$/i))) {
      const field = CONTACT_FIELD[m[1].toLowerCase()];
      cv[field] = m[2].trim().replace(/[.]$/, '');
      done.push(`Set your ${m[1].toLowerCase()} to ${cv[field]}`);
      continue;
    }
    if ((m = line.match(/^i(?:'m| am)?\s+(?:live|living|based|located|now based|now living)\s+in\s+(.+)$/i))) { cv.location = m[1].trim().replace(/[.]$/, ''); done.push(`Set your location to ${cv.location}`); continue; }
    // A job: its title, company or dates, or the whole job
    if ((m = line.match(/^(?:change|set|rename|update)\s+(?:my\s+)?(?:title|role|job title|position)\s+(?:at|in|for|with)\s+(.+?)\s+(?:to|as)\s+(.+)$/i))) {
      const place = findPlace(cv, m[1]);
      if (place && place.kind === 'exp') { cv.experience[place.i].role = m[2].trim().replace(/^["“']|["”'.]$/g, ''); done.push(`Changed your title at ${cv.experience[place.i].company || m[1]} to "${cv.experience[place.i].role}"`); }
      else unclear.push(`${raw} — I don't see a job called "${m[1]}" on this CV.`);
      continue;
    }
    if ((m = line.match(/^(?:change|set|update)\s+(?:the\s+|my\s+)?(?:dates?|period|years?)\s+(?:at|for|of|with)\s+(.+?)\s+to\s+(.+)$/i))) {
      const place = findPlace(cv, m[1]);
      if (place && place.kind === 'exp') { cv.experience[place.i].period = m[2].trim().replace(/[.]$/, ''); done.push(`Changed the dates at ${cv.experience[place.i].company || m[1]} to ${cv.experience[place.i].period}`); }
      else unclear.push(`${raw} — I don't see a job called "${m[1]}" on this CV.`);
      continue;
    }
    if ((m = line.match(/^(?:rename|change)\s+(?:the\s+)?company\s+(.+?)\s+to\s+(.+)$/i))) {
      const place = findPlace(cv, m[1]);
      if (place && place.kind === 'exp') { const was = cv.experience[place.i].company; cv.experience[place.i].company = m[2].trim().replace(/[.]$/, ''); done.push(`Renamed ${was} to ${cv.experience[place.i].company}`); }
      else unclear.push(`${raw} — I don't see a company called "${m[1]}" on this CV.`);
      continue;
    }
    if ((m = line.match(/^(?:remove|delete|drop|take out)\s+(?:the\s+|my\s+)?(?:job|role|position|experience)\s+(?:at|with|from|in)\s+(.+)$/i))) {
      const place = findPlace(cv, m[1]);
      if (place && place.kind === 'exp') { const [x] = cv.experience.splice(place.i, 1); done.push(`Removed the job ${[x.role, x.company].filter(Boolean).join(' at ')}`); }
      else unclear.push(`${raw} — I don't see a job called "${m[1]}" on this CV.`);
      continue;
    }
    if ((m = line.match(/^add\s+(?:a\s+|another\s+|my\s+)?(?:job|role|position|experience)\s*:?\s*(.+)$/i)) && parseJob(m[1])) {
      const job = parseJob(m[1]);
      const year = (job.period.match(/\d{4}/g) || []).map(Number).pop() || 0;
      const at = cv.experience.findIndex(x => Math.max(0, ...((x.period.match(/\d{4}/g) || []).map(Number)), /present|current/i.test(x.period) ? 9999 : 0) < year);
      if (at < 0) cv.experience.push(job); else cv.experience.splice(at, 0, job);
      done.push(`Added the job ${[job.role, job.company].filter(Boolean).join(' at ')}${job.period ? ` (${job.period})` : ''}. Add its points with "Under ${job.company || job.role} add: …"`);
      continue;
    }
    // A project: "Add project: ShipFast - Next.js starter kit used by 200 developers"
    if ((m = line.match(/^add\s+(?:a\s+|my\s+)?project\s*:?\s*(.+?)(?:\s*(?:\s[-–—]\s|:|\|)\s*(.+))?$/i))) {
      const desc = m[2] ? cleanPoint(m[2]) : '';
      cv.projects.unshift({ name: m[1].trim(), desc, bullets: desc ? [desc] : [], tech: TERMS.filter(t => desc && countMatches(t.re, desc) > 0 && t.category !== 'Ways of Working').map(t => t.name).slice(0, 4) });
      done.push(`Added the project ${m[1].trim()}`);
      continue;
    }
    // "Improve the points of experience", "make my Brightloop points stronger", "add more
    // experience", "update the CV to have more changes in the experiences": all vague
    // requests for "more" in the experience section, with no specific content given, are
    // handled the same safe way — tightened wording, stronger verbs and a measured result
    // in each point — rather than inventing facts or being misread as something else.
    if (!/\bsummary\b|\bheadline\b|\btitle\b/i.test(line)
      && (/^(?:improve|strengthen|enhance|polish|optimi[sz]e|refine|upgrade|tighten|boost|rework|redo|rewrite|better)\b|^make\b.*\b(?:better|stronger|more impactful|more professional|sharper|punchier)\b/i.test(line)
        && /\b(?:points?|bullets?|experiences?|achievements?|work history|jobs?|roles?|cv|resume|it|everything)\b/i.test(line)
        || (!/\bskills?\b|\bkeywords?\b|\btechnolog(?:y|ies)\b|\btools?\b/i.test(line) && /^(?:add|give|put|update|change|make)\b.*\bmore\b.*\b(?:experiences?|points?|bullets?|achievements?|work history|changes?|details?|content|information)\b/i.test(line))
        || (!/\bskills?\b|\bkeywords?\b|\btechnolog(?:y|ies)\b|\btools?\b/i.test(line) && /^(?:update|change)\b.*\b(?:cv|resume|profile)\b.*\b(?:more|some more)\b.*\b(?:experiences?|points?|bullets?|changes?|details?)\b/i.test(line)))) {
      const named = cv.experience.filter(x => x.company && x.company.length >= 3 && new RegExp(`\\b${escapeRe(x.company)}\\b`, 'i').test(line));
      const jobs = named.length ? named : cv.experience;
      const n = improvePoints(cv, jobs);
      done.push(n ? `Improved ${n} point${n > 1 ? 's' : ''}${named.length ? ` at ${joinList(named.map(x => x.company))}` : ''}: stronger openers, tighter wording and a measured result in each (estimates are marked ~; change them to your real numbers)` : 'Your points are already strong: action verbs, concise and measured');
      continue;
    }
    // "Organize / tidy up my CV": in each job, measured results first; skills without repeats
    if (/^(?:re-?organi[sz]e|organi[sz]e|tidy(?: up)?|clean(?: up)?|sort|arrange|fix the order of)\b/i.test(line) && /\b(cv|resume|points?|bullets?|experience|it|everything|skills?)\b|^(?:re-?organi[sz]e|organi[sz]e|tidy(?: up)?|clean(?: up)?)$/i.test(line)) {
      let moved = 0;
      const order = (list) => { const sorted = [...list].sort((a, b) => Number(hasMeasure(b)) - Number(hasMeasure(a))); moved += sorted.filter((x, i) => x !== list[i]).length ? 1 : 0; return sorted; };
      for (const x of cv.experience) x.bullets = order(x.bullets);
      for (const g of cv.skills) { const seen = new Set(); g.items = g.items.filter(i => { const k = i.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); }
      done.push(moved ? `Organized your CV: in ${moved} job${moved > 1 ? 's' : ''} the measured results now come first` : 'Your CV is already organized');
      continue;
    }
    // Shorter summary / points / CV
    if (/\b(?:shorten|shorter|trim|cut down|condense|concise|tighten|reduce)\b/i.test(line) && /\bsummary\b/i.test(line)) {
      const parts = cv.summary.split(/(?<=[.!?])\s+(?=[A-Z])/);
      if (parts.length > 2) { cv.summary = parts.slice(0, 2).join(' '); done.push('Shortened your summary to its first two sentences'); }
      else done.push('Your summary is already short');
      continue;
    }
    if (/\b(?:shorten|shorter|trim|condense|concise|tighten)\b/i.test(line) && /\b(?:points?|bullets?|lines|experience)\b/i.test(line)) {
      let n = 0;
      const tidy = (b) => { if (words(b) <= 22) return b; const c = b.replace(/[.\s]+$/, '').replace(VAGUE_ENDING, ''); if (c !== b.replace(/[.\s]+$/, '')) { n++; return `${c}.`; } return b; };
      for (const x of cv.experience) x.bullets = x.bullets.map(tidy);
      for (const p of cv.projects) if (p.bullets && p.bullets.length) { p.bullets = p.bullets.map(tidy); p.desc = p.bullets.join(' '); }
      done.push(n ? `Shortened ${n} long point${n > 1 ? 's' : ''} by dropping their vague endings` : 'No point had a vague ending to drop');
      continue;
    }
    if (/\b(?:one|1|single)[\s-]page\b|\bshorter cv\b|\bshorten (?:the |my )?cv\b|\bmake (?:the |my )?cv shorter\b/i.test(line)) {
      const caps = [4, 4, 4, 4];
      let cut = 0;
      cv.experience.forEach((x, i) => { const cap = caps[i] ?? 2; if (x.bullets.length > cap) { cut += x.bullets.length - cap; x.bullets = x.bullets.slice(0, cap); } });
      if (cv.projects.length > 2) { cut += cv.projects.length - 2; cv.projects = cv.projects.slice(0, 2); }
      const parts = cv.summary.split(/(?<=[.!?])\s+(?=[A-Z])/);
      if (parts.length > 3) cv.summary = parts.slice(0, 3).join(' ');
      done.push(cut ? `Made the CV shorter: kept the strongest points in each job (removed ${cut} lines)` : 'The CV is already short');
      continue;
    }
    // Headline
    if ((m = line.match(/^(?:change|set|make|update|use)\s+(?:my\s+|the\s+)?(?:headline|title|job title)\s*(?:to|as|:|=)\s*(.+)$/i))) { cv.headline = m[1].trim().replace(/^["“']|["”'.]$/g, ''); done.push(`Changed your headline to "${cv.headline}"`); continue; }
    // Summary
    // ("…summary to highlight backend work" is a request about the summary, not its new text)
    if ((m = line.match(/^(?:change|set|replace|update|rewrite)\s+(?:my\s+|the\s+)?summary\s*(?:to|with|as)?\s*:?\s*(.+)$/i))
      && !/^(?:focus|highlight|emphasi[sz]e|mention|include|be|sound|show|talk|say|reflect|cover|stress|feature|lead|read|look|more|less|better|shorter|longer|make)\b/i.test(m[1])) { cv.summary = m[1].trim().replace(/^["“']|["”']$/g, ''); done.push('Replaced your summary'); continue; }
    if ((m = line.match(/^add\s+(?:(?:a\s+)?(?:line|sentence)\s+)?to\s+(?:my\s+|the\s+)?summary\s*:?\s*(.+)$/i))) { const add = cleanPoint(m[1]); cv.summary = `${cv.summary.trim()} ${add}`.trim(); done.push(`Added to your summary: "${add}"`); continue; }
    // Skills
    if ((m = line.match(/^(?:add|include)\s+(?:these\s+|the\s+|my\s+)?(?:skills?|tools?|technolog(?:y|ies)|tech)\s*:?\s*(.+)$/i)) || (m = line.match(/^(?:add|include)\s+(.+?)\s+(?:to|in)\s+(?:my\s+|the\s+)?skills(?:\s+section)?\.?$/i))) { addSkills(cv, m[1], done, skills, unclear, raw, jdTerms); continue; }
    // Certifications and education
    if ((m = line.match(/^add\s+(?:a\s+|my\s+)?(?:certification|certificate|cert)\s*:?\s*(.+)$/i))) {
      const name = extractCertName(m[1]);
      if (looksLikeCertName(name)) { cv.certifications.push(name.replace(/[.]$/, '')); done.push(`Added the certification "${name.replace(/[.]$/, '')}"`); }
      else unclear.push(`${raw} — I only add certifications you name, so nothing untrue ends up on the CV. Write e.g. "Add certification: AWS Certified Developer – Associate" for one you actually hold.`);
      continue;
    }
    if ((m = line.match(/^add\s+(?:a\s+|my\s+)?(?:degree|education)\s*:?\s*(.+)$/i))) {
      // the documented "Degree | School | Period" or "Degree, School, Period" format, when
      // each part is actually short enough to be a field and not a stray comma in a sentence
      const parts = m[1].split(/\s*[|]\s*|\s*,\s*/).map(x => x.trim()).filter(Boolean);
      const looksClean = parts.length >= 2 && parts.length <= 3 && parts.every(p => p.split(/\s+/).length <= 6);
      const [degree, school, period] = looksClean ? parts : (() => { const d = parseDegreeText(m[1]); return [d.degree, d.school, d.period]; })();
      cv.education.push({ degree: degree || '', school: school || '', period: period || '' });
      done.push(`Added education: ${[degree, school, period].filter(Boolean).join(', ')}`);
      continue;
    }
    // Remove something
    if ((m = line.match(/^(?:remove|delete|drop|take out|get rid of)\s+(.+)$/i))) {
      const target = m[1].replace(/\s+from\s+(?:my\s+|the\s+)?(?:skills?|cv|resume|summary|experience|section|list|[A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*)*)(?:\s+(?:job|role|section|list))?\.?$/, '');
      removeThing(cv, target, done, unclear, raw);
      continue;
    }
    // Add a point: "Add a point under Brightloop: …", "Under Brightloop, add: …", "Add a point: …"
    if ((m = line.match(/^(?:add|include|put|write)\s+(?:a\s+|this\s+|the\s+|one\s+)?(?:new\s+)?(?:point|bullet|line|achievement|experience)?\s*(?:under|to|in|for|at|into)\s+(.+?)\s*(?::|\s-\s|\s–\s|\s—\s|,\s*(?:that|saying)?\s*|\s+that\s+|\s+saying\s+)\s*(.+)$/i))
      || (m = line.match(/^(?:under|in|at|for)\s+(.+?)\s*[,:]?\s+(?:add|include|write)\s*(?:a\s+)?(?:point|bullet|line)?\s*:?\s*(.+)$/i))) {
      const place = findPlace(cv, m[1]);
      let drafted;
      if (!place) unclear.push(`${raw} — I don't see a job or project called "${m[1]}" on this CV.`);
      // a real achievement is added as written; a bare topic gets a drafted, ~marked
      // point (edit the estimate); anything else is declined rather than guessed at
      else if (looksLikePoint(m[2])) addPoint(cv, place, m[2], done);
      else if ((drafted = draftPointFromTopic(m[2]))) addPoint(cv, place, drafted, done, '(a draft — edit the ~estimate to your real number)');
      else unclear.push(`${raw} — tell me what actually happened there, e.g. "under ${m[1]} add: led the migration to Kubernetes, cutting deploy time by 30%".`);
      continue;
    }
    if ((m = line.match(/^add\s+(?:a\s+|another\s+|one\s+)?(?:new\s+)?(?:point|bullet|line|achievement)\s*:?\s*(.+)$/i))) {
      let drafted;
      if (!cv.experience.length) unclear.push(`${raw} — there's no work experience on this CV yet to add a point to.`);
      else if (looksLikePoint(m[1])) addPoint(cv, bestJobFor(cv, m[1]), m[1], done);
      else if ((drafted = draftPointFromTopic(m[1]))) addPoint(cv, bestJobFor(cv, m[1]), drafted, done, '(a draft — edit the ~estimate to your real number)');
      else unclear.push(`${raw} — tell me what actually happened, e.g. "add a point: led the on-call rotation and cut incident response time by 30%".`);
      continue;
    }
    // "Replace 40,000 with 45,000", "change Paywise to Paywise Ltd" (no quotes). This only
    // fires when the "from" text is a specific snippet that's actually on the CV — never a
    // vague instruction word ("CV", "resume", "experience", "it"), so a sentence like
    // "update CV to have more changes" isn't misread as a find-and-replace request.
    if ((m = line.match(/^(?:replace|change|swap|update|edit)\s+(.+?)\s+(?:with|to|into|by)\s+(.+)$/i))
      || (m = line.match(/^swap\s+(.+?)\s+for\s+(.+)$/i))) {
      const from = m[1].trim().replace(/^["“']|["”']$/g, '');
      const META_TARGET = /^(?:cv|resume|profile|summary|headline|title|skills?|experiences?|points?|bullets?|section|everything|it|this|that|things?)$/i;
      // a plain substring check (not word-boundary regex, which trips over "+" and other
      // punctuation in things like "10,000+"): is this text actually on the CV at all?
      const foundOnCv = from.length >= 2 && JSON.stringify(cv).toLowerCase().includes(from.toLowerCase());
      // a trailing "in my dashboard point" / "under Paywise" clause says where, not what
      // the new text should say — it's dropped, never folded into the replacement
      const to = m[2].trim().replace(/^["“']|["”']$/g, '').replace(/[.]$/, '')
        .replace(/\s+(?:in|under|on|at|for)\s+(?:my\s+|the\s+)?[\w .&'-]*?\b(?:point|bullet|line|job|role|summary|experience)s?$/i, '')
        // "swap X for Y everywhere/throughout" — the trailing word says how many to change
        // (handled by replaceText already, which replaces every match), not part of Y
        .replace(/\s+(?:everywhere|throughout|globally)$/i, '');
      if (!META_TARGET.test(from) && foundOnCv) {
        replaceText(cv, from, to, done, unclear, raw);
        continue;
      }
      // else: not a real replace request — fall through to the other rules below
    }
    // "Add (some more) skills into my experience / points": woven into related points
    if (/\bskills?|keywords?|technolog(?:y|ies)|tools?\b/i.test(line) && /\b(?:experiences?|points?|bullets?|jobs?|roles?|work history)\b/i.test(line)
      && /^(?:add|put|include|insert|weave|work|mention|show|use|bring|(?:some\s+)?more\b)/i.test(line)) {
      weaveSkills(cv, jdTerms, done);
      continue;
    }
    // "Add some more skills", "make improvements in the skills section", "improve my
    // skills" — no names given: only what the CV's own points and projects already
    // demonstrate is added (never invented)
    if (!/[:]/.test(line) && /\bskills?\b/i.test(line)
      && (/^(?:add|put|include|insert)\s+(?:a\s+few\s+|some\s+|any\s+|more\s+|additional\s+|extra\s+)*(?:more\s+|additional\s+|extra\s+)?skills?\b/i.test(line)
        || /^(?:make\s+(?:some\s+|a\s+few\s+)?improvements?|improve|enhance|update|work on|strengthen|boost|better|polish)\b/i.test(line))) {
      addMissingListedSkills(cv, jdTerms, done, skills);
      continue;
    }
    // "Add Kafka", "add mentored 3 juniors to my Brightloop job", "add X to my summary"
    if ((m = line.match(/^add\s+(.+)$/i))) {
      const body = m[1].trim();
      // split at the last "to / under / in …" ("code reviews for 6 engineers to Paywise")
      const tail = body.match(/^(.+)\s+(?:under|to|in|into|for|at)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:job|role|position|section|experience|list))?\.?$/i);
      if (tail && /^skills?$/i.test(tail[2])) { addSkills(cv, tail[1], done, skills); continue; }
      if (tail && /^summary$/i.test(tail[2])) { const a = cleanPoint(tail[1]); cv.summary = `${cv.summary.trim()} ${a}`.trim(); done.push(`Added to your summary: "${a}"`); continue; }
      if (tail && /^certifications?$/i.test(tail[2])) { cv.certifications.push(tail[1].replace(/[.]$/, '')); done.push(`Added the certification "${tail[1].replace(/[.]$/, '')}"`); continue; }
      const place = tail && findPlace(cv, tail[2]);
      let drafted;
      // only add it as a real achievement; never paste the request itself onto the CV —
      // a bare topic still gets a drafted, ~marked point rather than being refused outright
      if (place && looksLikePoint(tail[1])) { addPoint(cv, place, tail[1], done); continue; }
      if (place && (drafted = draftPointFromTopic(tail[1]))) { addPoint(cv, place, drafted, done, '(a draft — edit the ~estimate to your real number)'); continue; }
      const items = body.split(/\s*(?:,|;|\band\b|&)\s*/i).filter(Boolean);
      if (items.every(it => TERMS.some(t => t.name.toLowerCase() === skillName(it).toLowerCase()))) { addSkills(cv, body, done, skills); continue; }
      // a point (something done) goes under the job it fits best; an instruction is not a point
      if (cv.experience.length && looksLikePoint(body)) { addPoint(cv, bestJobFor(cv, body), body, done); continue; }
      if (!place && cv.experience.length && (drafted = draftPointFromTopic(body))) { addPoint(cv, bestJobFor(cv, body), drafted, done, '(a draft — edit the ~estimate to your real number)'); continue; }
      if (place) { unclear.push(`${raw} — I can add real achievements to a job, but "${tail[1]}" doesn't read like something you actually did. Tell me what happened, e.g. "built…", "led…", "cut…".`); continue; }
    }
    // Plain sentence about a job on the CV: "At Brightloop I migrated 12 services to Kubernetes"
    const named = cv.experience.findIndex(x => x.company && x.company.length >= 3 && new RegExp(`\\b${escapeRe(x.company)}\\b`, 'i').test(line));
    if (named >= 0) {
      const company = escapeRe(cv.experience[named].company);
      const rest = line
        .replace(new RegExp(`^(?:at|in|for|with|while at|during my time at|when i was at|when i worked at)\\s+(?:my\\s+|the\\s+)?${company}(?:\\s+(?:job|role|position|team))?\\s*,?\\s*`, 'i'), '')
        .replace(new RegExp(`\\s+(?:at|in|for|with)\\s+(?:my\\s+|the\\s+)?${company}(?:\\s+(?:job|role|position|team))?\\b`, 'i'), '');
      // the company is only named in passing ("Brightloop was a great place to work") —
      // let it fall through to the rules below (or the final clarifying message) rather
      // than pasting the whole sentence on as if it were an achievement
      if (looksLikePoint(rest)) { addPoint(cv, { kind: 'exp', i: named }, rest, done); continue; }
    }
    // "Make my Kubernetes experience stand out", "highlight my AWS work": points about it go
    // to the top of each job and the skill to the front of its group
    if (!/\b(summary|headline|title|profile)\b/i.test(line)
      && ((m = line.match(/^(?:my\s+)?(?:experience|work|skills?)\s+(?:with|in|on)\s+(.+?)\s+should\s+(?:stand out|be highlighted|come first|be more visible|be emphasi[sz]ed)(?:\s+more)?\.?$/i))
        || (m = line.match(/^(?:highlight|emphasi[sz]e|feature|showcase|focus on|put (?:more )?focus on|bring out)\s+(?:my\s+)?(?:experience\s+(?:with|in)\s+|work\s+(?:with|in|on)\s+)?(.+?)(?:\s+(?:experience|work|skills?))?(?:\s+more)?\.?$/i))
        || (m = line.match(/^make\s+(?:my\s+)?(.+?)\s+(?:experience|work|skills?)\s+stand out(?:\s+more)?\.?$/i)))) {
      const key = skillName(m[1]).toLowerCase();
      const term = TERMS.find(t => t.name.toLowerCase() === key);
      const about = (t) => (term ? countMatches(term.re, t) > 0 : t.toLowerCase().includes(key));
      let moved = 0;
      for (const x of cv.experience) {
        const top = x.bullets.filter(about);
        if (top.length && x.bullets.indexOf(top[0]) > 0) moved++;
        x.bullets = [...top, ...x.bullets.filter(b => !about(b))];
      }
      for (const g of cv.skills) { const hit = g.items.filter(i => i.name.toLowerCase() === key); if (hit.length) g.items = [...hit, ...g.items.filter(i => i.name.toLowerCase() !== key)]; }
      const anyPoint = cv.experience.some(x => x.bullets.some(about));
      if (anyPoint) done.push(`Put your ${skillName(m[1])} work first: ${moved ? `points about it now lead in ${moved} job${moved > 1 ? 's' : ''}` : 'it already leads'}, and ${skillName(m[1])} is first in its skill group`);
      else unclear.push(`${raw} — none of your points mention ${skillName(m[1])} yet. Add one first, e.g. "Under <job> add: …".`);
      continue;
    }
    // "I don't use MongoDB anymore", "I no longer work with PHP": take the skill out
    if ((m = line.match(/^i\s+(?:don'?t|do not|no longer|never|stopped|won'?t)\s+(?:use|using|know|work with|working with|want|list)\s+(.+?)(?:\s+(?:anymore|any more|now|these days|on my cv))?\.?$/i))) {
      for (const item of m[1].split(/\s*(?:,|\band\b|&)\s*/i).filter(Boolean)) removeThing(cv, item, done, unclear, raw);
      continue;
    }
    // "I also know Kafka and Go", "I have experience with Terraform": skills
    if ((m = line.match(/^i\s+(?:also\s+)?(?:know|use|have used|have experience (?:with|in)|have worked with|am (?:good|skilled|experienced|proficient) (?:at|in|with)|can (?:use|work with))\s+(.+?)\.?$/i))) {
      const items = m[1].split(/\s*(?:,|;|\band\b|&)\s*/i).filter(Boolean);
      if (items.length && items.every(it => TERMS.some(t => t.name.toLowerCase() === skillName(it).toLowerCase()))) { addSkills(cv, m[1], done, skills); continue; }
    }
    // A sentence that starts with something done ("Built …", "I led …"): the latest job
    // (past tense only: "make it nicer" is a request, not something done)
    const first = (line.replace(/^(?:I|we)\s+(?:have\s+|also\s+)?/i, '').match(/^[A-Za-z-]+/) || [''])[0].toLowerCase().split('-').pop();
    // Ends in "-ed" is not enough on its own ("Added useful stuff here" starts that way
    // too) — looksLikePoint also rejects filler with nothing concrete named.
    if (cv.experience.length && !WEAK_OPENERS.test(line) && (PAST_VERBS.has(first) || (/[a-z]{3,}ed$/.test(first) && !/eed$/.test(first))) && looksLikePoint(line)) { addPoint(cv, bestJobFor(cv, line), line, done); continue; }
    unclear.push(`${raw} — I'm not sure what to change. Try describing exactly what you did (e.g. "led a team of 4 engineers"), or say what to add, remove or improve and where (e.g. "improve my Paywise points", "remove the point about billing").`);
  }
  // the lines themselves (without notes), for a smarter pass when Claude is set up
  // format-agnostic: every unclear message starts with the original line it's about
  const pending = lines.filter(l => unclear.some(u => u === l || u.startsWith(l)));
  return { cv, done, unclear, skills, pending };
}

// ---------- A box in each Edit CV section ----------
// What's typed in one section's box changes that section only (one job, one project, the
// summary, the skills…). The request is read in that section's terms ("improve these
// points" in a job's box improves that job), applied to a CV holding just that section,
// and only that section's fields are merged back.

const SCOPE_FIELDS = {
  personal: ['name', 'headline', 'email', 'phone', 'location', 'linkedin', 'github', 'tagline'],
  summary: ['summary'],
  skills: ['skills'],
  education: ['education'],
  certifications: ['certifications']
};

/** The part of the CV a section's box works on. */
export function scopeCV(input, scope) {
  const cv = normalizeCV(input);
  const s = scope || {};
  if (s.section === 'experience') return { ...cv, experience: cv.experience[s.index] ? [cv.experience[s.index]] : [], projects: [] };
  if (s.section === 'projects') return { ...cv, experience: [], projects: cv.projects[s.index] ? [cv.projects[s.index]] : [] };
  return { ...cv, experience: [], projects: [] };
}

/** The section's changes put back into the whole CV (nothing outside it changes). */
export function mergeScoped(input, part, scope) {
  const cv = normalizeCV(input);
  const s = scope || {};
  if (s.section === 'experience' || s.section === 'projects') {
    const list = cv[s.section].slice();
    if (part[s.section].length) list[s.index] = part[s.section][0]; else list.splice(s.index, 1);
    // skills named for a job ("add Kafka here") also reach the skills section
    return { ...cv, [s.section]: list, skills: part.skills };
  }
  const out = { ...cv };
  for (const f of SCOPE_FIELDS[s.section] || []) out[f] = part[f];
  return out;
}

const IMPROVE_WORD = /^(?:improve|strengthen|enhance|polish|optimi[sz]e|refine|tighten|rewrite|redo|rework|better|upgrade|boost|make\s+(?:it|them|these)\s+(?:better|stronger|more impactful))\b/i;

/** A request typed in a section's box, in that section's terms. */
export function scopeText(text, scope, input) {
  const cv = normalizeCV(input);
  const s = scope || {};
  const job = s.section === 'experience' ? cv.experience[s.index] : null;
  const project = s.section === 'projects' ? cv.projects[s.index] : null;
  const name = job ? (job.company || job.role) : project ? project.name : '';
  return String(text || '').split(/\n+/).map(raw => {
    const l = normalizeRequest(raw);
    if (!l) return '';
    let m;
    if (job) {
      if (/\b(?:skills?|keywords?|tools?|technolog(?:y|ies))\b/i.test(l) && /^(?:add|put|include|weave|work|mention|show|use|more|some)\b/i.test(l)) return 'add more skills into my experience';
      if (/\b(?:numbers?|metrics?|achievements?|quantif\w*|measurable)\b/i.test(l) && !/["“]/.test(l)) return 'add realistic achievements';
      if (IMPROVE_WORD.test(l) && !/["“:]/.test(l)) return 'improve the points of experience';
      if (/^(?:make\s+(?:it|them|these)\s+)?(?:shorter|shorten|trim|condense|concise|tighten)\b/i.test(l)) return 'shorten my points';
      if ((m = l.match(/^(?:change|set|update|rename)\s+(?:the\s+|my\s+)?(?:job\s+)?(?:title|role)\s+(?:to|as)\s+(.+)$/i))) return `change my title at ${name} to ${m[1]}`;
      if ((m = l.match(/^(?:change|set|update)\s+(?:the\s+|my\s+)?(?:dates?|period|years?)\s+(?:to|as)\s+(.+)$/i))) return `change the dates at ${name} to ${m[1]}`;
      if ((m = l.match(/^(?:change|rename|set)\s+(?:the\s+)?company(?:\s+name)?\s+(?:to|as)\s+(.+)$/i))) return `rename the company ${job.company} to ${m[1]}`;
      if (/^(?:remove|delete|drop)\s+(?:this|the)\s+(?:job|role|position|experience)\.?$/i.test(l)) return `remove the job at ${name}`;
      if ((m = l.match(/^(?:remove|delete|drop)\s+(?:the\s+)?(?:point|bullet|line)s?\s+(?:about|on|with|mentioning)?\s*(.+)$/i)) || (m = l.match(/^(?:remove|delete|drop)\s+(.+)$/i))) return `remove the point about ${m[1]}`;
      if ((m = l.match(/^(?:add|include|write|put)\s*(?:a\s+|another\s+)?(?:new\s+)?(?:point|bullet|line|achievement)?\s*:?\s*(.+)$/i)) && looksLikePoint(m[1])) return `add a point: ${m[1]}`;
      if (looksLikePoint(l) && !/^(?:replace|change|highlight|emphasi[sz]e|focus|make)\b/i.test(l)) return `add a point: ${l}`;
      return l;
    }
    if (project) {
      if (/^(?:remove|delete|drop)\s+(?:this|the)\s+project\.?$/i.test(l)) return `remove ${name}`;
      if ((m = l.match(/^(?:remove|delete|drop)\s+(?:the\s+)?(?:point|bullet|line)s?\s+(?:about|on|with)?\s*(.+)$/i)) || (m = l.match(/^(?:remove|delete|drop)\s+(.+)$/i))) return `remove the point about ${m[1]}`;
      if ((m = l.match(/^(?:add|include|write|put)\s*(?:a\s+)?(?:point|bullet|line)?\s*:?\s*(.+)$/i))) return `In ${name}, add: ${m[1]}`;
      if (!/^(?:replace|change)\b/i.test(l) && l.split(/\s+/).length >= 3) return `In ${name}, add: ${l}`;
      return l;
    }
    if (s.section === 'summary') {
      const said = raw.trim().replace(/^(?:please\s+|also\s+)*(?:add|include|mention|say|note|write)\s+(?:that\s+)?/i, '');
      // "I work across AI and cloud" -> "Works across AI and cloud"
      const third = (x) => x.replace(/^I\s+(?:also\s+)?(am|have|do|[a-z]+)\b/i, (w, v) => {
        const verb = v.toLowerCase();
        const out = verb === 'am' ? 'Is' : verb === 'have' ? 'Has' : verb === 'do' ? 'Does' : /(?:s|sh|ch|x|z|o)$/.test(verb) ? `${verb}es` : /[^aeiou]y$/.test(verb) ? `${verb.slice(0, -1)}ies` : `${verb}s`;
        return out[0].toUpperCase() + out.slice(1);
      });
      if (said !== raw.trim() || /^I\s/i.test(raw.trim())) return `add to summary: ${third(said)}`;
      if (/^(?:make\s+(?:it|this)\s+)?(?:shorter|shorten|trim|condense|concise|tighten)\b|^shorten\b/i.test(l)) return 'make my summary shorter';
      if ((m = l.match(/^(?:replace|change|set|rewrite)\s+(?:it|this|the summary|my summary)?\s*(?:to|with|as)\s*:?\s*(.+)$/i)) && !/^(?:focus|highlight|be|sound|mention|include)\b/i.test(m[1])) return `change summary to: ${m[1]}`;
      if ((m = l.match(/^(?:add|include|mention|say|note)\s+(?:that\s+)?(.+)$/i))) return `add to summary: ${m[1]}`;
      if ((m = l.match(/^(?:focus on|highlight|emphasi[sz]e|lead with|talk about|more about|stress)\s+(.+)$/i))) return `my summary should focus on ${m[1]}`;
      if (!IMPROVE_WORD.test(l) && l.split(/\s+/).length >= 8 && looksLikePoint(l)) return `add to summary: ${l}`;
      return /\bsummary\b/i.test(l) ? l : `${l} (in my summary)`;
    }
    if (s.section === 'skills') {
      if ((m = l.match(/^(?:remove|delete|drop)\s+(.+)$/i))) return m[1].split(/\s*(?:,|\band\b|&)\s*/i).filter(Boolean).map(x => `remove ${x}`).join('\n');
      if ((m = l.match(/^(?:add|include|put|list)\s+(?:skills?\s*:?\s*)?(.+?)(?:\s+(?:to|in)\s+(?:my\s+|the\s+)?skills)?$/i))) return `add skills: ${m[1]}`;
      if (l.split(/\s*,\s*/).length > 1 || l.split(/\s+/).length <= 3) return `add skills: ${l}`;
      return l;
    }
    if (s.section === 'certifications') {
      if (/^(?:remove|delete|drop)\b/i.test(l)) return l;
      // only a real, named certification is ever added here — a vague request ("add a
      // relevant certification") or a correction to an existing one must never be read as
      // a new (and possibly fabricated) credential
      if (/^(?:fix|correct|change|update|edit)\b/i.test(l) && !/^(?:add|include)\b/i.test(l)) return l;
      const body = (m = l.match(/^(?:add|include|list)\s*(?:a\s+)?(?:certification|certificate|cert)?\s*:?\s*(.+)$/i)) ? m[1] : l;
      const name = extractCertName(body);
      return looksLikeCertName(name) ? `add certification: ${name}` : l;
    }
    if (s.section === 'education') {
      if (/^(?:remove|delete|drop)\b/i.test(l)) return l;
      // a correction to the existing entry ("fix the typo…", "it should say…") is not a
      // new degree — never create one from a sentence like that
      if (/^(?:fix|correct|change|update|edit)\b/i.test(l) && !/^(?:add|include)\b/i.test(l)) return l;
      if ((m = l.match(/^(?:add|include)\s*(?:a\s+)?(?:degree|education)?\s*:?\s*(.+)$/i))) return `add degree: ${m[1]}`;
      return `add degree: ${l}`;
    }
    return l;
  }).filter(Boolean).join('\n');
}

/** One bullet against the XYZ formula: { x: action verb, y: measured result, z: method }. */
export function bulletChecks(text) {
  return { x: hasAction(text), y: hasMeasure(text), z: hasMethod(text) };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "Jan 2020 – Present", "2019 - 2020", "03/2021 – 05/2022" -> months since year 0
function parsePeriod(period, nowAt) {
  const raw = String(period || '').trim();
  if (!/(?:19|20)\d{2}|present|current|ongoing/i.test(raw)) return null;
  let parts = raw.split(/\s*[–—]\s*|\s+-\s+|\s+to\s+|(?<=\d{4})-(?=\s*[A-Za-z0-9])/i).filter(Boolean);
  // "Since 2021" runs to now; a single date ("2022") is one year
  if (parts.length === 1) parts = /^(since|from)\b/i.test(raw) ? [raw.replace(/^(since|from)\s*/i, ''), 'present'] : [raw, raw];
  const point = (s, isEnd) => {
    if (/present|current|now|today|date|ongoing/i.test(s)) return { at: nowAt, exact: true, current: true };
    const y = s.match(/(?:19|20)\d{2}/);
    if (!y) return null;
    const name = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    const num = s.match(/\b(\d{1,2})[/.](?:19|20)\d{2}/);
    const month = name ? MONTHS[name[1]] : num && +num[1] >= 1 && +num[1] <= 12 ? +num[1] : 0;
    return { at: +y[0] * 12 + ((month || (isEnd ? 12 : 1)) - 1), exact: Boolean(month) };
  };
  if (!parts.length) return null;
  const start = point(parts[0], false);
  const end = point(parts[parts.length - 1], true);
  return start && end && end.at >= start.at ? { start, end } : null;
}

const monthName = (at) => `${Object.keys(MONTHS)[at % 12][0].toUpperCase()}${Object.keys(MONTHS)[at % 12].slice(1)} ${Math.floor(at / 12)}`;

// The overall experience the posting requires: "5+ years of experience", "3-5 years'
// professional experience", "Experience: 5+ years". Only required lines count (not
// nice-to-haves), a range counts from its low end, and the company's own age
// ("our team has 20 years of experience") is not a requirement.
function requiredYears(description) {
  const found = [];
  for (const line of classifyLines(String(description || ''))) {
    if (line.kind !== 'required' || /\b(we|we've|we have|our|us|company|firm|agency|has been|have been)\b/i.test(line.text)) continue;
    const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?['’]?\s*(?:of\s+)?(?:[\w/-]+\s+){0,4}?(?:experience|exp\b)|\bexperience\b[^.\d]{0,25}?(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?/gi;
    for (const m of line.text.matchAll(re)) {
      const n = Number(m[1] || m[2]);
      if (n > 0 && n <= 20) found.push(n);
    }
  }
  return found.length ? Math.max(...found) : 0;
}

const TITLE_NOISE = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'head', 'chief', 'i', 'ii', 'iii', 'iv', 'remote', 'hybrid', 'contract', 'contractor', 'freelance', 'full-time', 'part-time', 'the', 'of', 'and', 'for', 'a', 'an', 'in', 'to', 'mid', 'level', 'associate', 'intern', 'independent', 'with', 'at']);
const titleWords = (t) => String(t || '').toLowerCase()
  .replace(/\bmachine[\s-]learning\b/g, 'ml').replace(/\bartificial intelligence\b/g, 'ai').replace(/\bsite reliability\b/g, 'sre').replace(/\bsre\b(?!\s+engineer)/g, 'sre engineer')
  .replace(/\b(swe|sde)\b/g, 'software engineer').replace(/\bsoftware development engineer\b/g, 'software engineer')
  .replace(/\bui\/ux|ux\/ui\b/g, 'ux').replace(/\bdev[\s-]?ops\b/g, 'devops').replace(/\bdata scientist\b/g, 'data science')
  .replace(/\bfull[\s-]?stack\b/g, 'fullstack').replace(/\bfront[\s-]?end\b/g, 'frontend').replace(/\bback[\s-]?end\b/g, 'backend')
  .replace(/\b(developer|programmer)s?\b/g, 'engineer').replace(/\bengineers\b/g, 'engineer')
  .split(/[^a-z0-9+#.]+/).filter(w => w && !TITLE_NOISE.has(w));

const cvWordCount = (cv) => words(renderText(cv));

// The sections a layout shows with the chosen style (hidden ones removed)
function visibleSections(layoutId, styles) {
  const t = CV_TEMPLATES[layoutId] || CV_TEMPLATES[DEFAULT_TEMPLATE];
  return resolveStyle(styles && styles[t.id], t.defaultStyle).sections;
}

/**
 * The recruiter review of a finished CV for one posting.
 * @param {any} cv the CV as shown (bullets as strings)
 * @param {{ title?: string, description?: string }} job
 * @param {any} profile the parsed profile the CV was built from
 * @param {any[]} matched posting requirements the candidate covers (from analyseJob)
 * @param {any[]} missing posting requirements the candidate doesn't cover
 * @param {{ before: string, after: string }[]} [rewrites] wording fixes already applied
 * @param {string[] | null} [visible] the sections the chosen layout shows (null: all)
 */
export function reviewCV(cv, { title = '', description = '' } = {}, profile, matched, missing, rewrites = [], visible = null) {
  // What a reader actually sees: sections hidden in the style bar are left out
  const shows = (id) => !visible || visible.includes(id);
  const hidden = [];
  cv = { ...cv };
  for (const [id, key, empty] of [['summary', 'summary', ''], ['skills', 'skills', []], ['experience', 'experience', []], ['projects', 'projects', []], ['education', 'education', []], ['certifications', 'certifications', []]]) {
    if (!shows(id)) { if ((cv[key] || '').length) hidden.push(id); cv[key] = empty; }
  }
  const nowDate = new Date();
  const nowAt = nowDate.getFullYear() * 12 + nowDate.getMonth();
  const required = matched.filter(t => t.required && !t.soft);
  const requiredMissing = missing.filter(t => t.required && !t.soft);
  const names = (list) => list.map(t => t.name);
  const named = (text, list) => list.filter(t => countMatches(t.re, text) > 0);

  // ---- 2. XYZ check of every bullet ----
  const bullets = cv.experience.flatMap((x, role) => x.bullets.map(text => ({
    role, where: [x.role, x.company].filter(Boolean).join(' at '), text,
    x: hasAction(text), y: hasMeasure(text), z: hasMethod(text), words: words(text)
  })));
  const quantified = bullets.filter(b => b.y).length;
  const xyzFull = bullets.filter(b => b.x && b.y && b.z).length;
  const weak = bullets.filter(b => !b.x);
  const long = bullets.filter(b => b.words > 35);

  // ---- 1. Recruiter read ----
  const reqTotal = required.length + requiredMissing.length;
  const skillsFit = reqTotal ? required.length / reqTotal : 1;
  const needYears = requiredYears(description);
  const years = yearsOfExperience((profile.experience || []).map(x => ({ ...x, period: String(x.period || '') })));
  const yearsFit = needYears ? Math.min(1, years / needYears) : 1;
  // "Full Stack Engineer - AI Products": the role is before the dash; the rest names the team
  const wanted = titleWords(cleanJobTitle(title).split(/\s+[-–—|:]\s+|\s*[(,]/)[0]);
  const held = new Set([profile.title, ...(profile.experience || []).map(x => x.role)].flatMap(titleWords));
  const titleFit = wanted.length ? wanted.filter(w => held.has(w)).length / wanted.length : 1;
  const evidenceFit = bullets.length ? Math.min(1, quantified / bullets.length / 0.6) : 0;
  const parts = [
    { label: 'Required skills', points: Math.round(55 * skillsFit), of: 55, note: reqTotal ? `${required.length} of ${reqTotal} met` : 'none specified' },
    { label: 'Experience level', points: Math.round(15 * yearsFit), of: 15, note: needYears ? `${years} of ${needYears}+ years asked` : `${years} years (no minimum stated)` },
    { label: 'Title alignment', points: Math.round(10 * titleFit), of: 10, note: titleFit >= 1 ? 'you have held this kind of role' : titleFit > 0 ? 'partly matches your past titles' : 'differs from your past titles' },
    { label: 'Measured results', points: Math.round(20 * evidenceFit), of: 20, note: `${quantified} of ${bullets.length} bullets have numbers` }
  ];
  const score = parts.reduce((n, p) => n + p.points, 0);

  // Most important first: required hard skills, then nice-to-haves, then soft skills
  const keywordOrder = [...requiredMissing, ...missing.filter(t => !t.required && !t.soft), ...missing.filter(t => t.soft)];
  const missingKeywords = keywordOrder.slice(0, 5).map(t => ({ name: t.name, required: Boolean(t.required) }));

  const flags = [];
  const flag = (severity, title, detail, fix) => flags.push({ severity, title, detail, fix });
  if (!cv.email || !cv.phone) flag(cv.email ? 70 : 95, 'Missing contact details', `No ${[!cv.email && 'email', !cv.phone && 'phone number'].filter(Boolean).join(' or ')} in the header.`, `Add ${!cv.email && !cv.phone ? 'them' : 'it'} in Edit CV (or to the profile, for every CV), or the recruiter has no quick way to reach you.`);
  if (requiredMissing.length) flag(requiredMissing.length >= 3 ? 90 : 72, `Missing ${requiredMissing.length} required skill${requiredMissing.length > 1 ? 's' : ''}`,
    `The posting requires ${joinList(names(requiredMissing).slice(0, 5))}${requiredMissing.length > 5 ? ' and more' : ''}, and the CV doesn't show ${requiredMissing.length > 1 ? 'them' : 'it'}.`,
    'If you have one, click + I have this so it is added. If not, lead with the closest related experience.');
  if (needYears && years < needYears) flag(years < needYears * 0.7 ? 85 : 62, 'Less experience than asked', `The posting asks for ${needYears}+ years; the CV shows about ${years}.`, 'Put your most senior, most relevant work first and make its results measurable.');
  if (wanted.length && titleFit === 0) flag(58, 'Job titles don\'t match the role', `None of your past titles look like "${cleanJobTitle(title)}".`, 'The headline now names this role. Make sure the first bullets of your latest role show this kind of work.');
  if (bullets.length && quantified / bullets.length < 0.4) flag(66, 'Few measurable results', `Only ${quantified} of ${bullets.length} bullets have a number; duties read weaker than results.`, 'Add how much, how many or how fast to your top bullets (see the XYZ check below).');
  // Gaps between roles and since the last one
  // Only when every role's dates can be read (a role without dates could fill the gap).
  // Time in education counts as covered.
  const spans = cv.experience.map(x => ({ x, p: parsePeriod(x.period, nowAt) }));
  const gaps = [];
  if (spans.length && spans.every(s => s.p)) {
    const covered = [...spans, ...cv.education.map(e => ({ p: parsePeriod(e.period, nowAt) })).filter(s => s.p)]
      .sort((a, b) => a.p.start.at - b.p.start.at);
    let reach = null;
    for (const s of covered) {
      if (reach && s.p.start.at - reach.at - 1 > 6) gaps.push(`${monthName(reach.at + 1)} to ${monthName(s.p.start.at - 1)}`);
      if (!reach || s.p.end.at > reach.at) reach = s.p.end;
    }
    if (reach && !reach.current && nowAt - reach.at > 6) gaps.push(`since ${monthName(reach.at + 1)}`);
  }
  if (gaps.length) flag(55, 'Employment gap', `No role covers ${joinList(gaps)}.`, 'Add a line for that time (freelance work, study, a career break) so it isn\'t left to guesswork.');
  // Internships, contracts and freelance work are short by design
  const short = spans.filter(s => s.p && !s.p.end.current && s.p.start.exact && s.p.end.exact && s.p.end.at - s.p.start.at + 1 < 12
    && !/\b(intern(ship)?|trainee|apprentice|contract(or)?|freelance|consultant|temporary|temp|part[- ]time|seasonal|summer)\b/i.test(`${s.x.role} ${s.x.company}`));
  if (short.length >= 2) flag(45, 'Several short stints', `${short.length} roles lasted under a year.`, 'Mark contract or project roles as such (e.g. "Contract") so they don\'t read as job hopping.');
  if (weak.length) flag(40, 'Duty-style bullets', `${weak.length} bullet${weak.length > 1 ? 's' : ''} open${weak.length > 1 ? '' : 's'} without an action verb, e.g. "${weak[0].text.split(/\s+/).slice(0, 6).join(' ')}…"`, 'Start each bullet with what you did: Built, Led, Cut, Launched…');
  // Measured on the six layouts' PDFs: about 430 words fill a page
  const pages = Math.max(1, Math.ceil(cvWordCount(cv) / 430));
  if (pages > 2) flag(38, 'Too long', `About ${pages} pages; recruiters rarely read past page two.`, 'Trim older roles to 2–3 bullets and hide sections this job doesn\'t need.');
  if (long.length) flag(32, 'Dense bullets', `${long.length} bullet${long.length > 1 ? 's are' : ' is'} over 35 words.`, 'Keep each bullet to one or two lines: result, number, method.');
  if (!cv.linkedin) flag(30, 'No LinkedIn', 'Most recruiters check LinkedIn before a call.', 'Add your LinkedIn URL to the header.');
  const DEGREE = /\b(bachelor'?s?|master'?s?|ph\.?\s?d|doctorate|associate'?s degree|(?:university|college|academic|undergraduate|graduate|4-year|four-year)\s+degree|degree\s+(?:in|from)|b\.s\.|m\.s\.|b\.?sc|m\.?sc|bs\/ms|bs or ms|bs in|ms in|b\.?tech|m\.?tech|mba)\b/i;
  const degreeLine = classifyLines(String(description || '')).find(l => l.kind === 'required' && DEGREE.test(l.text));
  const equivalentOk = degreeLine && /\b(or equivalent|equivalent (?:practical |professional |work )?experience|or relevant experience|or similar experience)\b/i.test(degreeLine.text);
  // Degree level: 3 doctorate, 2 master's, 1 bachelor's
  const levelOf = (t) => (/\b(ph\.?\s?d|doctor(ate)?)\b/i.test(t) ? 3
    : /\b(master'?s?|m\.?sc|m\.s\.|ms in|mba|m\.?tech|m\.?phil|m\.?eng|m\.?a\.)\b/i.test(t) ? 2
    : /\b(bachelor'?s?|b\.?sc|b\.s\.|bs in|b\.?e\.|b\.?tech|b\.?eng|b\.?a\.|bba|undergraduate)\b/i.test(t) ? 1 : 0);
  // The lowest degree the posting accepts ("Bachelor's or Master's" -> Bachelor's)
  const LEVEL_WORDS = [[1, /\b(bachelor'?s?|b\.?sc|b\.s\.|bs in|b\.?tech|undergraduate|4-year|four-year|university|college)\b/i], [2, /\b(master'?s?|m\.?sc|m\.s\.|ms in|mba|m\.?tech)\b/i], [3, /\b(ph\.?\s?d|doctorate)\b/i]];
  const needLevel = degreeLine ? (LEVEL_WORDS.find(([, re]) => re.test(degreeLine.text)) || [0])[0] : 0;
  const haveLevel = Math.max(0, ...cv.education.map(e => levelOf(`${e.degree} ${e.school}`)));
  const levelName = ['', 'a Bachelor\'s', 'a Master\'s', 'a PhD'];
  const degreeShort = cv.education.length && needLevel && haveLevel && haveLevel < needLevel;
  if (degreeShort) flag(equivalentOk ? 35 : 60, 'Degree below the requirement', `The posting asks for ${levelName[needLevel]}; the CV shows ${levelName[haveLevel]}.`, equivalentOk ? 'The posting accepts equivalent experience; make that experience obvious in your first bullets.' : 'Apply only if the rest of the CV is a strong match, and mention any further study.');
  flags.sort((a, b) => b.severity - a.severity);
  const penalised = flags.filter(f => !/required skill|Less experience|titles don|measurable results/.test(f.title));
  const penalty = Math.min(20, penalised.reduce((n, f) => n + (f.severity >= 50 ? 5 : 2), 0));
  if (penalty) parts.push({ label: 'Red flags', points: -penalty, of: 0, note: penalised.map(f => f.title[0].toLowerCase() + f.title.slice(1)).join(', ') });
  const finalScore = Math.max(0, score - penalty);

  // ---- 3. The 10-second skim: ATS and hiring manager ----
  const sections = [];
  const verdict = (section, v, reason, fix = '') => sections.push({ section, verdict: v, reason, fix });
  if (!cv.name || !cv.email) verdict('Header', 'reject', `The ATS can't read ${[!cv.name && 'a name', !cv.email && 'an email'].filter(Boolean).join(' or ')}.`, 'Add your name, email and phone as plain text at the top.');
  else if (!cv.phone) verdict('Header', 'skim', 'No phone number; recruiters usually call first.', 'Add a phone number in Edit CV, or to the profile so every CV has it.');
  else verdict('Header', 'read', `Name, headline "${cv.headline || '-'}" and contact details are clear.`, cv.linkedin ? '' : 'Add your LinkedIn URL.');
  const summaryWords = words(cv.summary || '');
  const inSummary = named(cv.summary || '', required);
  if (hidden.includes('summary')) verdict('Summary', 'skip', 'Hidden in this layout.', required.length ? 'Show it: a short summary naming this job\'s top skills is the first thing a skimmer reads.' : '');
  else if (!summaryWords) verdict('Summary', 'skip', 'There is no summary, so the reader goes straight to experience.', 'Add 2–3 sentences: the role, years of experience and your top skills for this job.');
  else if (summaryWords > 90) verdict('Summary', 'skim', `${summaryWords} words; a skimmer reads only the first line.`, 'Cut it to three sentences (under 70 words) with the job\'s top skills in the first one.');
  else if (reqTotal >= 2 && inSummary.length < Math.min(2, Math.max(1, required.length))) verdict('Summary', 'skim', 'It doesn\'t name this job\'s key skills.', required.length
    ? `Name ${joinList(names(required).slice(0, 3))} in the first sentence.`
    : `You don't list the skills this job requires (${joinList(names(requiredMissing).slice(0, 3))}); lead with your closest related experience.`);
  else verdict('Summary', 'read', `${summaryWords} words naming ${inSummary.length ? joinList(names(inSummary).slice(0, 4)) : 'your focus'}.`);
  const cov = cvCoverage(cv, matched);
  const skillCount = cv.skills.reduce((n, g) => n + g.items.length, 0);
  if (hidden.includes('skills')) verdict('Skills', 'skim', 'Hidden in this layout; the ATS has to find every keyword in your bullets.', 'Show the Skills section so keyword matching doesn\'t depend on bullets alone.');
  else if (cov.cvScore < 100) verdict('Skills', 'skim', `ATS keyword match ${cov.cvScore}%: ${joinList(cov.notShown)} ${cov.notShown.length > 1 ? 'are' : 'is'} missing from the CV.`, 'Add them in the posting\'s wording.');
  else if (reqTotal && required.length / reqTotal < 0.5) verdict('Skills', required.length ? 'skim' : 'skip', `ATS matches only ${required.length} of the ${reqTotal} required keywords; ${joinList(names(requiredMissing).slice(0, 4))} ${requiredMissing.length > 1 ? 'are' : 'is'} missing.`, 'Add any of them you really have (+ I have this); otherwise this CV is a stretch for this job.');
  else if (skillCount > 40) verdict('Skills', 'skim', `${skillCount} skills; the relevant ones get lost.`, 'Hide the skills this job doesn\'t ask for.');
  else verdict('Skills', 'read', cov.cvNeeded ? `ATS finds all ${cov.cvNeeded} required skills you have, in the posting's wording.` : 'Grouped by category, relevant skills first.');
  cv.experience.forEach((x, i) => {
    const label = `Experience: ${[x.role, x.company].filter(Boolean).join(', ')}`;
    const p = parsePeriod(x.period, nowAt);
    const top = x.bullets.slice(0, 2);
    const topRelevant = top.filter(b => named(b, matched).length).length;
    const topMeasured = top.filter(hasMeasure).length;
    if (!x.bullets.length) verdict(label, 'skip', 'No bullets, so nothing to read.', 'Add 2–3 results, or remove the role.');
    else if (i >= 2 && p && nowAt - p.end.at > 120) verdict(label, 'skip', 'Over ten years ago; a skimmer won\'t read it.', 'Keep it to one or two lines.');
    else if (i === 0 && topRelevant && topMeasured) verdict(label, 'read', 'Most recent role opens with relevant, measured results.');
    else if (i === 0) verdict(label, 'skim', `The first two bullets ${!topRelevant ? 'don\'t name this job\'s skills' : 'have no numbers'}.`, !topRelevant ? 'Open with the achievement that best matches the posting.' : 'Add a number (%, time saved, users, revenue) to the first bullet.');
    else if (topRelevant) verdict(label, 'skim', 'Read for dates, title and the first bullet.', topMeasured ? '' : 'Put a measured result in the first bullet.');
    else verdict(label, 'skip', 'Nothing in the first bullets relates to this job.', 'Cut it to 2 bullets that relate to the posting.');
  });
  if (hidden.includes('experience')) verdict('Experience', 'reject', 'Hidden in this layout, so the CV shows no work history.', 'Show the Experience section.');
  if (hidden.includes('projects')) verdict('Projects', 'skip', 'Hidden for this application.');
  else if ((cv.projects || []).length) {
    const rel = cv.projects.filter(pr => named(`${pr.name} ${pr.desc}`, matched).length);
    if (rel.length) verdict('Projects', 'skim', `${rel.length} of ${cv.projects.length} relate to this job.`, rel.length < cv.projects.length ? 'Hide the unrelated ones for this application.' : '');
    else verdict('Projects', 'skip', 'None of them use this job\'s skills.', 'Hide Projects for this job (section toggles in the style bar).');
  }
  if (degreeShort) {
    const soft = equivalentOk;
    verdict('Education', soft ? 'skim' : 'reject', `The posting asks for ${levelName[needLevel]}${soft ? ' or equivalent experience' : ''}; the CV shows ${levelName[haveLevel]}.`, soft ? 'Let your experience carry it: lead with results in this field.' : 'An ATS filter may drop the CV; apply anyway only if the rest is a strong match.');
  } else if (!cv.education.length) {
    if (hidden.includes('education') && !(degreeLine && !equivalentOk)) verdict('Education', 'skip', 'Hidden in this layout.');
    else if (degreeLine && !equivalentOk) verdict('Education', 'reject', `The posting requires a degree and ${hidden.includes('education') ? 'Education is hidden in this layout' : 'the CV lists none'}; an ATS filter may drop the CV.`, 'Add your degree, or the closest training or certification you have.');
    else if (degreeLine) verdict('Education', 'skim', 'The posting asks for a degree or equivalent experience; your experience has to carry it.', 'Add any degree, bootcamp or certification you have.');
    else verdict('Education', 'skip', 'No education listed; this posting doesn\'t require it.');
  }
  else verdict('Education', 'skim', needLevel && haveLevel >= needLevel ? `${levelName[haveLevel][0].toUpperCase()}${levelName[haveLevel].slice(1)} meets the posting's degree requirement.` : 'Checked only for a degree and school.');
  if (hidden.includes('certifications')) verdict('Certifications', 'skip', 'Hidden in this layout.');
  else if (cv.certifications.length) {
    const relevantCerts = cv.certifications.filter(c => named(c, matched).length);
    if (relevantCerts.length) verdict('Certifications', 'read', `${relevantCerts.length} of ${cv.certifications.length} match this job's stack.`);
    else verdict('Certifications', 'skim', `${cv.certifications.length} listed; none name this job's skills.`, 'List the certifications that match this job first.');
  }

  return {
    recruiter: { score: finalScore, parts, missingKeywords, redFlags: flags.slice(0, 3).map(({ severity, ...f }) => f), moreFlags: Math.max(0, flags.length - 3) },
    xyz: {
      total: bullets.length,
      full: xyzFull,
      quantified,
      // Bullets without a number, most recent role first: the ones to improve
      needNumbers: bullets.filter(b => !b.y).slice(0, 6).map(b => ({ where: b.where, text: b.text, missing: [!b.x && 'action', 'measure', !b.z && 'method'].filter(Boolean) })),
      rewrites: rewrites.slice(0, 8),
      // Points to rework, for the suggestions next to "Edit as text"
      weak: weak.slice(0, 4).map(b => ({ where: b.where, text: b.text })),
      long: long.slice(0, 4).map(b => ({ where: b.where, text: b.text, words: b.words }))
    },
    skim: { pages, sections }
  };
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
