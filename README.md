# Abusive Agent (18+)

> ⚠️ **Tylko dla dorosłych.** Plugin mówi na głos wulgarne teksty. Bez zgody 18+ (`adult_consent`) milczy. Uważaj na callach i przy udostępnianym ekranie: `/abusive-mute` wycisza go w bieżącej sesji.

Plugin do [Claude Code](https://code.claude.com), który po każdej turze agenta mówi przez głośnik jedno krótkie, wulgarne zdanie o tym, co agent właśnie zrobił, w języku, w którym piszesz:

- koniec zadania: *„Karolku, masz ten swój parser CSV, kurwa, i co teraz z nim zrobisz?”*
- czekanie na zgodę: *„Ej, zatwierdź mi to wreszcie, ty chuju, bo stoję.”*
- pytanie do ciebie, bezczynność, błąd: każde ma swój ton.

Tekst na ekranie i praca agenta zostają bez zmian. Wulgarna jest tylko warstwa głosowa (chyba że włączysz [tryb pełny](#tryb-pełny)).

## Instalacja

Wymagania: Claude Code **v2.1.287+** w terminalu albo aktualna aplikacja desktop (**v2.1.286+**), macOS, Windows albo Linux.

**W sesji Claude Code w terminalu** (otworzy okno z pytaniami):

```
/plugin install abusive-agent --marketplace karolbee/abusive-agent
```

Potwierdź `y` (dodanie marketplace'u), wybierz zakres *user* i odpowiedz na pytania: zgoda 18+, język, ostrość, jak ma się do ciebie zwracać.

**Z powłoki, jedną komendą, bez pytań:**

```bash
claude plugin install abusive-agent --marketplace karolbee/abusive-agent --config adult_consent=true --config language=auto --config intensity=ostro --config "names=Karol, Karolek, szefie"
```

Działa od następnej sesji (w otwartej sesji w terminalu: `/reload-plugins`).

**W aplikacji desktop:** kliknij **+** obok pola wiadomości → **Plugins** → **Add marketplace** → `karolbee/abusive-agent` → **Add plugin**, a w konfiguracji pluginu zaznacz zgodę 18+.

## Pytania przy instalacji

| Pytanie | Pole | Odpowiedzi | Domyślnie |
| --- | --- | --- | --- |
| Mam 18+ i zgadzam się na wulgarny język | `adult_consent` | tak / nie | nie |
| Język komunikatów | `language` | auto, polski, English, Deutsch, Español, Français, Italiano | auto (język, w którym piszesz) |
| Ostrość | `intensity` | łagodnie, ostro, hardkor | ostro |
| Jak mam się do ciebie zwracać? | `names` | imiona i ksywki po przecinku, np. `Karol, Karolek, szefie` | puste (bez imienia) |

Zmienisz je później najprościej komendą `/abusive-config`, która zadaje te pytania jeszcze raz. Działa też `/plugin configure abusive-agent@karolbee`, `/config` albo ponowne `claude plugin install ... --config klucz=wartość`.

## Komendy

| Komenda | Co robi |
| --- | --- |
| `/abusive-config` | zadaje od nowa pytania z instalacji (zgoda 18+, język, ostrość, imiona) i zapisuje odpowiedzi; zamknięte okno niczego nie zmienia |
| `/abusive-test [done\|question\|permission\|idle\|error]` | mówi od razu przykładowy tekst i pokazuje go na ekranie |
| `/abusive-mute` | wycisza / odcisza głos w bieżącej sesji (działa też w trakcie tury) |
| `/abusive-context` | włącza / wyłącza komentowanie treści zadania (tryb kontekstowy, domyślnie włączony) |
| `/abusive-idle` | włącza / wyłącza komunikat przy bezczynności |

Na stałe: `/plugin` → Installed → Disable, albo `claude plugin uninstall abusive-agent@karolbee`.

## Jak to działa

To plugin z **modem**: kod JavaScript (`hooks/register.js`), który Claude Code sam wywołuje przy zdarzeniach, więc odpala się przy każdej turze niezależnie od tego, co „pomyśli” model.

1. **Koniec tury** (`turn.complete`): mod bierze fragment twojej ostatniej prośby (do 300 znaków) i odpowiedzi agenta (do 500 znaków) i prosi **haiku** o jedno zdanie, które komentuje to zadanie. Wywołanie idzie na twoim koncie (plan albo klucz API), bez dodatkowego klucza; to kilkaset tokenów haiku na turę, limit 60 na godzinę.
2. **Zgoda na komendę, pytanie, bezczynność** (`classic.Notification`, `classic.PermissionRequest`, `AskUserQuestion`): tekst z gotowej puli, od razu i bez modelu.
3. **Mowa**: systemowy syntezator, bez płatnych usług TTS. macOS `say` (głos wybrany po języku, np. Zosia), Windows SAPI `System.Speech` (np. Microsoft Paulina), awaryjnie WinRT, Linux `espeak-ng` / `spd-say`. Program jest uruchamiany listą argumentów, bez powłoki, a na Windowsie tekst siedzi w skrypcie jako base64, więc tekst z modelu nie może wstrzyknąć komendy.
4. **Awaria**: gdy model nie odpowie, odmówi albo nie ma sieci, leci tekst z puli offline (`hooks/lib/fallback/`, polski i angielski).
5. **Granice**: prompt zabrania obelg wobec grup (pochodzenie, religia, orientacja, płeć, niepełnosprawność), treści seksualnych, gróźb i żartów o samookaleczeniu, a filtr słów zakazanych sprawdza każdy tekst przed głośnikiem.

Naraz mówi jedno zdanie; zdarzenie w trakcie mówienia zastępuje czekające. Subagenci milczą, żeby równoległa praca nie zamieniła się w chór. `claude -p`, Agent SDK i CI milczą celowo (wymusisz mowę zmienną `ABUSIVE_AGENT_FORCE=1`).

### Brak głosu w twoim języku

Mod mówi wtedy domyślnym głosem i raz pokazuje, jak doinstalować właściwy:

- **Windows:** Ustawienia → Czas i język → Mowa → Dodaj głosy
- **macOS:** Ustawienia systemowe → Dostępność → Treść mówiona → Głos systemowy → Zarządzaj głosami
- **Linux:** `apt install espeak-ng` (albo odpowiednik w twojej dystrybucji)

## Gdzie działa

| Gdzie pracujesz | Gada? |
| --- | --- |
| Claude Code w terminalu (macOS, Windows, Linux) | tak |
| Zakładka Code w aplikacji desktop, sesja lokalna | tak |
| Rozszerzenie VS Code, wtyczka JetBrains | tak |
| Remote Control z telefonu | tak, ale gada komputer |
| Sesja WSL w aplikacji desktop | nie (pluginy nie są dostępne w WSL) |
| Sesje w chmurze, czat claude.ai | nie (brak lokalnego głośnika) |
| `claude -p`, Agent SDK, CI | wyłączone celowo |

Jeśli twoja firma blokuje mody albo hooki (`allowManagedModsOnly`, `disableAllHooks`), plugin się zainstaluje, ale będzie milczał.

## Prywatność i zaufanie

- W trybie kontekstowym fragment prośby i odpowiedzi trafia do dodatkowego zapytania do haiku na twoim koncie. `/abusive-context` to wyłącza: wtedy teksty są ogólne.
- Zero telemetrii do autora.
- Mod działa z twoimi uprawnieniami. Woła tylko to, co pokazuje `claude plugin validate .`: `$.model.complete` (haiku), `$.process.run` (syntezator mowy), `$.session.messages` (twoja ostatnia wiadomość), `$.store` (język i przełączniki), `$.env.get`, `$.clock.after`, `$.ui.toast` / `$.ui.log`.
- Debug: `ABUSIVE_AGENT_DEBUG=1` wypisuje w transkrypcie każdy wypowiedziany tekst i głos.

## Tryb pełny

Styl `abusive-agent:abusive` dokłada wulgarny ton także do tekstu odpowiedzi; kod, komendy i commity zostają czyste. Włączasz go ręcznie w `/output-style`. Agent zachowuje jakość pracy i zwykle przeklina z umiarem, więc pełnej wulgarności tekstu nie gwarantujemy.

## Rozwój

```bash
claude plugin validate --strict .
claude plugin test .
claude --plugin-dir .
```

Przy każdym wydaniu podbij `version` w `.claude-plugin/plugin.json`, bo inaczej `claude plugin update abusive-agent@karolbee` uzna, że nic się nie zmieniło.

## Licencja

MIT
