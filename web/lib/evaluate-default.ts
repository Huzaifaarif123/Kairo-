// Fit scorer for the built-in profile (ported unchanged from the original dashboard)

export function evaluateDefault({ title = '', description = '' }: { title?: string; description?: string }) {
  const text = `${title} ${description}`.toLowerCase();

  // Comprehensive scoring engine against Hassaan Nasir's profile
  const techKeywords: Record<string, number> = {
    'python': 10, 'django': 10, 'drf': 8, 'rest': 6, 'postgresql': 10, 'postgres': 10,
    'react': 9, 'next.js': 10, 'nextjs': 10, 'typescript': 10, 'javascript': 6,
    'celery': 9, 'redis': 8, 'fastapi': 8, 'docker': 8, 'kubernetes': 8, 'aws': 9,
    'ai': 9, 'llm': 9, 'claude': 10, 'openai': 9, 'langchain': 9, 'langgraph': 9,
    'mcp': 10, 'observability': 7, 'sentry': 8, 'datadog': 8, 'grafana': 7,
    'microservices': 8, 'ci/cd': 7, 'pytest': 7, 'jest': 7, 'cypress': 7
  };

  const matchedTech: string[] = [];
  for (const kw of Object.keys(techKeywords)) {
    if (text.includes(kw)) matchedTech.push(kw);
  }

  // Normalize tech score (60 - 98 scale for reasonable matches)
  const techScore = Math.min(98, Math.max(50, Math.round(55 + (matchedTech.length * 3.5))));

  // Experience / Seniority match
  let expScore = 88;
  if (text.includes('senior') || text.includes('lead') || text.includes('staff') || text.includes('architect') || text.includes('5+') || text.includes('8+')) {
    expScore = 95;
  } else if (text.includes('principal')) {
    expScore = 88;
  } else if (text.includes('junior') || text.includes('entry')) {
    expScore = 65;
  }

  // Behavioral & Culture match
  let behavioralScore = 92;
  if (text.includes('ownership') || text.includes('distributed') || text.includes('autonomous') || text.includes('scale') || text.includes('mentor')) {
    behavioralScore = 96;
  }

  // Location & Remote match
  let locationScore = 95;
  const isRemote = text.includes('remote') || text.includes('anywhere') || text.includes('worldwide') || text.includes('work from home');
  const isUAE = text.includes('dubai') || text.includes('uae') || text.includes('abu dhabi');
  const isPakistan = text.includes('pakistan') || text.includes('lahore') || text.includes('karachi') || text.includes('islamabad');
  const isVisa = text.includes('visa') || text.includes('sponsor') || text.includes('relocation');
  if (!isRemote && !isUAE && !isPakistan && !isVisa) {
    locationScore = 70; // requires investigation
  }

  // Career alignment
  let careerScore = Math.round((techScore * 0.5) + (expScore * 0.3) + 18);
  careerScore = Math.min(97, Math.max(60, careerScore));

  // Overall weighted average
  const overallScore = Math.round((techScore * 0.35) + (expScore * 0.25) + (behavioralScore * 0.15) + (locationScore * 0.10) + (careerScore * 0.15));

  let verdict = 'Strong Fit';
  if (overallScore < 70) verdict = 'Moderate Fit';
  else if (overallScore < 80) verdict = 'Good Fit';
  else if (overallScore >= 90) verdict = 'Exceptional Match';

  const strengths = [
    `Direct 8+ years alignment with ${matchedTech.slice(0, 5).join(', ').toUpperCase() || 'Full Stack & Backend'} architecture`,
    'Proven record of high performance (38% API speedup, 55% task completion speedup)',
    'Extensive experience with AI workflows, Claude Code, and autonomous tooling'
  ];

  const suggestions = [
    'Highlight PostgreSQL optimization and query indexing metrics in the custom CV',
    'Emphasize asynchronous pipelines (Celery/Redis) and distributed microservices',
    'Mention Anthropic MCP & Claude Code certification in the opening elevator pitch'
  ];

  return {
    overallScore,
    verdict,
    breakdown: {
      technical: techScore,
      experience: expScore,
      behavioral: behavioralScore,
      location: locationScore,
      career: careerScore
    },
    matchedKeywords: matchedTech,
    strengths,
    suggestions
  };
}
