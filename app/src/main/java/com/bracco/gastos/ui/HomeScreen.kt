package com.bracco.gastos.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bracco.gastos.data.AppState
import com.bracco.gastos.data.StoredExpense
import com.bracco.gastos.data.digitsToCents
import com.bracco.gastos.data.formatAmount
import com.bracco.gastos.data.formatBrl
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    state: AppState,
    onAdd: (Long, String) -> Unit,
    onRemove: (String) -> Unit,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
    onDismissError: () -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    var confirmSignOut by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<StoredExpense?>(null) }

    LaunchedEffect(state.error) {
        val message = state.error
        if (message != null) {
            snackbarHostState.showSnackbar(friendlyError(message))
            onDismissError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Gastos", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                actions = {
                    if (state.syncing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.width(12.dp))
                    } else {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Filled.Refresh, contentDescription = "Atualizar")
                        }
                    }
                    IconButton(onClick = { confirmSignOut = true }) {
                        Icon(Icons.Filled.Logout, contentDescription = "Sair")
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .imePadding(),
        ) {
            TotalsCard(state.expenses)
            EntryCard(onAdd = onAdd)
            Spacer(Modifier.height(4.dp))
            ExpenseList(
                expenses = state.expenses,
                onLongPress = { pendingDelete = it },
            )
        }
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sair da conta?") },
            text = { Text("Os lançamentos ficam salvos na nuvem. Você vai precisar entrar de novo com e-mail e senha.") },
            confirmButton = {
                TextButton(onClick = { confirmSignOut = false; onSignOut() }) { Text("Sair") }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) { Text("Cancelar") }
            },
        )
    }

    pendingDelete?.let { target ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Apagar lançamento?") },
            text = {
                Text(
                    buildString {
                        append(formatBrl(target.expense.amountCents))
                        if (target.expense.description.isNotBlank()) {
                            append(" — ")
                            append(target.expense.description)
                        }
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onRemove(target.expense.id)
                    pendingDelete = null
                }) { Text("Apagar") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("Cancelar") }
            },
        )
    }
}

@Composable
private fun TotalsCard(expenses: List<StoredExpense>) {
    val visible = expenses.filterNot { it.pendingDelete }
    val thisMonth = YearMonth.now()
    val monthTotal = visible
        .filter { yearMonthOf(it.expense.createdAt) == thisMonth }
        .sumOf { it.expense.amountCents }
    val allTotal = visible.sumOf { it.expense.amountCents }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = monthLabel(thisMonth).uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = formatBrl(monthTotal),
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            if (allTotal != monthTotal) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Total geral ${formatBrl(allTotal)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun EntryCard(onAdd: (Long, String) -> Unit) {
    var digits by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    val focusManager = LocalFocusManager.current
    val cents = digitsToCents(digits)

    fun submit() {
        if (cents <= 0L) return
        onAdd(cents, description)
        digits = ""
        description = ""
        focusManager.clearFocus()
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = if (digits.isEmpty()) "" else formatAmount(cents),
                onValueChange = { typed -> digits = typed.filter { it.isDigit() }.takeLast(9) },
                label = { Text("Valor") },
                placeholder = { Text("0,00") },
                leadingIcon = { Text("R$", style = MaterialTheme.typography.bodyMedium) },
                singleLine = true,
                modifier = Modifier.width(150.dp),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Next,
                ),
            )
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Descrição") },
                singleLine = true,
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
            )
            FilledIconButton(
                onClick = { submit() },
                enabled = cents > 0L,
                modifier = Modifier.size(52.dp),
            ) {
                Icon(Icons.Filled.Add, contentDescription = "Lançar")
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ExpenseList(
    expenses: List<StoredExpense>,
    onLongPress: (StoredExpense) -> Unit,
) {
    val visible = expenses.filterNot { it.pendingDelete }

    if (visible.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.TopCenter) {
            Text(
                text = "Nenhum gasto lançado ainda.\nDigite o valor acima e toque em +.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        return
    }

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(visible, key = { it.expense.id }) { item ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .combinedClickable(
                        onClick = {},
                        onLongClick = { onLongPress(item) },
                    )
                    .padding(horizontal = 24.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = item.expense.description.ifBlank { "Sem descrição" },
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = subtitle(item),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (item.pending) {
                    Icon(
                        imageVector = Icons.Filled.CloudOff,
                        contentDescription = "Aguardando envio",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    text = formatBrl(item.expense.amountCents),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

// ------------------------------------------------------------------ helpers

private val DATE_FORMAT = DateTimeFormatter.ofPattern("dd/MM 'às' HH:mm")

private fun localDateTime(iso: String) = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
}.getOrNull()

private fun yearMonthOf(iso: String): YearMonth? =
    localDateTime(iso)?.let { YearMonth.of(it.year, it.month) }

private fun subtitle(item: StoredExpense): String {
    val when1 = localDateTime(item.expense.createdAt)?.format(DATE_FORMAT) ?: "—"
    val who = item.expense.createdBy.substringBefore('@')
    return if (who.isBlank()) when1 else "$when1 · $who"
}

private fun monthLabel(month: YearMonth): String {
    val name = month.month.getDisplayName(
        java.time.format.TextStyle.FULL,
        java.util.Locale("pt", "BR"),
    )
    return "Total de $name"
}

private fun friendlyError(raw: String): String = when {
    raw.contains("sem conexao", ignoreCase = true) ->
        "Sem conexão. Os lançamentos ficam salvos e sobem sozinhos depois."
    raw.contains("sessao expirada", ignoreCase = true) -> "Sessão expirada, entre de novo."
    else -> raw
}
