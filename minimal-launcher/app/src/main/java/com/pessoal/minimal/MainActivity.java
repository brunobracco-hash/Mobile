package com.pessoal.minimal;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.TypedArray;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;
import android.widget.Toast;

import java.text.DateFormat;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Launcher minimalista: a tela inicial mostra só o relógio e os favoritos;
 * qualquer outro app só é alcançado digitando o nome.
 *
 * Comandos digitados na busca:
 *   "pausa"        devolve o celular ao launcher normal por 30 minutos
 *   "pausa 10"     idem, por 10 minutos ("pausa 2h" para horas)
 *   "desativar"    abre o ajuste do Android para escolher outro launcher
 */
public class MainActivity extends Activity {

    private static final String PREFS = "minimal";
    private static final String KEY_FAVORITOS = "favoritos";
    private static final String KEY_PAUSA_ATE = "pausa_ate";
    private static final String KEY_JA_PEDIU_PADRAO = "ja_pediu_padrao";
    private static final int PEDIDO_PADRAO = 1;

    private static final int PAUSA_PADRAO_MIN = 30;
    private static final int PAUSA_MAXIMA_MIN = 24 * 60;
    private static final int MAX_RESULTADOS = 8;

    private static final Pattern COMANDO_PAUSA =
            Pattern.compile("^paus(?:a|ar)?(?:\\s+(\\d{1,4})\\s*(m|min|h)?)?$");

    private static final int BRANCO = Color.WHITE;
    private static final int CINZA = 0xFF8A8A8A;

    /** Um app instalado que pode ser aberto. */
    private static final class App {
        final ComponentName componente;
        final String nome;
        final String nomeBusca;

        App(ComponentName componente, String nome) {
            this.componente = componente;
            this.nome = nome;
            this.nomeBusca = normalizar(nome);
        }
    }

    /** Uma linha na tela: um app ou um comando. */
    private static final class Linha {
        final String texto;
        final Runnable acao;
        final App app; // null para comandos
        Linha(String texto, Runnable acao, App app) {
            this.texto = texto;
            this.acao = acao;
            this.app = app;
        }
    }

    private SharedPreferences prefs;
    private final ExecutorService fundo = Executors.newSingleThreadExecutor();
    private final Handler principal = new Handler(Looper.getMainLooper());

    /** Mexido só na thread principal. */
    private final Map<String, App> apps = new HashMap<>();
    private boolean appsCarregados = false;

    private LinearLayout lista;
    private TextView aviso;
    private EditText busca;
    private Runnable primeiraAcao;

    // ------------------------------------------------------------------ ciclo de vida

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        montarTela();
        repassarSePausado(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (repassarSePausado(intent)) return;
        // Apertar "início" estando já na tela inicial: volta ao estado limpo.
        limparBusca();
    }

    @Override
    protected void onResume() {
        super.onResume();
        carregarApps();
        desenhar();
        // Na primeira vez, já pede ao Android para virar a tela inicial.
        if (!ehTelaInicialPadrao() && !prefs.getBoolean(KEY_JA_PEDIU_PADRAO, false)) {
            prefs.edit().putBoolean(KEY_JA_PEDIU_PADRAO, true).apply();
            pedirParaSerPadrao();
        }
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent dados) {
        super.onActivityResult(pedido, resultado, dados);
        if (pedido == PEDIDO_PADRAO && !ehTelaInicialPadrao()) {
            // Alguns celulares não mostram a janelinha (ou o usuário recusou):
            // cai no ajuste do sistema, onde sempre dá para escolher.
            abrir(new Intent(Settings.ACTION_HOME_SETTINGS));
        }
        desenhar();
    }

    // ------------------------------------------------------------------ tela inicial padrão

