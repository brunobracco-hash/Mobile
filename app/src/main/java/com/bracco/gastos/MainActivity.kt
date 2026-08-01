package com.bracco.gastos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.bracco.gastos.ui.GastosTheme
import com.bracco.gastos.ui.HomeScreen
import com.bracco.gastos.ui.LoginScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            GastosTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    GastosApp()
                }
            }
        }
    }
}

@Composable
private fun GastosApp(viewModel: GastosViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    when {
        !viewModel.isConfigured -> NotConfigured()
        state.loading -> Loading()
        !state.signedIn -> LoginScreen(onSignIn = viewModel::signIn)
        else -> HomeScreen(
            state = state,
            onAdd = viewModel::add,
            onRemove = viewModel::remove,
            onRefresh = { viewModel.sync() },
            onSignOut = { viewModel.signOut() },
            onDismissError = viewModel::clearError,
        )
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun NotConfigured() {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(
            text = "Este APK foi gerado sem as credenciais do Supabase.\n\n" +
                "Preencha SUPABASE_URL e SUPABASE_ANON_KEY no arquivo " +
                "gradle.properties e gere o APK de novo. O passo a passo está no README.",
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
