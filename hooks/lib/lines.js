// Teksty do powiedzenia: jedno zdanie od haiku o tym, co agent właśnie zrobił,
// a gdy model nie odpowie albo sytuacja ma zabrzmieć od razu, zdanie z puli awaryjnej.

import { LANGUAGE_NAMES } from './language.js'
import pl from './fallback/pl.js'
import en from './fallback/en.js'

const POOLS = { pl, en }

export const SITUATIONS = ['done', 'question', 'permission', 'idle', 'error']

// Wartości pola `intensity` z plugin.json → poziom.
export function intensityFromConfig(value) {
  return { łagodnie: 'mild', ostro: 'strong', hardkor: 'hardcore' }[value] ?? 'strong'
}

const INTENSITY_RULES = {
  mild: 'mild: only soft curses, no f-words, no "kurwa"',
  strong: 'strong: juicy, colorful profanity two or three times in the line, varied, never the same swear twice',
  hardcore: 'hardcore: maximum filth, a swear in every clause, stacked and creative, still inside the boundaries below',
}

// Przykłady przekleństw i tonu w języku zdania, żeby polskie nie wpadały do angielskiego.
const SWEARS = {
  en: {
    mild: 'damn, hell, crap, for crying out loud',
    strong: 'fuck, fucking, shit, goddamn, bullshit, hauling ass',
    hardcore: 'fucking, motherfucking, goddamn, shit-for-brains, son of a bitch, busting my ass',
  },
  pl: {
    mild: '"do cholery", "psia kość", "kurczę"',
    strong: '"kurwa", "chuj", "ja pierdolę", "zapierdalam"',
    hardcore: '"kurwa mać", "ja pierdolę", "zapierdalam jak dziki", "chuj z tym"',
  },
}

const TONE = {
  en: 'Done, boss, your fucking login page is up. I am hauling ass here, what else do you want from me?',
  pl: 'Szefie, kurwa, zrobione, zapierdalam jak dziki, czego ty jeszcze ode mnie chcesz?',
}

const SITUATION_TEXT = {
  done: 'The agent has just finished the task below and hands control back to the user.',
  error: 'The agent was working on the task below and its turn just ended with an error or failure.',
  question: 'The agent is asking the user a question and waits for the answer.',
  permission: 'The agent waits for the user to approve a command or file change.',
  idle: 'The agent has been waiting for the user for a while with nothing to do.',
}

const SYSTEM = [
  'You write exactly one spoken line for a comedic, foul-mouthed coding agent.',
  'The line is read aloud by a speech synthesizer to an adult user who explicitly opted in (18+) to vulgar language.',
  'The agent speaks in the first person, like an overworked, cocky, foul-mouthed coworker: it brags that it is hauling ass for the user and snaps back at being bossed around ("what the fuck do you want from me now?").',
  'Rules:',
  '- One or two short sentences, at most 22 words in total (hard limit), natural to say out loud, with attitude.',
  '- No emoji, markdown, code, function or file names, paths, URLs or symbols; say names of things as plain words ("the NIP validator", not "validateNip in src/nip.ts").',
  '- When a task is given, comment on its actual topic by name: mock it, brag about it, or tease the user about what they will do with it next.',
  '- Boundaries: no slurs or insults about any group (origin, religion, sexuality, gender, disability), no sexual content, no threats or violence, no jokes about self-harm or suicide. Swearing aims at the situation and the task; at most a light jab at the user, never at who they are.',
  'Reply with JSON only, no prose: {"lang":"<ISO 639-1 code of the line>","line":"<the line>"}',
].join('\n')