    /** O Minimal é quem o Android abre ao apertar "início"? */
    private boolean ehTelaInicialPadrao() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = getSystemService(RoleManager.class);
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME)) {
                return rm.isRoleHeld(RoleManager.ROLE_HOME);
            }
        }
        Intent inicio = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo ri = getPackageManager()
                .resolveActivity(inicio, PackageManager.MATCH_DEFAULT_ONLY);
        return ri != null && ri.activityInfo != null
                && getPackageName().equals(ri.activityInfo.packageName);
    }

    private void pedirParaSerPadrao() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = getSystemService(RoleManager.class);
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME)) {
                try {
                    startActivityForResult(
                            rm.createRequestRoleIntent(RoleManager.ROLE_HOME), PEDIDO_PADRAO);
                    return;
                } catch (ActivityNotFoundException e) {
                    // segue para o ajuste do sistema
                }
            }
        }
        if (!abrir(new Intent(Settings.ACTION_HOME_SETTINGS))) {
            abrir(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        limparBusca();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        fundo.shutdownNow();
    }

    @Override
    public void onBackPressed() {
        // Um launcher não "volta" para lugar nenhum; voltar só limpa a busca.
        limparBusca();
    }

    // ------------------------------------------------------------------ tela

    private void montarTela() {
        int margem = dp(28);

        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setBackgroundColor(Color.BLACK);
        raiz.setPadding(margem, margem, margem, margem);

        TextClock hora = new TextClock(this);
        hora.setFormat24Hour("HH:mm");
        hora.setFormat12Hour("h:mm");
        hora.setTextColor(BRANCO);
        hora.setTextSize(TypedValue.COMPLEX_UNIT_SP, 56);
        hora.setTypeface(Typeface.create("sans-serif-thin", Typeface.NORMAL));
        hora.setOnClickListener(v -> abrir(new Intent(AlarmClock.ACTION_SHOW_ALARMS)));
        raiz.addView(hora);

        TextClock data = new TextClock(this);
        data.setFormat24Hour("EEEE, d 'de' MMMM");
        data.setFormat12Hour("EEEE, d 'de' MMMM");
        data.setTextColor(CINZA);
        data.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        raiz.addView(data);

        ScrollView rolagem = new ScrollView(this);
        rolagem.setFillViewport(true);
        rolagem.setVerticalScrollBarEnabled(false);
        lista = new LinearLayout(this);
        lista.setOrientation(LinearLayout.VERTICAL);
        lista.setGravity(Gravity.CENTER_VERTICAL);
        rolagem.addView(lista, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        raiz.addView(rolagem, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        aviso = new TextView(this);
        aviso.setTextColor(CINZA);
        aviso.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        aviso.setPadding(0, 0, 0, dp(8));
        raiz.addView(aviso);

        busca = new EditText(this);
        busca.setHint("buscar app");
        busca.setHintTextColor(0xFF555555);
        busca.setTextColor(BRANCO);
        busca.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        busca.setSingleLine(true);
        busca.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        busca.setImeOptions(EditorInfo.IME_ACTION_GO);
        busca.setBackgroundColor(Color.TRANSPARENT);
        busca.setPadding(0, dp(12), 0, dp(12));
        busca.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void afterTextChanged(Editable s) { desenhar(); }
        });
        busca.setOnEditorActionListener((v, acao, evento) -> {
            boolean enter = acao == EditorInfo.IME_ACTION_GO
                    || (evento != null && evento.getKeyCode() == KeyEvent.KEYCODE_ENTER
                        && evento.getAction() == KeyEvent.ACTION_DOWN);
            if (!enter) return false;
            if (primeiraAcao != null) primeiraAcao.run();
            return true;
        });
        raiz.addView(busca);

        // Android 15 desenha a tela por baixo das barras do sistema: as margens
        // (e o teclado) passam a ser responsabilidade do app.
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            raiz.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets in = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(margem + in.left, margem + in.top,
                        margem + in.right, margem + in.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            raiz.setFitsSystemWindows(true);
        }

        setContentView(raiz);
    }

    private void desenhar() {
        if (lista == null) return;
        lista.removeAllViews();
        primeiraAcao = null;
        atualizarAviso();

        String consulta = normalizar(busca.getText().toString().trim());
        List<Linha> linhas = consulta.isEmpty() ? favoritos() : resultados(consulta);

        if (consulta.isEmpty() && linhas.isEmpty() && appsCarregados) {
            TextView ajuda = new TextView(this);
            ajuda.setTextColor(CINZA);
            ajuda.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            ajuda.setLineSpacing(dp(4), 1f);
            ajuda.setText("Digite o nome de um app para abri-lo.\n\n"
                    + "Toque e segure um resultado para fixá-lo aqui.\n\n"
                    + "Digite “pausa” para voltar ao launcher normal por 30 min "
                    + "(ou “pausa 10”, “pausa 2h”).");
            lista.addView(ajuda);
            return;
        }

        boolean grande = consulta.isEmpty();
        for (Linha linha : linhas) lista.addView(criarLinha(linha, grande));
        if (!linhas.isEmpty()) primeiraAcao = linhas.get(0).acao;
    }

    private TextView criarLinha(Linha linha, boolean grande) {
        TextView t = new TextView(this);
        t.setText(linha.texto);
        t.setTextColor(linha.app == null ? CINZA : BRANCO);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, grande ? 28 : 24);
        t.setTypeface(Typeface.create("sans-serif-light",
                linha.app == null ? Typeface.ITALIC : Typeface.NORMAL));
        t.setSingleLine(true);
        t.setPadding(0, dp(10), 0, dp(10));
        t.setBackgroundResource(fundoClicavel());
        t.setOnClickListener(v -> linha.acao.run());
        if (linha.app != null) {
            t.setOnLongClickListener(v -> {
                menuDoApp(linha.app);
                return true;
            });
        }
        return t;
    }

    private void atualizarAviso() {
        aviso.setOnClickListener(null);
        aviso.setClickable(false);
        if (!ehTelaInicialPadrao()) {
            // Sem isto o botão "início" leva ao launcher antigo e o Minimal não prende nada.
            aviso.setText("O Minimal ainda não é a tela inicial do celular, então "
                    + "o botão “início” leva ao launcher antigo. "
                    + "Toque aqui e escolha Minimal.");
            aviso.setTextColor(BRANCO);
            aviso.setOnClickListener(v -> pedirParaSerPadrao());
            aviso.setVisibility(View.VISIBLE);
            return;
        }
        aviso.setTextColor(CINZA);
        long ate = pausaAte();
        if (ate > System.currentTimeMillis()) {
            String hora = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(ate));
            aviso.setText("Pausado até " + hora + ".");
            aviso.setVisibility(View.VISIBLE);
        } else {
            aviso.setVisibility(View.GONE);
        }
    }

    private void limparBusca() {
        if (busca == null) return;
        if (busca.length() > 0) busca.setText("");
        busca.clearFocus();
        InputMethodManager imm = getSystemService(InputMethodManager.class);
        if (imm != null) imm.hideSoftInputFromWindow(busca.getWindowToken(), 0);
    }

    // ------------------------------------------------------------------ apps

    private void carregarApps() {
        PackageManager pm = getPackageManager();
        String meuPacote = getPackageName();
        fundo.execute(() -> {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> encontrados = pm.queryIntentActivities(i, 0);
            Map<String, App> novos = new HashMap<>();
            for (ResolveInfo ri : encontrados) {
                if (ri.activityInfo == null) continue;
                if (meuPacote.equals(ri.activityInfo.packageName)) continue;
                ComponentName c = new ComponentName(
                        ri.activityInfo.packageName, ri.activityInfo.name);
                CharSequence nome = ri.loadLabel(pm);
                novos.put(c.flattenToString(),
                        new App(c, nome == null ? c.getPackageName() : nome.toString()));
            }
            principal.post(() -> {
                apps.clear();
                apps.putAll(novos);
                appsCarregados = true;
                desenhar();
            });
        });
    }

    private List<Linha> favoritos() {
        List<Linha> linhas = new ArrayList<>();
        for (String chave : lerFavoritos()) {
            App app = apps.get(chave);
            if (app != null) linhas.add(linhaDeApp(app));
        }
        return linhas;
    }

    private List<Linha> resultados(String consulta) {
        List<Linha> linhas = new ArrayList<>(comandos(consulta));

        List<App> achados = new ArrayList<>();
        Map<App, Integer> nota = new HashMap<>();
        for (App app : apps.values()) {
            int n = pontuar(app.nomeBusca, consulta);
            if (n >= 0) {
                achados.add(app);
                nota.put(app, n);
            }
        }
        Collections.sort(achados, (a, b) -> {
            int c = Integer.compare(nota.get(a), nota.get(b));
            return c != 0 ? c : a.nomeBusca.compareTo(b.nomeBusca);
        });
        for (int i = 0; i < achados.size() && i < MAX_RESULTADOS; i++) {
            linhas.add(linhaDeApp(achados.get(i)));
        }
        return linhas;
    }

    /** 0 = começa com a busca; 1 = alguma palavra começa; 2 = contém; -1 = não serve. */
    private static int pontuar(String nome, String consulta) {
        if (nome.startsWith(consulta)) return 0;
        if (nome.contains(" " + consulta)) return 1;
        if (nome.contains(consulta)) return 2;
        return -1;
    }

    private Linha linhaDeApp(App app) {
        return new Linha(app.nome, () -> abrirApp(app), app);
    }

    private void abrirApp(App app) {
        Intent i = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setComponent(app.componente)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        if (!abrir(i)) carregarApps();
    }

    private boolean abrir(Intent i) {
        try {
            if ((i.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) == 0) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            }
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, "Não foi possível abrir.", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    private void menuDoApp(App app) {
        List<String> favs = lerFavoritos();
        String chave = app.componente.flattenToString();
        int pos = favs.indexOf(chave);

        List<String> opcoes = new ArrayList<>();
        List<Runnable> acoes = new ArrayList<>();
        if (pos < 0) {
            opcoes.add("Adicionar à tela inicial");
            acoes.add(() -> { favs.add(chave); salvarFavoritos(favs); });
        } else {
            opcoes.add("Tirar da tela inicial");
            acoes.add(() -> { favs.remove(chave); salvarFavoritos(favs); });
            if (pos > 0) {
                opcoes.add("Mover para cima");
                acoes.add(() -> { Collections.swap(favs, pos, pos - 1); salvarFavoritos(favs); });
            }
            if (pos < favs.size() - 1) {
                opcoes.add("Mover para baixo");
                acoes.add(() -> { Collections.swap(favs, pos, pos + 1); salvarFavoritos(favs); });
            }
        }
        opcoes.add("Informações do app");
        acoes.add(() -> abrir(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", app.componente.getPackageName(), null))));

        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(app.nome)
                .setItems(opcoes.toArray(new String[0]), (d, qual) -> {
                    acoes.get(qual).run();
                    desenhar();
                })
                .show();
    }

    private List<String> lerFavoritos() {
        String salvo = prefs.getString(KEY_FAVORITOS, "");
        List<String> favs = new ArrayList<>();
        for (String s : salvo.split("\n")) if (!s.isEmpty()) favs.add(s);
        return favs;
    }

    private void salvarFavoritos(List<String> favs) {
        prefs.edit().putString(KEY_FAVORITOS, String.join("\n", favs)).apply();
    }

    // ------------------------------------------------------------------ comandos

    private List<Linha> comandos(String consulta) {
        List<Linha> linhas = new ArrayList<>();

        Matcher m = COMANDO_PAUSA.matcher(consulta);
        boolean digitandoPausa = consulta.length() >= 3 && "pausa".startsWith(consulta);
        if (m.matches() || digitandoPausa) {
            int minutos = PAUSA_PADRAO_MIN;
            if (m.matches() && m.group(1) != null) {
                minutos = Integer.parseInt(m.group(1));
                if ("h".equals(m.group(2))) minutos *= 60;
            }
            int finalMin = Math.max(1, Math.min(minutos, PAUSA_MAXIMA_MIN));
            linhas.add(new Linha("pausar o Minimal por " + descreverMinutos(finalMin),
                    () -> pausar(finalMin), null));
        }

        if (consulta.length() >= 3 && "desativar".startsWith(consulta)) {
            linhas.add(new Linha("desativar: escolher outro launcher",
                    this::abrirAjusteDeLauncher, null));
        }
        return linhas;
    }

    private static String descreverMinutos(int min) {
        if (min % 60 == 0) {
            int h = min / 60;
            return h == 1 ? "1 hora" : h + " horas";
        }
        return min + " min";
    }

    private void abrirAjusteDeLauncher() {
        limparBusca();
        if (!abrir(new Intent(Settings.ACTION_HOME_SETTINGS))) {
            abrir(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    // ------------------------------------------------------------------ pausa

    private long pausaAte() {
        return prefs.getLong(KEY_PAUSA_ATE, 0);
    }

    private void encerrarPausa() {
        prefs.edit().remove(KEY_PAUSA_ATE).apply();
    }

    private void pausar(int minutos) {
        ComponentName outro = outroLauncher();
        if (outro == null) {
            Toast.makeText(this, "Nenhum outro launcher encontrado.", Toast.LENGTH_LONG).show();
            abrirAjusteDeLauncher();
            return;
        }
        long ate = System.currentTimeMillis() + minutos * 60_000L;
        prefs.edit().putLong(KEY_PAUSA_ATE, ate).apply();
        limparBusca();
        Toast.makeText(this, "Minimal pausado por " + descreverMinutos(minutos)
                + ". Para voltar antes, abra o app “Minimal”.", Toast.LENGTH_LONG).show();
        abrirLauncher(outro);
    }

    /**
     * Durante a pausa o Minimal continua sendo a tela inicial do Android, mas
     * repassa cada toque em "início" para o launcher original. Assim a pausa
     * acaba sozinha: passado o prazo, o próximo "início" já cai no Minimal.
     *
     * @return true se repassou (e o Minimal não deve aparecer).
     */
    private boolean repassarSePausado(Intent intent) {
        long ate = pausaAte();
        if (ate == 0) return false;
        if (System.currentTimeMillis() >= ate) {
            encerrarPausa();
            return false;
        }
        boolean veioDoInicio = intent != null && intent.hasCategory(Intent.CATEGORY_HOME);
        if (!veioDoInicio) {
            // Aberto pelo ícone no launcher normal: o usuário quer o Minimal de volta.
            encerrarPausa();
            Toast.makeText(this, "Minimal reativado.", Toast.LENGTH_SHORT).show();
            return false;
        }
        ComponentName outro = outroLauncher();
        if (outro == null || !abrirLauncher(outro)) {
            encerrarPausa();
            return false;
        }
        return true;
    }

    private boolean abrirLauncher(ComponentName c) {
        Intent i = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .setComponent(c)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
            overridePendingTransition(0, 0);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** O launcher que veio com o celular (ou, na falta dele, qualquer outro instalado). */
    private ComponentName outroLauncher() {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        List<ResolveInfo> candidatos = getPackageManager().queryIntentActivities(i, 0);
        ComponentName qualquer = null;
        for (ResolveInfo ri : candidatos) {
            if (ri.activityInfo == null) continue;
            String pacote = ri.activityInfo.packageName;
            // A "FallbackHome" dos Ajustes só serve para o boot, não é um launcher.
            if (pacote.equals(getPackageName()) || pacote.equals("com.android.settings")) continue;
            ComponentName c = new ComponentName(pacote, ri.activityInfo.name);
            ApplicationInfo ai = ri.activityInfo.applicationInfo;
            if (ai != null && (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0) return c;
            if (qualquer == null) qualquer = c;
        }
        return qualquer;
    }

    // ------------------------------------------------------------------ utilidades

    static String normalizar(String s) {
        String semAcento = Normalizer.normalize(s, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "");
        return semAcento.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private int dp(int valor) {
        return Math.round(valor * getResources().getDisplayMetrics().density);
    }

    private int fundoClicavel() {
        TypedArray a = obtainStyledAttributes(new int[]{android.R.attr.selectableItemBackground});
        int id = a.getResourceId(0, 0);
        a.recycle();
        return id;
    }
}
