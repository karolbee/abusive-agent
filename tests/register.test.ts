import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { detectLanguage, parseNames } from '../hooks/lib/language.js'
import { isSafeLine, parseReply, withName } from '../hooks/lib/lines.js'
import pl from '../hooks/lib/fallback/pl.js'

type Run = { argv: readonly string[]; init?: { stdin?: string } }

const WINDOWS = { OS: 'Windows_NT', CLAUDE_CODE_ENTRYPOINT: 'cli' }
const CONSENT = { adult_consent: true, language: 'auto', intensity: 'ostro', names: 'Karol' }
const USAGE = { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const HAIKU_LINE = 'Karolku, masz ten swój parser CSV, kurwa, i co teraz z nim zrobisz?'

const POLISH_REQUEST = [{ role: 'user', text: 'Napraw mi ten parser CSV, bo się wywala na pustych liniach', toolUses: [] }]

type World = {
  env?: Record<string, string>
  reply?: unknown
  sayVoices?: string
  asks?: string[]
}

const FIELDS = ['adult_consent', 'language', 'intensity', 'names']

// The world beneath the plugin: each hook answers the way the engine would.
function world(on: On, { env = WINDOWS, reply, sayVoices, asks }: World = {}) {
  const runs: Run[] = []
  const prompts: string[] = []
  const toasts: string[] = []
  const questions: string[] = []
  const saved: Record<string, unknown> = {}
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: POLISH_REQUEST }))
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return { value: reply ?? { isAnswered: true, text: JSON.stringify({ lang: 'pl', line: HAIKU_LINE }), usage: USAGE } }
  })
  on('process.run', (_, e) => {
    runs.push(e)
    const stdout = e.argv[0] === 'say' && e.argv[2] === '?' ? sayVoices ?? '' : 'VOICE Microsoft Paulina Desktop'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', (_, e) => {
    if (!asks || e.tool !== 'AskUserQuestion') return { result: { answers: {} } }
    // $.ui.ask: the person picks the next answer, or closes the dialog when none is left.
    const question = e.questions[0].question
    questions.push(question)
    const answer = asks[questions.length - 1]
    if (answer === undefined) return { deny: 'closed' }
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('config.list', () => ({
    value: FIELDS.map(field => ({
      key: `abusive-agent.${field}`,
      label: field,
      kind: field === 'adult_consent' ? ('boolean' as const) : ('text' as const),
      value: '',
      provider: { plugin: 'abusive-agent', tier: 'user' as const },
      isLocked: false,
    })),
  }))
  on('config.set', (_, e) => {
    saved[e.key] = e.value
    return { value: e.value }
  })

  const flush = async () => {
    for (let i = 0; i < 5; i++) await clock.settle()
  }
  return { runs, prompts, toasts, questions, saved, flush }
}

function decodeBase64(text: string): number[] {
  const bytes: number[] = []
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let buffer = 0
  let bits = 0
  for (const char of text.replace(/=+$/, '')) {
    buffer = (buffer << 6) | digits.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }
  return bytes
}

// What a Windows run says: the line hidden in the script as base64 UTF-8.
function spokenOnWindows(run: Run): { text: string; lang: string } {
  const encoded = run.argv[run.argv.indexOf('-EncodedCommand') + 1]
  const bytes = decodeBase64(encoded)
  let script = ''
  for (let i = 0; i < bytes.length; i += 2) script += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
  const inner = script.match(/FromBase64String\('([^']+)'\)/)?.[1] ?? ''
  const text = decodeURIComponent(decodeBase64(inner).map(b => '%' + b.toString(16).padStart(2, '0')).join(''))
  const lang = script.match(/\$lang = '([a-z]{2})'/)?.[1] ?? ''
  return { text, lang }
}

const speech = (runs: Run[]) => runs.filter(r => r.argv[0] === 'powershell.exe' || (r.argv[0] === 'say' && r.argv[2] !== '?'))

const TURN = { durationMs: 4200, isAborted: false, turnId: 't1', reason: 'answer' } as const
const ANSWER = 'Naprawiłem parser CSV: puste linie są teraz pomijane, dodałem test.'

describe('zgoda 18+', () => {
  test('bez zgody panuje cisza, a test mówi dlaczego', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(w.runs).toHaveLength(0)
    expect(w.prompts).toHaveLength(0)
    expect(w.toasts.join(' ')).toContain('brak zgody 18+')
    const { text } = await $.command.run({ command: 'abusive-test' })
    expect(text).toContain('brak zgody 18+')
  })
})

