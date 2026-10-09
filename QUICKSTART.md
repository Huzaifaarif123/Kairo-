# Clone, Run & Quick Setup Guide (Localhost + CV Setup)

This guide walks you through cloning the repository, running the localhost full-stack dashboard, and uploading/setting up your CV.

---

## 1. Prerequisites

Make sure you have installed:
- **Node.js** (v18+ recommended): Check with `node -v`
- *(Optional for Scrapers)* **Bun**: `curl -fsSL https://bun.sh/install | bash`
- *(Optional for PDF compilation)* **pdflatex / TeX Live / MacTeX**: `pdflatex -v`

---

## 2. Clone the Repository

Clone the repository from GitHub and navigate into the project directory:

```bash
git clone https://github.com/Hassaan142/AIJobEngine.git
cd AIJobEngine
```

---

## 3. Run the Localhost Frontend & Backend

The dashboard is lightweight and runs with **zero npm dependencies** using native Node.js.

### Start the Server
```bash
node dashboard/server.js
```

### Access the App
Open your browser and navigate to:
```
http://localhost:3000
```

*(To run on a custom port, use `PORT=8080 node dashboard/server.js`)*

---

## 4. Setting Up & Uploading Your CV

You can set up your CV either through the codebase or via the dashboard:

### Option A: Edit the Master LaTeX CV Source
1. Navigate to the [`cv/`](file:///Users/apple/Documents/Job%20Search/cv) directory.
2. Open [`cv/main_example.tex`](file:///Users/apple/Documents/Job%20Search/cv/main_example.tex) in your editor.
3. Update your contact details, core competencies, and work experience.
4. Compile to PDF (if TeX is installed):
   ```bash
   cd cv
   pdflatex main_example.tex
   ```
5. Your compiled CV PDF will be generated inside the `cv/` directory.

### Option B: Add Pre-existing PDF / TeX CV Files
1. Copy your existing CV file (`.pdf` or `.tex`) into the `cv/` folder:
   ```bash
   cp ~/Downloads/my_resume.pdf ./cv/
   ```
2. In the Dashboard (under **CV & Template Studio** or the **Kanban Application Modal**), reference your CV file name (e.g. `cv/my_resume.pdf`).

---

## 5. Turning On the AI Features (Optional)

The dashboard runs fully without a key — job search, rule-based CV tailoring, the Kanban
tracker and the fit evaluator never call a model. A key adds the AI features: answers to
open-ended questions, AI CV edits, and the corrections loop below.

### Add a key

```bash
cp web/env.local.example web/.env.local
```

Open `web/.env.local` and paste a **Gemini** key after `GEMINI_API_KEY=` (free, no card
required — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Then restart:

```bash
node dashboard/server.js
```

The server now prints which model it picked up, so you can confirm the key took:

```
AI Job Search Dashboard running at http://localhost:3000
AI: Gemini (gemini-3.5-flash-lite)
```

If it says `AI: off — no key found`, the key didn't load: check it's in `web/.env.local`
(not `.env`), on the `GEMINI_API_KEY=` line, with no quotes or spaces around the value.

Groq and OpenRouter keys are optional fallbacks, tried only if the Gemini call fails.
`web/env.local.example` documents every supported setting.

### Correcting a wrong answer

When an AI answer isn't right, click **Wrong answer? Fix it** underneath it and write what
it should have said. That correction is saved and added to the AI's instructions for
similar questions from then on, so the same question — or a reworded one — comes back your
way, at the length you wrote.

This is not model training, and the difference matters in practice: the model is *shown*
your correction on each request rather than learning it, so a correction takes effect
immediately, and removing one takes effect immediately too. Only the closest three
corrections are ever used at once.

Everything stored is listed under **Corrections you've taught it**, below the instruction
box, where you can remove any of them. They live in `ai_corrections.json` beside the
profile's tracker and are gitignored — they contain your own questions and answers.

## 6. Dashboard Features Available Immediately

- **Overview & Metrics**: Application analytics, pipeline conversion rates, and skill match scores.
- **Live Job Search Hub**: Query jobs across platforms (Freehire, LinkedIn, Jobnet, etc.).
- **AI Fit Evaluator**: Paste any job description to compute an instant match breakdown (Technical, Seniority, Behavioral, Compensation).
- **Kanban Application Pipeline**: Drag-and-drop workflow (`Drafted` → `Applied` → `Screening` → `Interview` → `Offer` → `Closed`). Changes auto-sync to `job_search_tracker.csv`.
- **CV & Template Studio**: Targeted elevator pitches and LaTeX resume previews.
- **STAR Interview Lab**: Behavioral answers with quantified metrics and flashcards.
