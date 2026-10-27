// Wykrywanie języka użytkownika i przygotowanie tekstu rozmowy dla modelu.

export const LANGUAGES = ['pl', 'en', 'de', 'es', 'fr', 'it']

export const LANGUAGE_NAMES = {
  pl: 'Polish',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
}

// Wartości pola `language` z plugin.json → kod języka.
const FROM_CONFIG = {
  auto: 'auto',
  polski: 'pl',
  English: 'en',
  Deutsch: 'de',
  Español: 'es',
  Français: 'fr',
  Italiano: 'it',
}

export function languageFromConfig(value) {
  return FROM_CONFIG[value] ?? 'auto'
}

const LANGUAGE_ALIASES = {
  auto: 'auto',
  automatycznie: 'auto',
  pl: 'polski',
  polski: 'polski',
  polish: 'polski',
  en: 'English',
  english: 'English',
  angielski: 'English',
  de: 'Deutsch',
  deutsch: 'Deutsch',
  german: 'Deutsch',
  niemiecki: 'Deutsch',
  es: 'Español',
  español: 'Español',
  espanol: 'Español',
  spanish: 'Español',
  hiszpański: 'Español',
  fr: 'Français',
  français: 'Français',
  francais: 'Français',
  french: 'Français',
  francuski: 'Français',
  it: 'Italiano',
  italiano: 'Italiano',
  italian: 'Italiano',
  włoski: 'Italiano',
}

// Odpowiedź z /abusive-config (wybrana albo wpisana) → wartość pola `language`.
export function languageChoice(answer) {
  return LANGUAGE_ALIASES[String(answer ?? '').trim().toLocaleLowerCase()]
}

const HINTS = {
  pl: { chars: /[ąćęłńśźż]/gi, words: /\b(nie|jest|się|że|na|co|jak|czy|mi|mnie|zrób|proszę|dlaczego|tak|ale|już|teraz|tutaj|żeby|może)\b/gi },
  de: { chars: /[äöüß]/gi, words: /\b(und|nicht|ich|ist|das|die|der|bitte|mit|warum|ein|eine|auch|noch|kannst)\b/gi },
  es: { chars: /[ñ¿¡]/gi, words: /\b(que|por|para|el|los|las|una|está|cómo|qué|hola|gracias|puedes|pero|también)\b/gi },
  fr: { chars: /[àâçèêëîïôûœ]/gi, words: /\b(le|la|les|est|pas|je|vous|une|des|pourquoi|merci|avec|peux|mais|aussi)\b/gi },
  it: { chars: /[ìò]/gi, words: /\b(che|non|per|il|sono|della|perché|grazie|come|questo|puoi|anche|ancora|fare)\b/gi },
  en: { chars: /$^/g, words: /\b(the|and|is|you|please|what|why|how|this|that|with|can|make|add|fix|it)\b/gi },
}

// Zwraca kod języka, gdy heurystyka jest pewna, inaczej undefined.
export function detectLanguage(text) {
  if (!text) return undefined
  const scores = Object.entries(HINTS).map(([lang, { chars, words }]) => {
    const charHits = (text.match(chars) ?? []).length
    const wordHits = (text.match(words) ?? []).length
    return [lang, Math.min(charHits, 6) * 2 + wordHits]
  })
  scores.sort((a, b) => b[1] - a[1])
  const [best, second] = scores
  if (best[1] < 2 || best[1] - second[1] < 2) return undefined
  return best[0]
}

// Usuwa przypomnienia systemowe, znaczniki i bloki kodu, skleja białe znaki.
export function cleanText(text) {
  return String(text ?? '')
    .replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|pasted_content|artifact-view-context|ide_[a-z_]+)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>\n]{1,80}>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Ostatnia wiadomość, którą użytkownik naprawdę napisał (bez wyników narzędzi).
export function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user' || (m.toolResults?.length ?? 0) > 0) continue
    const text = cleanText(m.text)
    if (text) return text
  }
  return ''
}

// Imiona z pola `names`: „Karol, Karolek, szefie” → ['Karol', 'Karolek', 'szefie'].
export function parseNames(value) {
  return String(value ?? '')
    .split(/[,;\n]/)
    .map(name => name.replace(/[^\p{L}\p{N}' -]/gu, '').trim())
    .filter(name => name.length > 0 && name.length <= 30)
    .slice(0, 20)
}