describe('koniec tury', () => {
  test('mówi zdanie od haiku o tym, co agent zrobił, polskim głosem', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(w.prompts).toHaveLength(1)
    expect(w.prompts[0]).toContain('parser CSV')
    expect(w.prompts[0]).toContain('Polish')
    expect(w.prompts[0]).toContain('"Karol"')
    const said = speech(w.runs)
    expect(said).toHaveLength(1)
    expect(spokenOnWindows(said[0])).toEqual({ text: HAIKU_LINE, lang: 'pl' })
  })

  test('gdy haiku nie odpowie, leci pula awaryjna z imieniem', { options: CONSENT }, async ($, on) => {
    const w = world(on, { reply: { isAnswered: false, reason: 'aborted', usage: USAGE } })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    const { text, lang } = spokenOnWindows(speech(w.runs)[0])
    expect(lang).toBe('pl')
    expect(text.startsWith('Karol, ')).toBe(true)
    const rest = text.slice('Karol, '.length)
    expect(pl.strong.done.some((line: string) => line.charAt(0).toLowerCase() + line.slice(1) === rest)).toBe(true)
  })

  test('zdanie, które łamie granice treści, nie trafia do głośnika', { options: CONSENT }, async ($, on) => {
    const bad = { isAnswered: true, text: JSON.stringify({ lang: 'pl', line: 'Ty debilu, powieś się' }), usage: USAGE }
    const w = world(on, { reply: bad })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    const { text } = spokenOnWindows(speech(w.runs)[0])
    expect(text).not.toContain('debil')
    expect(text.startsWith('Karol, ')).toBe(true)
  })

  test('tryb kontekstowy wyłączony: do haiku nie idzie treść rozmowy', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'abusive-context' })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(w.prompts).toHaveLength(1)
    expect(w.prompts[0]).not.toContain('parser')
    expect(speech(w.runs)).toHaveLength(1)
  })

  test('subagent i przerwana tura milczą', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ ...TURN, answer: ANSWER, agentId: 'a1' })
    await $.turn.complete({ ...TURN, answer: '', isAborted: true, reason: 'aborted' })
    await w.flush()

    expect(w.runs).toHaveLength(0)
  })

  test('claude -p i SDK milczą', { options: CONSENT }, async ($, on) => {
    const w = world(on, { env: { OS: 'Windows_NT', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } })
    await $.session.start({ cwd: '/', surface: null, isInteractive: false })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(w.runs).toHaveLength(0)
  })

  test('aplikacja desktop mówi, choć nie jest REPL-em', { options: CONSENT }, async ($, on) => {
    const w = world(on, { env: { OS: 'Windows_NT', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } })
    await $.session.start({ cwd: '/', surface: null, isInteractive: false })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(speech(w.runs)).toHaveLength(1)
  })

  test('/abusive-mute wycisza sesję', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const { text } = await $.command.run({ command: 'abusive-mute' })
    expect(text).toContain('cisza')
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(w.runs).toHaveLength(0)
  })
})

describe('czekanie na użytkownika', () => {
  test('prośba o zgodę mówi od razu z puli, bez modelu', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
    await w.flush()

    expect(w.prompts).toHaveLength(0)
    const { text } = spokenOnWindows(speech(w.runs)[0])
    const rest = text.slice('Karol, '.length)
    expect(pl.strong.permission.some((line: string) => line.charAt(0).toLowerCase() + line.slice(1) === rest)).toBe(true)
  })

  test('okno zgody to jedno zdanie, choć przychodzą PermissionRequest i Notification', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'echo ok > perm-test.txt' } })
    await w.flush()
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
    await w.flush()

    expect(speech(w.runs)).toHaveLength(1)
  })

  test('pytanie AskUserQuestion mówi tekst z puli pytań', { options: CONSENT }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [
        {
          question: 'Którą bazę wybierasz?',
          header: 'Baza',
          multiSelect: false,
          options: [
            { label: 'Postgres', description: 'Relacyjna' },
            { label: 'SQLite', description: 'Plik' },
          ],
        },
      ],
    })
    await w.flush()

    const { text } = spokenOnWindows(speech(w.runs)[0])
    const rest = text.slice('Karol, '.length)
    expect(pl.strong.question.some((line: string) => line.charAt(0).toLowerCase() + line.slice(1) === rest)).toBe(true)
  })
})

