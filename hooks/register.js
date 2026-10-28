// Abusive Agent: po każdej turze Claude Code mówi przez głośnik jedno wulgarne
// zdanie o tym, co agent zrobił. Mowa idzie przez systemowy syntezator, tekst
// pisze haiku na koncie użytkownika, a bez sieci leci pula awaryjna.
//
// Każde wywołanie `$` siedzi w tym pliku, w funkcjach najwyższego poziomu;
// lib/ to czyste funkcje bez dostępu do silnika.

import { cleanText, detectLanguage, languageChoice, languageFromConfig, lastUserText, parseNames } from './lib/language.js'
import { intensityChoice, intensityFromConfig, isSafeLine, lineFromReply, lineRequest, pickFallback, SITUATIONS, withName } from './lib/lines.js'
import {
  dataDir,
  joinPath,
  parseSayVoices,
  parseVoiceList,
  pickPiperVoice,
  piperArgv,
  piperVoices,
  playerArgvs,
  speechAttempts,
  speechOutcome,
  SPEECH_TIMEOUT_MS,
  voiceHint,
} from './lib/speak.js'

const DEDUPE_MS = 5000
const GENERATIONS_PER_HOUR = 60

const COMMANDS = [
  { name: 'abusive-test', description: 'Abusive Agent: powiedz teraz przykładowy tekst', argumentHint: '[done|question|permission|idle|error]' },
  { name: 'abusive-mute', description: 'Abusive Agent: wycisz albo odcisz głos w tej sesji', immediate: true },
  { name: 'abusive-context', description: 'Abusive Agent: włącz/wyłącz komentowanie treści zadania (tryb kontekstowy)' },
  { name: 'abusive-idle', description: 'Abusive Agent: włącz/wyłącz komunikat przy bezczynności' },
  { name: 'abusive-config', description: 'Abusive Agent: ustaw od nowa zgodę 18+, język, ostrość i imiona' },
]

export function register(on, options) {
  const s = {
    options: {},
    hasConsent: false,
    configLang: 'auto',
    intensity: 'strong',
    names: [],
    isHeadless: false,
    isMuted: false,
    isContextOn: true,
    isIdleOn: true,
    isDebug: false,
    hasToldConsent: false,
    hasPermissionRequest: false,
    isConfiguring: false,
    platform: undefined,
    isSpeaking: false,
    pending: undefined,
    lastAt: {},
    recent: {},
    hinted: new Set(),
    generatedAt: [],
  }
  applyOptions(s, options)

  on('session.start', async ($, e, next) => {
    await start($, s, e)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && !e.isAborted) trigger($, s, e.reason === 'answer' ? 'done' : 'error', e.answer)
    return next(e)
  })

  // Pytania z /abusive-config też przechodzą tędy; przy nich milczy.
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
    if (e.agentId === undefined && !s.isConfiguring) trigger($, s, 'question', '')
    return next(e)
  }).catch(($, e, next) => next(e))

  // Okno zgody daje dwa zdarzenia: PermissionRequest od razu i Notification kilka
  // sekund później. Notification mówi tylko tam, gdzie PermissionRequest nie dociera.
  on('classic.Notification', ($, e, next) => {
    if (e.agent_id === undefined) {
      if (e.notification_type === 'permission_prompt' && !s.hasPermissionRequest) trigger($, s, 'permission', '')
      if (e.notification_type === 'idle_prompt' && s.isIdleOn) trigger($, s, 'idle', '')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', ($, e, next) => {
    s.hasPermissionRequest = true
    if (e.agent_id === undefined) trigger($, s, 'permission', '')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'abusive-test' }, ($, e) => runTest($, s, e.args))

  on('command.run', { command: 'abusive-mute' }, () => {
    s.isMuted = !s.isMuted
    s.pending = undefined
    return { text: s.isMuted ? 'Abusive Agent: cisza w tej sesji. /abusive-mute włącza głos z powrotem.' : 'Abusive Agent: znowu gadam.' }
  })

  on('command.run', { command: 'abusive-context' }, $ => toggleContext($, s))

  on('command.run', { command: 'abusive-idle' }, $ => toggleIdle($, s))

  on('command.run', { command: 'abusive-config' }, $ => reconfigure($, s))
}

function applyOptions(s, options) {
  s.options = { ...options }
  s.hasConsent = options.adult_consent === true
  s.configLang = languageFromConfig(options.language)
  s.intensity = intensityFromConfig(options.intensity)
  s.names = parseNames(options.names)
}

