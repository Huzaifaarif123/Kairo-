// Corrections memory — storage, retrieval and prompt-injection tests.
// Plain Node, no framework/dependencies, same as tailor.test.js:
// `node dashboard/corrections.test.js`. Exits non-zero on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  correctionsPath, correctionsBlock, findCorrections, listCorrections, recordCorrection, deleteCorrection
} from './corrections.js';

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); }
}
function eq(label, got, want) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; } else { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-corrections-'));
const file = path.join(dir, 'ai_corrections.json');
const fresh = () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };

// ---------- the empty and broken cases ----------
// Both sit in the path of every AI request, so neither may throw.

fresh();
eq('no file yet -> nothing stored', listCorrections(file), []);
eq('no file yet -> no prompt block', correctionsBlock(file, 'what am I missing?', 'ask'), '');

fs.writeFileSync(file, '{not json at all');
eq('corrupt file reads as empty', listCorrections(file), []);
eq('corrupt file injects nothing', correctionsBlock(file, 'what am I missing?', 'ask'), '');

fs.writeFileSync(file, JSON.stringify([{ prompt: 'only half an entry' }, { corrected: 'no prompt' }]));
eq('entries missing a half are dropped', listCorrections(file), []);

// ---------- storing ----------

fresh();
const saved = recordCorrection(file, {
  scope: 'ask',
  prompt: 'How many years of Kubernetes do I have?',
  badAnswer: 'About five years, across several roles.',
  corrected: 'Two years, at Brightloop only.'
});
ok('a saved correction gets an id', Boolean(saved.id));
eq('it is stored', listCorrections(file).length, 1);
eq('it keeps the corrected answer', listCorrections(file)[0].corrected, 'Two years, at Brightloop only.');

let threw = false;
try { recordCorrection(file, { scope: 'ask', prompt: 'a question', corrected: '  ' }); } catch { threw = true; }
ok('an empty correction is refused', threw);
eq('and nothing was written', listCorrections(file).length, 1);

// The owner's latest word replaces an earlier one for the same request, rather than the
// prompt ending up carrying two different answers to the same question.
recordCorrection(file, {
  scope: 'ask',
  prompt: 'How many years of Kubernetes do I have?',
  corrected: 'Eighteen months, at Brightloop.'
});
eq('a re-correction replaces, not stacks', listCorrections(file).length, 1);
eq('newest wins', listCorrections(file)[0].corrected, 'Eighteen months, at Brightloop.');

// Same wording, different scope: a Q&A correction must not displace a CV-edit one.
recordCorrection(file, { scope: 'edit', prompt: 'How many years of Kubernetes do I have?', corrected: 'Say eighteen months.' });
eq('scopes are kept apart', listCorrections(file).length, 2);
eq('listing filters by scope', listCorrections(file, 'edit').length, 1);

// ---------- retrieval ----------

fresh();
recordCorrection(file, { scope: 'ask', prompt: 'How long have I used Kubernetes?', corrected: 'Eighteen months.' });
recordCorrection(file, { scope: 'ask', prompt: 'What is my notice period?', corrected: 'One month.' });
recordCorrection(file, { scope: 'edit', prompt: 'Add Kubernetes to my skills', corrected: 'Put it under Infrastructure.' });

eq('the matching correction is found',
  findCorrections(file, 'how long have I used kubernetes?', 'ask').map(c => c.corrected), ['Eighteen months.']);
eq('a reworded question still matches it',
  findCorrections(file, 'how many years of kubernetes experience do I have?', 'ask').map(c => c.corrected), ['Eighteen months.']);
eq('an unrelated question matches nothing',
  findCorrections(file, 'should I include my GCSE results?', 'ask'), []);
ok("the edit scope's correction is not pulled into a question",
  !findCorrections(file, 'add kubernetes to my skills', 'ask').some(c => c.corrected === 'Put it under Infrastructure.'));
eq('...but is found in its own scope',
  findCorrections(file, 'add kubernetes to my skills', 'edit').map(c => c.corrected), ['Put it under Infrastructure.']);

// Stopwords alone must not make two unrelated requests look similar.
fresh();
recordCorrection(file, { scope: 'ask', prompt: 'What should I do about the gap in my dates?', corrected: 'Leave it; explain in the cover letter.' });
eq('shared filler words are not a match', findCorrections(file, 'What should I do about the summary?', 'ask'), []);

// At most three go in, so the block cannot crowd out the actual request.
fresh();
for (const topic of ['clusters', 'ingress', 'operators', 'autoscaling', 'manifests', 'namespaces']) {
  recordCorrection(file, { scope: 'ask', prompt: `A Kubernetes question covering ${topic}`, corrected: `The ${topic} answer` });
}
eq('six distinct prompts are six entries', listCorrections(file).length, 6);
eq('at most three are injected', findCorrections(file, 'a kubernetes question', 'ask').length, 3);

// ---------- the prompt block ----------

fresh();
recordCorrection(file, {
  scope: 'ask',
  prompt: 'How long have I used Kubernetes?',
  badAnswer: 'About five years.',
  corrected: 'Eighteen months.'
});
const block = correctionsBlock(file, 'how long have I used kubernetes?', 'ask');
ok('the block names the corrections', block.includes('PAST CORRECTIONS'));
ok('the block carries the right answer', block.includes('Eighteen months.'));
ok('the block marks the wrong one as wrong', block.includes('wrong') && block.includes('About five years.'));
eq('an unrelated question gets an empty block — the prompt is then untouched',
  correctionsBlock(file, 'what font should my CV use?', 'ask'), '');

// A correction with no recorded bad answer still injects cleanly.
fresh();
recordCorrection(file, { scope: 'ask', prompt: 'What is my notice period?', corrected: 'One month.' });
const bare = correctionsBlock(file, 'what is my notice period?', 'ask');
ok('a correction with no bad answer still injects', bare.includes('One month.'));
ok('and shows no wrong-answer line for it', !bare.includes('which was wrong'));

// ---------- deleting (the Undo behind a correction saved by mistake) ----------

fresh();
const doomed = recordCorrection(file, { scope: 'ask', prompt: 'Something I got wrong', corrected: 'The fix' });
eq('delete reports success', deleteCorrection(file, doomed.id), true);
eq('and it is gone', listCorrections(file), []);
eq('deleting an unknown id reports failure', deleteCorrection(file, 'no-such-id'), false);

// ---------- the file goes beside the profile's tracker ----------

eq('path follows the profile',
  correctionsPath({ trackerPath: '/tmp/profiles/dana/job_search_tracker.csv' }),
  path.join('/tmp/profiles/dana', 'ai_corrections.json'));

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