describe('/abusive-config', () => {
  test('pyta od nowa i zapisuje odpowiedzi, a następne zdanie idzie po nowemu', { options: CONSENT }, async ($, on) => {
    const w = world(on, { asks: ['Tak, mam 18+', 'angielski', 'hardkor', 'Karol, boss'] })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const { text } = await $.command.run({ command: 'abusive-config' })

    expect(w.questions).toHaveLength(4)
    expect(w.saved).toEqual({
      'abusive-agent.adult_consent': true,
      'abusive-agent.language': 'English',
      'abusive-agent.intensity': 'hardkor',
      'abusive-agent.names': 'Karol, boss',
    })
    expect(text).toContain('ostrość: hardkor')

    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()
    expect(w.prompts[0]).toContain('Write the line in English')
    expect(w.prompts[0]).toContain('maximum filth')
  })

  test('zamknięte okno niczego nie zmienia', { options: CONSENT }, async ($, on) => {
    const w = world(on, { asks: ['Tak, mam 18+', 'English'] })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const { text } = await $.command.run({ command: 'abusive-config' })

    expect(w.questions).toHaveLength(3)
    expect(w.saved).toEqual({})
    expect(text).toContain('nic nie zmieniłem')
  })

  test('bez zgody zapisuje tylko jej brak i milknie', { options: CONSENT }, async ($, on) => {
    const w = world(on, { asks: ['Nie'] })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'abusive-config' })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    expect(w.saved).toEqual({ 'abusive-agent.adult_consent': false })
    expect(w.runs).toHaveLength(0)
  })
})

describe('macOS', () => {
  test('mówi przez say polskim głosem, tekst przez stdin', { options: CONSENT }, async ($, on) => {
    const voices = ['Samantha            en_US    # Hello, my name is Samantha.', 'Zosia               pl_PL    # Witaj, mam na imię Zosia.'].join('\n')
    const w = world(on, { env: { CLAUDE_CODE_ENTRYPOINT: 'cli' }, sayVoices: voices })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.complete({ ...TURN, answer: ANSWER })
    await w.flush()

    const said = speech(w.runs)
    expect(said).toHaveLength(1)
    expect(said[0].argv).toEqual(['say', '-v', 'Zosia'])
    expect(said[0].init?.stdin).toBe(HAIKU_LINE)
  })
})

describe('pomocnicze', () => {
  test('wykrywa język po znakach i słowach', () => {
    expect(detectLanguage('Napraw mi ten parser, bo się wywala')).toBe('pl')
    expect(detectLanguage('Please fix the parser, it crashes on empty lines')).toBe('en')
    expect(detectLanguage('Kannst du bitte den Parser reparieren? Er ist kaputt und das nervt')).toBe('de')
    expect(detectLanguage('ok')).toBe(undefined)
  })

  test('imiona, odpowiedź haiku i filtr', () => {
    expect(parseNames('Karol, Karolek ,szefie,,')).toEqual(['Karol', 'Karolek', 'szefie'])
    expect(withName('Skończyłem, kurwa.', 'Karolek')).toBe('Karolek, skończyłem, kurwa.')
    expect(withName('Skończyłem, kurwa.', 'szefie')).toBe('Szefie, skończyłem, kurwa.')
    expect(withName('Jedno kliknięcie, szefie. Dasz radę.', 'szefie')).toBe('Jedno kliknięcie, szefie. Dasz radę.')
    expect(withName("I'm done.", 'Karol')).toBe("Karol, I'm done.")
    expect(parseReply('```json\n{"lang":"PL","line":"**Gotowe**, kurwa 🔥"}\n```')).toEqual({ lang: 'pl', line: 'Gotowe, kurwa' })
    expect(isSafeLine('Skończyłem, kurwa, dawaj następne')).toBe(true)
    expect(isSafeLine('Ty pedale')).toBe(false)
  })
})
