// Adapter mowy: najpierw Piper (głos neuronowy z pliku .onnx), gdy jest; potem
// systemowy: macOS `say`, Windows SAPI (System.Speech, awaryjnie WinRT), Linux
// espeak-ng albo spd-say. Wszystko przez $.process.run z listą argumentów,
// bez powłoki: tekst z modelu nie może wstrzyknąć komendy.

import { LANGUAGES } from './language.js'

const SPEAK_TIMEOUT_MS = 30000

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

function utf16le(text) {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[i * 2] = code & 255
    out[i * 2 + 1] = code >> 8
  }
  return out
}

// Skrypt PowerShell: tekst siedzi w nim jako base64 UTF-8, język z zamkniętej listy.
export function windowsScript(text, lang, { forceWinRT = false } = {}) {
  const code = LANGUAGES.includes(lang) ? lang : 'en'
  const encoded = base64(new TextEncoder().encode(text))
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$t =[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))",
    "$lang = '" + code + "'",
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    forceWinRT
      ? '$v = $null'
      : '$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $lang } | Select-Object -First 1',
    "if ($v) { $s.SelectVoice($v.VoiceInfo.Name); Write-Output ('VOICE ' + $v.VoiceInfo.Name); $s.Speak($t); exit 0 }",
    'try {',
    '  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]',
    '  $wv = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like ($lang + \'*\') } | Select-Object -First 1',
    '  if ($wv) {',
    '    Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '    $w = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer',
    '    $w.Voice = $wv',
    "    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
    '    $stream = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($w.SynthesizeTextToStreamAsync($t))).Result',
    "    $file = Join-Path ([IO.Path]::GetTempPath()) ('abusive-agent-' + [guid]::NewGuid() + '.wav')",
    '    $out = [IO.File]::Create($file)',
    '    [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream).CopyTo($out)',
    '    $out.Close()',
    "    Write-Output ('VOICE ' + $wv.DisplayName)",
    '    (New-Object System.Media.SoundPlayer $file).PlaySync()',
    '    Remove-Item $file -ErrorAction SilentlyContinue',
    '    exit 0',
    '  }',
    "} catch { Write-Output ('WINRT ' + $_.Exception.Message) }",
    "Write-Output 'NOVOICE'",
    '$s.Speak($t)',
  ].join('\n')
}

function powershellArgv(script) {
  return ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', base64(utf16le(script))]
}

export function windowsArgv(text, lang, options) {
  return powershellArgv(windowsScript(text, lang, options))
}

// Folder pluginu w danych użytkownika: tu leżą piper/ i voices/.
export function dataDir(os, env) {
  if (os === 'windows') return env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\abusive-agent` : undefined
  if (!env.HOME) return undefined
  if (os === 'mac') return `${env.HOME}/Library/Application Support/abusive-agent`
  return `${env.XDG_DATA_HOME || `${env.HOME}/.local/share`}/abusive-agent`
}

export function joinPath(os, ...parts) {
  return parts.join(os === 'windows' ? '\\' : '/')
}

// Głosy z listy plików folderu voices/: te, które mają i .onnx, i .onnx.json.
export function piperVoices(fileNames) {
  const names = new Set(fileNames)
  return fileNames
    .filter(name => name.endsWith('.onnx') && names.has(`${name}.json`))
    .map(name => name.slice(0, -'.onnx'.length))
    .sort()
}

export function parseVoiceList(text) {
  return String(text ?? '')
    .split(/[,;\n]/)
    .map(name => name.trim().replace(/\.onnx$/, ''))
    .filter(Boolean)
}

// Głos w języku zdania: pierwszy ulubiony, inaczej pierwszy z folderu.
export function pickPiperVoice(voices, lang, preferred = []) {
  const code = LANGUAGES.includes(lang) ? lang : 'en'
  const inLang = voices.filter(voice => voice.toLowerCase().startsWith(`${code}_`))
  return preferred.find(voice => inLang.includes(voice)) ?? inLang[0]
}

// Piper czyta tekst ze stdin i zapisuje WAV, który potem gra odtwarzacz systemu.
export function piperArgv(piper, voice, wav) {
  return [piper.path, '-m', joinPath(piper.os, piper.voicesDir, `${voice}.onnx`), '-f', wav]
}

export function playerArgvs(os, wav) {
  if (os === 'windows') {
    const encoded = base64(new TextEncoder().encode(wav))
    return [
      powershellArgv(
        [
          "$ErrorActionPreference = 'Stop'",
          "$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))",
          '(New-Object System.Media.SoundPlayer $p).PlaySync()',
        ].join('\n'),
      ),
    ]
  }
  if (os === 'mac') return [['afplay', wav]]
  return [
    ['paplay', wav],
    ['aplay', '-q', wav],
  ]
}

// `say -v '?'`: „Zosia               pl_PL    # Witaj, mam na imię Zosia.”
export function parseSayVoices(stdout) {
  const voices = []
  for (const line of String(stdout).split('\n')) {
    const match = line.match(/^(.+?)\s{2,}([a-z]{2,3})[_-]([A-Za-z]{2,})\s/)
    if (match) voices.push({ name: match[1].trim(), lang: match[2].toLowerCase() })
  }
  return voices
}

export function pickMacVoice(voices, lang) {
  const matching = voices.filter(v => v.lang === lang)
  return (matching.find(v => /premium|enhanced|ulepsz/i.test(v.name)) ?? matching[0])?.name
}

// Kolejne próby syntezatora dla danego systemu: argv, stdin i jak odczytać wynik.
// Uruchamia je register.js przez $.process.run; pierwsza udana kończy listę.
export function speechAttempts(platform, text, lang) {
  const code = LANGUAGES.includes(lang) ? lang : 'en'
  if (platform.os === 'windows') {
    return [{ argv: windowsArgv(text, code), kind: 'windows' }]
  }
  if (platform.os === 'mac') {
    const voice = pickMacVoice(platform.voices ?? [], code)
    return [{ argv: voice ? ['say', '-v', voice] : ['say'], stdin: text, kind: 'mac', voice }]
  }
  return [
    { argv: ['espeak-ng', '-v', code, '--stdin'], stdin: text, kind: 'linux', voice: `espeak-ng ${code}` },
    { argv: ['spd-say', '-w', '-l', code, text.replace(/^[-\s]+/, '')], kind: 'linux', voice: `spd-say ${code}` },
  ]
}

export const SPEECH_TIMEOUT_MS = SPEAK_TIMEOUT_MS

// Co się udało: głos i czy zabrakło głosu w tym języku.
export function speechOutcome(attempt, stdout) {
  if (attempt.kind === 'windows') {
    return { voice: String(stdout).match(/^VOICE (.+)$/m)?.[1]?.trim(), missingVoice: /^NOVOICE/m.test(stdout) }
  }
  if (attempt.kind === 'mac') return { voice: attempt.voice, missingVoice: attempt.voice === undefined }
  return { voice: attempt.voice, missingVoice: false }
}

const VOICE_HINTS = {
  windows: 'Ustawienia → Czas i język → Mowa → Dodaj głosy',
  mac: 'Ustawienia systemowe → Dostępność → Treść mówiona → Głos systemowy → Zarządzaj głosami',
  linux: 'zainstaluj espeak-ng (np. apt install espeak-ng)',
}

export function voiceHint(platform, lang) {
  return `Abusive Agent: brak głosu dla języka „${lang}”, mówię domyślnym. Doinstaluj: ${VOICE_HINTS[platform.os]}.`
}
