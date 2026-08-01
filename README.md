# Gastos

App Android para controle de gastos domésticos de duas pessoas. Cada um lança
o gasto no próprio celular, os dois veem a mesma lista e o mesmo total.

A tela é só isso: o total do mês, um campo de valor, um campo de descrição e a
lista do que foi lançado.

---

## O que já está pronto

- App Android nativo (Kotlin + Jetpack Compose).
- Sincronização entre os dois celulares via Supabase.
- **Funciona sem internet**: o gasto é salvo na hora no celular e sobe sozinho
  quando a conexão volta. Fica um ícone de nuvem cortada enquanto não subiu.
- Login por e-mail e senha, sessão fica salva (só se faz login uma vez).
- Apagar lançamento: toque e segure em cima dele.
- APK gerado automaticamente pelo GitHub Actions.

## O que falta para funcionar (5 a 10 minutos, uma vez só)

Faltam as credenciais do Supabase. Sem elas o app abre e avisa que não está
configurado.

### 1. Criar o projeto no Supabase

1. Entre em <https://supabase.com> e crie uma conta gratuita.
2. Clique em **New project**. Dê um nome (ex.: `gastos`), escolha uma senha de
   banco (pode ser qualquer uma, você não vai usar no dia a dia) e a região
   `South America (São Paulo)`.
3. Espere uns 2 minutos até o projeto ficar pronto.

### 2. Criar a tabela

No menu lateral, vá em **SQL Editor**, cole o bloco abaixo e clique em **Run**:

```sql
create table public.expenses (
  id            uuid primary key,
  amount_cents  bigint      not null check (amount_cents > 0),
  description   text        not null default '',
  created_at    timestamptz not null default now(),
  created_by    text        not null default '',
  deleted       boolean     not null default false
);

alter table public.expenses enable row level security;

-- Só quem está logado enxerga e escreve. Quem não fez login não lê nada.
create policy "casa" on public.expenses
  for all
  to authenticated
  using (true)
  with check (true);

create index expenses_created_at_idx on public.expenses (created_at desc);
```

### 3. Criar os dois usuários

1. Menu lateral: **Authentication** → **Users** → **Add user** → **Create new user**.
2. Crie o seu: e-mail e senha. Marque **Auto Confirm User**.
3. Repita para o e-mail da sua esposa.

Depois, feche a porta para estranhos: **Authentication** → **Sign In / Providers**
→ **Email** → desmarque **Allow new users to sign up** → **Save**.

Isso é o que garante que ninguém além de vocês dois entre, mesmo o app sendo
de código aberto.

### 4. Pegar as duas credenciais

Menu lateral: **Project Settings** → **API**. Você precisa de dois valores:

- **Project URL** — algo como `https://abcdefghijk.supabase.co`
- **anon public** (chave `anon` / `publishable`) — um texto longo começando com `eyJ...`

> A chave `anon` pode ficar no código sem problema: sozinha ela não lê nada,
> porque a regra de segurança acima exige usuário autenticado. É assim que o
> Supabase foi desenhado.

### 5. Colocar as credenciais no projeto

Abra o arquivo [`gradle.properties`](gradle.properties) e preencha as duas
linhas do fim:

```properties
SUPABASE_URL=https://abcdefghijk.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

Se preferir não deixar isso no repositório, dá para usar
**Settings → Secrets and variables → Actions** no GitHub e criar os secrets
`SUPABASE_URL` e `SUPABASE_ANON_KEY`. Os secrets têm prioridade sobre o
arquivo.

Ao salvar e enviar a mudança, o APK é gerado de novo automaticamente.

---

## Como instalar no celular

1. Vá em **Releases** do repositório e abra a release `Gastos - última versão`
   (tag `gastos-latest`). Link direto:
   <https://github.com/brunobracco-hash/Mobile/releases/download/gastos-latest/gastos.apk>
2. Pelo navegador **do próprio celular**, baixe o arquivo `gastos.apk`.
3. Abra o arquivo baixado. O Android vai pedir permissão para instalar apps de
   fonte desconhecida — é normal para app fora da Play Store. Autorize e
   instale.
4. Repita nos dois celulares e faça login com o e-mail de cada um.

As atualizações seguintes instalam por cima, sem desinstalar nada, porque o APK
é sempre assinado com a mesma chave (`app/keystore/gastos.jks`).

> Sobre essa chave: ela está no repositório de propósito, para que qualquer
> build gere um APK instalável por cima do anterior sem configuração extra.
> Como o repositório é público, a chave também é — ela não protege os dados
> (quem faz isso é o login), apenas mantém a identidade do app estável. Se um
> dia quiser fechar isso, basta tornar o repositório privado ou trocar a chave
> por secrets do GitHub.

## Gerar o APK manualmente

Na aba **Actions** do GitHub, workflow **Gerar APK** → **Run workflow**.

Para compilar na sua máquina (precisa do Android SDK):

```bash
./gradlew :app:assembleRelease
# APK em app/build/outputs/apk/release/app-release.apk
```

## Estrutura

```
app/src/main/java/com/bracco/gastos/
├── MainActivity.kt          entrada do app e roteamento entre telas
├── GastosViewModel.kt       ponte entre a UI e o repositório
├── data/
│   ├── Models.kt            tipos de dados
│   ├── Money.kt             valores em centavos e formatação em reais
│   ├── SupabaseClient.kt    chamadas HTTP (login e dados)
│   ├── LocalStore.kt        cache em disco
│   └── Repository.kt        fonte da verdade e sincronização
└── ui/
    ├── Theme.kt
    ├── LoginScreen.kt
    └── HomeScreen.kt
```
