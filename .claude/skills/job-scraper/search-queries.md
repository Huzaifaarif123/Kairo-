# Search Queries for Job Scraper

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search`, `freehire-search`, and `remoteok-search`.

## Search Sites

Primary:
- **linkedin.com/jobs** - LinkedIn job listings (Remote, UAE, US, Europe, Worldwide)
- **freehire.me** - Aggregator for 50+ ATS platforms (Lever, Greenhouse, Ashby, Workable)
- **remoteok.com** - Fully-remote roles worldwide, tech-leaning (now has its own CLI; see `.agents/skills/remoteok-search`)

Secondary:
- Direct searches on startup/tech job boards (Wellfound, Y Combinator Jobs, Workatastartup)

## Query Categories

### Priority 1: Senior Full Stack & Python / Django Engineer

These match your strongest and most extensive engineering experience (8+ years).

```
site:linkedin.com/jobs "Senior Full Stack Engineer" Python Remote
site:linkedin.com/jobs "Senior Full Stack Developer" Django React Remote
site:linkedin.com/jobs "Lead Full Stack Engineer" TypeScript Remote
site:linkedin.com/jobs "Senior Python Engineer" PostgreSQL Celery Remote
```

### Priority 2: AI / LLM Application Engineer & Agentic Systems

These match your expertise in LangChain, LangGraph, Anthropic Claude API, OpenAI, Claude Code, and Model Context Protocol (MCP).

```
site:linkedin.com/jobs "AI Engineer" Python Remote
site:linkedin.com/jobs "LLM Engineer" LangChain LangGraph Remote
site:linkedin.com/jobs "AI Application Engineer" FastAPI Remote
site:linkedin.com/jobs "Full Stack AI Engineer" Next.js Remote
```

### Priority 3: Senior Backend Engineer & Distributed Systems

Focusing on scalable microservices, async queue pipelines, and high-throughput databases.

```
site:linkedin.com/jobs "Senior Backend Engineer" Python DRF Remote
site:linkedin.com/jobs "Senior Backend Developer" PostgreSQL Redis Remote
site:linkedin.com/jobs "Staff Backend Engineer" Python Remote
```

### Priority 4: Senior React / Next.js / TypeScript Roles

Frontend architecture, performance optimization, and real-time collaborative interfaces.

```
site:linkedin.com/jobs "Senior Frontend Engineer" Next.js TypeScript Remote
site:linkedin.com/jobs "Senior React Developer" TypeScript Remote
```

## Location Filter
- **Worldwide Remote / Global Remote**
- **United Arab Emirates (Dubai, Abu Dhabi, Hybrid/On-site)**
- **United States / UK / Europe (Remote or Visa Sponsored Relocation)**
- **Pakistan (Remote / Hybrid)**

## Language Filter
- English (Fluent / Professional) - All English-speaking roles pass.

## Date Filter
- Only include jobs posted within the last 14 days, or with an open application deadline.
