# Grafik zespołu — wdrożenie na Supabase + Netlify

Ten folder to gotowy projekt (React + Vite). Zamiast pamięci artefaktu Claude używa prawdziwej bazy danych Supabase, prawdziwego logowania e-mail/hasło i aktualizacji na żywo (Realtime). Poniżej masz wszystko krok po kroku — nie musisz nic programować, tylko klikać i wklejać.

---

## Krok 1 — Załóż projekt w Supabase

1. Wejdź na [supabase.com](https://supabase.com) → **New project**.
2. Podaj nazwę (np. `grafik-zespolu`), hasło do bazy (zapisz je gdzieś) i region (najbliższy Wam, np. Frankfurt).
3. Poczekaj ok. 2 minuty, aż projekt się utworzy.

## Krok 2 — Wgraj schemat bazy danych

1. W panelu Supabase po lewej: **SQL Editor** → **New query**.
2. Otwórz plik `supabase/schema.sql` z tego projektu, skopiuj całą zawartość i wklej do edytora.
3. Kliknij **Run**. Powinno pokazać "Success. No rows returned".

To tworzy wszystkie tabele, zabezpieczenia (RLS) i włącza Realtime. Nie musisz nic w tym pliku rozumieć ani zmieniać.

## Krok 3 — Skonfiguruj logowanie e-mail

1. W panelu Supabase: **Authentication** → **Providers** → upewnij się, że **Email** jest włączony (jest domyślnie).
2. **Authentication** → **URL Configuration** → w polu **Site URL** wpisz na razie `http://localhost:5173` (zmienimy to w Kroku 6, po wdrożeniu na Netlify).
3. (Opcjonalnie, ale polecane) **Authentication** → **Providers** → **Email** → możesz wyłączyć "Confirm email", jeśli chcesz, żeby zespół mógł się logować od razu po rejestracji bez klikania w link potwierdzający w mailu. Dla testów z zaufanym, małym zespołem to wygodniejsze.

## Krok 4 — Pobierz klucze API

1. **Project Settings** (ikona zębatki) → **API**.
2. Skopiuj **Project URL** oraz **anon public key** — będą potrzebne za chwilę.

## Krok 5 — Wrzuć kod na GitHub

Netlify wdraża najwygodniej z repozytorium GitHub.

1. Załóż darmowe konto na [github.com](https://github.com), jeśli jeszcze nie masz.
2. Stwórz nowe, **prywatne** repozytorium (np. `grafik-zespolu`).
3. Wgraj do niego całą zawartość tego folderu (`team-calendar-supabase`) — najprościej przez przeciągnięcie plików w interfejsie GitHub ("uploading an existing file") albo przez `git`:
   ```
   cd team-calendar-supabase
   git init
   git add .
   git commit -m "Grafik zespołu"
   git branch -M main
   git remote add origin https://github.com/TWOJ-LOGIN/grafik-zespolu.git
   git push -u origin main
   ```

## Krok 6 — Wdróż na Netlify

1. Wejdź na [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**.
2. Wybierz GitHub, zaloguj się, wskaż repozytorium `grafik-zespolu`.
3. Netlify sam wykryje `netlify.toml` (build command: `npm run build`, publish: `dist`) — nic nie zmieniaj.
4. **Zanim klikniesz Deploy**, rozwiń **Environment variables** i dodaj dwie zmienne:
   - `VITE_SUPABASE_URL` = (Project URL z Kroku 4)
   - `VITE_SUPABASE_ANON_KEY` = (anon public key z Kroku 4)
5. Kliknij **Deploy site**. Po 1–2 minutach dostaniesz link typu `https://coś-tam.netlify.app`.
6. (Polecane) W **Site settings** → **Change site name** ustaw czytelniejszy adres, np. `grafik-nazwafirmy.netlify.app`.

## Krok 7 — Dopnij adres w Supabase

Wróć do Supabase → **Authentication** → **URL Configuration**:
- **Site URL**: wklej swój adres z Netlify (np. `https://grafik-nazwafirmy.netlify.app`).
- **Redirect URLs**: dodaj ten sam adres (dokładnie taki sam, bez `/` na końcu).

Bez tego linki resetu hasła w mailach będą prowadzić donikąd.

## Krok 8 — Pierwsze uruchomienie

1. Wejdź na swój adres Netlify.
2. Zarejestruj się jako pierwsza osoba — **automatycznie zostajesz administratorem** i masz od razu dostęp.
3. Wyślij link do reszty zespołu (max 5 osób). Każda kolejna osoba po rejestracji czeka na Twoje zatwierdzenie w **Panel admina → Zespół**.

---

## Jak to teraz działa (różnice względem wersji testowej w Claude)

- **Logowanie**: prawdziwy e-mail + hasło (Supabase Auth), zamiast imienia i PIN-u.
- **"Nie pamiętam hasła"**: prawdziwy e-mail z linkiem resetującym, wysyłany automatycznie przez Supabase.
- **Aktualizacje na żywo**: zmiany innych osób pojawiają się natychmiast (Supabase Realtime), bez odświeżania i bez czekania kilku sekund jak wcześniej.
- **Dodawanie osób**: zamiast ręcznego dodawania przez admina — każdy się sam rejestruje, a Ty go zatwierdzasz jednym kliknięciem w Panelu admina.
- **Usuwanie konta na stałe**: to jedyna czynność, której nie da się bezpiecznie zrobić z samej aplikacji (wymagałoby to trzymania w przeglądarce klucza dającego pełny dostęp do bazy, czego nie robimy ze względów bezpieczeństwa). "Zablokuj dostęp" w Panelu admina wystarcza w 99% przypadków — a pełne usunięcie konta robisz w Supabase → Authentication → Users → trzy kropki przy osobie → Delete.
- **Reset hasła komuś innemu**: jako admin, przy każdej osobie w Panelu admina masz przycisk "Reset hasła" — wysyła jej e-mail z linkiem do ustawienia nowego hasła.

## Bezpieczeństwo — uczciwie

To rozwiązanie zabezpieczeń (RLS w bazie) jest dopasowane do małego, zaufanego zespołu do 5 osób: każda zatwierdzona osoba widzi terminy całego zespołu (to jest wręcz potrzebne, żeby wykrywać konflikty), ale każdy edytuje tylko swoje rzeczy, a admin może wszystko. Jeśli w przyszłości zespół urośnie albo dane będą bardziej wrażliwe, da się to dokręcić mocniej — daj znać.

## Koszt

Darmowy plan Supabase i darmowy plan Netlify w zupełności wystarczą na zespół do 5 osób — to nie jest coś, co przy tej skali zacznie kosztować.

## Rozwój aplikacji

Lista funkcji, które omawialiśmy, a jeszcze nie ma w kodzie (daj znać, które chcesz jako kolejne):
- Bufor czasowy między dwiema lokalizacjami tej samej osoby.
- Historia/log zmian (kto, kiedy, co zmienił).
- Status "wstępny" (zarezerwowany, ale niepotwierdzony).
- Widok miesięczny.
- Eksport do pliku .ics (import do Google/Outlook/Apple Calendar).
- Komentarz/kontrpropozycja przy prośbie o zmianę terminu, zamiast tylko tak/nie.