async function start($, s, e) {
  const entrypoint = (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? ''
  const isForced = (await $.env.get('ABUSIVE_AGENT_FORCE')) === '1'
  const isCi = ['1', 'true'].includes(((await $.env.get('CI')) ?? '').toLowerCase())
  // `claude -p`, Agent SDK i CI milczą celowo; aplikacja desktop i IDE mówią.
  s.isHeadless = !isForced && (isCi || (!e.isInteractive && (entrypoint === '' || entrypoint.startsWith('sdk'))))
  s.isDebug = (await $.env.get('ABUSIVE_AGENT_DEBUG')) === '1'
  s.isContextOn = (await $.store.get('context')) !== false
  s.isIdleOn = (await $.store.get('idle')) !== false

  for (const command of COMMANDS) await $.command.register(command)

  if (!s.hasConsent && !s.isHeadless && !s.hasToldConsent) {
    s.hasToldConsent = true
    $.ui.toast('Abusive Agent milczy: brak zgody 18+. Włącz ją w konfiguracji pluginu (adult_consent).', { timeoutMs: 8000 })
  }
}

// Hook oddaje sterowanie od razu, mowa startuje w tle.
function trigger($, s, situation, answer) {
  if (!s.hasConsent || s.isHeadless || s.isMuted) return
  const now = Date.now()
  if (situation !== 'done' && now - (s.lastAt[situation] ?? 0) < DEDUPE_MS) return
  s.lastAt[situation] = now
  $.clock.after(0, () => {
    react($, s, situation, answer).catch(error => log($, s, `błąd: ${error?.message ?? error}`))
  })
}

async function react($, s, situation, answer) {
  const { line, lang, source } = await compose($, s, situation, answer)
  if (!isSafeLine(line)) return
  if (s.configLang === 'auto') await $.store.set('lastLang', lang)
  log($, s, `${situation} (${source})`)
  if (!s.isMuted) await say($, s, line, lang)
}

// Ustala, co powiedzieć: haiku dla końca tury i błędu, pula dla reszty.
async function compose($, s, situation, answer) {
  const messages = await $.session.messages().catch(() => [])
  const userText = lastUserText(messages)
  const guessLang = s.configLang === 'auto' ? detectLanguage(userText) : undefined
  const stored = await $.store.get('lastLang')
  const fallbackLang = s.configLang !== 'auto' ? s.configLang : guessLang ?? (typeof stored === 'string' ? stored : 'en')
  const name = s.names.length > 0 ? s.names[Math.floor(Math.random() * s.names.length)] : undefined

  if ((situation === 'done' || situation === 'error') && mayGenerate(s)) {
    const request = lineRequest({
      situation,
      intensity: s.intensity,
      lang: s.configLang,
      guessLang,
      fallbackLang,
      userText,
      answer: cleanText(answer),
      name,
      contextOn: s.isContextOn,
    })
    const generated = await $.model
      .complete(request)
      .then(lineFromReply)
      .catch(error => ({ reason: `refused: ${error?.message ?? error}` }))
    if (generated.line) return { line: generated.line, lang: generated.lang ?? fallbackLang, source: 'haiku' }
    log($, s, `haiku: ${generated.reason}, pula awaryjna`)
  }

  const picked = pickFallback(fallbackLang, situation, s.intensity, s.recent)
  return { line: withName(picked.line, name), lang: picked.lang, source: 'pula' }
}

function mayGenerate(s) {
  const hourAgo = Date.now() - 3600_000
  while (s.generatedAt.length > 0 && s.generatedAt[0] < hourAgo) s.generatedAt.shift()
  if (s.generatedAt.length >= GENERATIONS_PER_HOUR) return false
  s.generatedAt.push(Date.now())
  return true
}

// Naraz jedno zdanie; zdarzenie w trakcie mówienia zastępuje czekające.
async function say($, s, line, lang) {
  if (s.isSpeaking) {
    s.pending = { line, lang }
    return
  }
  s.isSpeaking = true
  try {
    s.platform ??= await detectPlatform($, s)
    const result = await speak($, s, line, lang)
    log($, s, `🔊 [${lang}, ${result.voice ?? 'domyślny głos'}] ${line}`)
    if (result.missingVoice && !s.hinted.has(lang)) {
      s.hinted.add(lang)
      $.ui.toast(voiceHint(s.platform, lang), { timeoutMs: 12000 })
    }
  } catch (error) {
    log($, s, `synteza mowy nie działa: ${error?.message ?? error}`)
  } finally {
    s.isSpeaking = false
  }
  const next = s.pending
  s.pending = undefined
  if (next && !s.isMuted) await say($, s, next.line, next.lang)
}

// Windows po zmiennej OS, macOS po działającym `say`, reszta to Linux.
async function detectPlatform($, s) {
  let platform = { os: 'linux' }
  if ((await $.env.get('OS')) === 'Windows_NT') {
    platform = { os: 'windows' }
  } else {
    const voices = await $.process
      .run(['say', '-v', '?'], { timeoutMs: 5000 })
      .then(r => (r.exitCode === 0 ? parseSayVoices(r.stdout) : undefined))
      .catch(() => undefined)
    if (voices) platform = { os: 'mac', voices }
  }
  return { ...platform, piper: await detectPiper($, s, platform.os) }
}

// Piper jest w grze, gdy w ~/.abusive-agent/voices leży choć jeden głos.
// Program: ścieżka z konfiguracji, potem piper/ obok głosów, potem `piper` z PATH.
async function detectPiper($, s, os) {
  const env = { USERPROFILE: await $.env.get('USERPROFILE'), HOME: await $.env.get('HOME') }
  const dir = dataDir(os, env)
  if (!dir) {
    log($, s, 'Piper: nie znam folderu danych użytkownika, mówię głosem systemowym')
    return undefined
  }
  const voicesDir = joinPath(os, dir, 'voices')
  const entries = await $.fs.list(voicesDir).catch(error => {
    log($, s, `Piper: nie czytam ${voicesDir} (${error?.message ?? error}), mówię głosem systemowym`)
    return []
  })
  const voices = piperVoices(entries.map(entry => entry.name))
  if (voices.length === 0) {
    if (entries.length > 0) log($, s, `Piper: w ${voicesDir} nie ma par .onnx + .onnx.json`)
    return undefined
  }
  const configured = String(s.options.piper_path ?? '').trim()
  const bundled = joinPath(os, dir, 'piper', os === 'windows' ? 'piper.exe' : 'piper')
  const path = configured || ((await $.fs.exists(bundled).catch(() => false)) ? bundled : 'piper')
  log($, s, `Piper: ${path}, głosy: ${voices.join(', ')}`)
  return { os, path, dir, voicesDir, voices, preferred: parseVoiceList(s.options.piper_voices) }
}

async function speak($, s, line, lang) {
  const platform = s.platform
  const voice = platform.piper && pickPiperVoice(platform.piper.voices, lang, platform.piper.preferred)
  if (voice) {
    const spoken = await speakWithPiper($, platform.piper, voice, line).catch(error => error)
    if (spoken === true) return { voice: `Piper ${voice}`, missingVoice: false }
    // Zepsuty Piper nie spowalnia każdej tury: do końca sesji mówi system.
    platform.piper = undefined
    log($, s, `Piper nie działa (${spoken?.message ?? spoken}), mówię głosem systemowym`)
  }

  let lastError = 'no speech synthesizer'
  for (const attempt of speechAttempts(platform, line, lang)) {
    const r = await $.process
      .run(attempt.argv, { stdin: attempt.stdin, timeoutMs: SPEECH_TIMEOUT_MS })
      .catch(error => ({ exitCode: -1, stdout: '', stderr: String(error?.message ?? error) }))
    if (r.exitCode === 0) return speechOutcome(attempt, r.stdout)
    lastError = `${attempt.argv[0]} exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`
  }
  throw new Error(lastError)
}

async function speakWithPiper($, piper, voice, line) {
  const wav = joinPath(piper.os, piper.dir, 'line.wav')
  const made = await $.process.run(piperArgv(piper, voice, wav), { stdin: line, timeoutMs: SPEECH_TIMEOUT_MS })
  if (made.exitCode !== 0) throw new Error(`piper exit ${made.exitCode}: ${made.stderr.slice(-200)}`)
  let lastError = 'no audio player'
  for (const argv of playerArgvs(piper.os, wav)) {
    const played = await $.process
      .run(argv, { timeoutMs: SPEECH_TIMEOUT_MS })
      .catch(error => ({ exitCode: -1, stderr: String(error?.message ?? error) }))
    if (played.exitCode === 0) return true
    lastError = `${argv[0]} exit ${played.exitCode}: ${played.stderr.slice(0, 200)}`
  }
  throw new Error(lastError)
}

async function runTest($, s, args) {
  if (!s.hasConsent) return { text: 'Abusive Agent milczy: brak zgody 18+ (adult_consent). Włącz ją w konfiguracji pluginu.' }
  const asked = args.trim()
  const situation = SITUATIONS.includes(asked) ? asked : 'done'
  const messages = await $.session.messages().catch(() => [])
  const answer = [...messages].reverse().find(m => m.role === 'assistant' && m.text)?.text ?? ''
  const { line, lang, source } = await compose($, s, situation, answer)
  $.clock.after(0, () => {
    say($, s, line, lang).catch(error => log($, s, `błąd: ${error?.message ?? error}`))
  })
  return { text: `🔊 (${situation}, ${lang}, ${source}) ${line}${s.isMuted ? ' — sesja wyciszona, ale test mówi' : ''}` }
}

async function toggleContext($, s) {
  s.isContextOn = !s.isContextOn
  await $.store.set('context', s.isContextOn)
  return {
    text: s.isContextOn
      ? 'Abusive Agent: komentuję treść zadania (do haiku idzie fragment prośby i odpowiedzi).'
      : 'Abusive Agent: teksty ogólne, nic z rozmowy nie trafia do dodatkowego zapytania.',
  }
}

async function toggleIdle($, s) {
  s.isIdleOn = !s.isIdleOn
  await $.store.set('idle', s.isIdleOn)
  return { text: s.isIdleOn ? 'Abusive Agent: odzywam się przy bezczynności.' : 'Abusive Agent: przy bezczynności milczę.' }
}

// Zadaje od nowa pytania z instalacji. Zapisuje dopiero po ostatniej odpowiedzi,
// więc zamknięte okno niczego nie zmienia.
async function reconfigure($, s) {
  const now = s.options
  const answers = {}
  s.isConfiguring = true
  try {
    const consent = await $.ui.ask('Masz ukończone 18 lat i zgadzasz się na wulgarny język?', {
      options: ['Tak, mam 18+', 'Nie'],
      header: 'Zgoda 18+',
    })
    answers.adult_consent = consent.startsWith('Tak')

    if (answers.adult_consent) {
      const language = await $.ui.ask(
        `Teraz: ${now.language ?? 'auto'}. W jakim języku mam gadać (inny wpisz niżej: Español, Français, Italiano)?`,
        { options: ['auto', 'English', 'polski', 'Deutsch'], header: 'Język' },
      )
      answers.language = languageChoice(language) ?? now.language ?? 'auto'

      const intensity = await $.ui.ask(`Teraz: ${now.intensity ?? 'ostro'}. Jak ostro mam przeklinać?`, {
        options: ['łagodnie', 'ostro', 'hardkor'],
        header: 'Ostrość',
      })
      answers.intensity = intensityChoice(intensity) ?? now.intensity ?? 'ostro'

      const current = parseNames(now.names).join(', ')
      const names = await $.ui.ask(
        `${current ? `Teraz: ${current}. ` : ''}Jak mam się do ciebie zwracać (imiona po przecinku wpisz niżej)?`,
        { options: current ? ['Zostaw obecne', 'Bez imion'] : ['Bez imion', 'boss'], header: 'Imiona' },
      )
      answers.names = names === 'Zostaw obecne' ? current : names === 'Bez imion' ? '' : parseNames(names).join(', ')
    }
  } catch {
    return { text: 'Abusive Agent: konfiguracja przerwana, nic nie zmieniłem.' }
  } finally {
    s.isConfiguring = false
  }

  const rows = await $.config.list().catch(() => [])
  const failed = []
  for (const [field, value] of Object.entries(answers)) {
    const key = rows.find(row => row.key.startsWith('abusive-agent') && row.key.endsWith(`.${field}`))?.key
    const result = key
      ? await $.config.set({ key, value }).catch(error => ({ deny: String(error?.message ?? error) }))
      : { deny: 'nie ma tego pola w /config' }
    if (result.deny) failed.push(`${field}: ${result.deny}`)
  }
  applyOptions(s, { ...now, ...answers })

  const summary = answers.adult_consent
    ? `zgoda 18+ jest, język: ${answers.language}, ostrość: ${answers.intensity}, imiona: ${answers.names || 'bez imion'}`
    : 'bez zgody 18+ milczę'
  const problems = failed.length > 0 ? ` Nie zapisałem na stałe: ${failed.join('; ')}.` : ''
  return { text: `Abusive Agent: ${summary}.${problems}${answers.adult_consent ? ' Sprawdź: /abusive-test' : ''}` }
}

function log($, s, text) {
  $.ui.log(text, { to: s.isDebug ? 'transcript' : 'debug' })
}