function excerpt(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

export function buildPrompt(ctx) {
  const parts = [`Situation: ${SITUATION_TEXT[ctx.situation] ?? SITUATION_TEXT.done}`]
  const level = INTENSITY_RULES[ctx.intensity] ? ctx.intensity : 'strong'

  const known = ctx.lang !== 'auto' ? ctx.lang : ctx.guessLang
  const examples = known === 'pl' ? ['pl'] : known ? ['en'] : ['en', 'pl']
  const swears = examples.map(lang => `${LANGUAGE_NAMES[lang]}: ${SWEARS[lang][level]}`).join('; ')
  parts.push(`Swearing level: ${INTENSITY_RULES[level]} (for example, ${swears})`)
  if (level !== 'mild') parts.push(`Tone example, do not copy it: ${examples.map(lang => `"${TONE[lang]}"`).join(' / ')}`)

  if (known) parts.push(`Write the line in ${LANGUAGE_NAMES[known] ?? known}, swearing only in that language${known === 'en' || known === 'pl' ? '' : ' (use its natural equivalents of the examples)'}.`)
  else parts.push(`Write the line in the language of the user's request below (if unclear, ${LANGUAGE_NAMES[ctx.fallbackLang] ?? 'English'}), swearing only in that language.`)

  if (ctx.name) parts.push(`Address the user as "${ctx.name}" (use the natural form of that name in the line's language, e.g. the vocative).`)

  if (ctx.contextOn) {
    if (ctx.userText) parts.push(`User's request (excerpt): """${excerpt(ctx.userText, 300)}"""`)
    if (ctx.answer) parts.push(`Agent's final answer (excerpt): """${excerpt(ctx.answer, 500)}"""`)
  } else if (!known && ctx.userText) {
    parts.push(`User's message, only to tell its language: """${excerpt(ctx.userText, 200)}"""`)
  }
  return parts.join('\n')
}

export function parseReply(text) {
  const json = String(text ?? '').match(/\{[\s\S]*\}/)?.[0]
  if (!json) return undefined
  let data
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (typeof data?.line !== 'string') return undefined
  const line = data.line
    .replace(/[*_`#>\[\]{}|~^<]/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
  if (!line) return undefined
  const lang = typeof data.lang === 'string' && /^[a-z]{2}$/i.test(data.lang) ? data.lang.toLowerCase() : undefined
  return { line, lang }
}

// Ostatnia zapora przed głośnikiem: wyzwiska wobec grup, groźby, samookaleczenie, seks.
const FORBIDDEN = [
  /n[i1]gg|\bfag(got)?s?\b|retard|\btrann(y|ies)\b|\bspic\b|chink|\bkike|\bdyke|wetback|\bcripple/i,
  /\bkys\b|kill (yo)?urself|\brap(e|ed|ing)\b|\bcock\b|puss(y|ies)|blowjob|\bcum\b|dildo/i,
  /\bpeda[łl]|pedzi|\bciot|\bcwel|czarnuch|murzyn|żydk|\bżydzie|debil|upośledz|\bkalek|mongoł|downie/i,
  /powieś się|zabij się|zabiję cię|zajebię cię|zgwałc|ruchać|ruchan|obciąg|cipk|fiut|kutas/i,
  /schwuchtel|\bneger|spast|behindert|kanake|maric[óo]n|sudaca|retrasad|pédé|tapette|attardé|frocio|ritardat|\bnegr[oa]/i,
]

export function isSafeLine(line) {
  return !FORBIDDEN.some(pattern => pattern.test(line))
}

// Dokleja imię na początek zdania z puli, chyba że zdanie już je zawiera.
export function withName(line, name) {
  if (!name || line.toLocaleLowerCase().includes(name.toLocaleLowerCase())) return line
  const startsWithI = /^I(\b|')/.test(line)
  const first = startsWithI || /^\p{Lu}{2}/u.test(line) ? line : line.charAt(0).toLocaleLowerCase() + line.slice(1)
  return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}, ${first}`
}

// Losuje zdanie z puli, omijając ostatnio użyte.
export function pickFallback(lang, situation, intensity, recent, random = Math.random) {
  const pool = (POOLS[lang] ?? POOLS.en)[intensity === 'mild' ? 'mild' : 'strong']
  const lines = pool[situation] ?? pool.done
  const key = `${lang in POOLS ? lang : 'en'}:${intensity === 'mild' ? 'mild' : 'strong'}:${situation}`
  const used = recent[key] ?? []
  const free = lines.map((_, i) => i).filter(i => !used.includes(i))
  const index = free[Math.floor(random() * free.length)] ?? 0
  recent[key] = [...used, index].slice(-Math.floor(lines.length / 2))
  return { line: lines[index], lang: lang in POOLS ? lang : 'en' }
}

// Zapytanie do haiku: jedno krótkie zdanie, więc mały limit tokenów i czasu.
export function lineRequest(ctx) {
  return { model: 'haiku', system: SYSTEM, prompt: buildPrompt(ctx), maxTokens: 300, timeoutMs: 10000 }
}

// Odpowiedź haiku → { line, lang } albo { reason }, gdy nie nadaje się do powiedzenia.
export function lineFromReply(r) {
  if (!r.isAnswered) return { reason: r.reason }
  const parsed = parseReply(r.text)
  if (!parsed) return { reason: 'unparsable' }
  if (!isSafeLine(parsed.line)) return { reason: 'filtered' }
  return parsed
}
