package com.bracco.gastos.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

data class AppState(
    val loading: Boolean = true,
    val signedIn: Boolean = false,
    val email: String = "",
    val expenses: List<StoredExpense> = emptyList(),
    val syncing: Boolean = false,
    val error: String? = null,
)

/**
 * Fonte unica de verdade do app.
 *
 * A lista local e sempre o que aparece na tela, para o lancamento ser
 * instantaneo mesmo sem sinal. O que ainda nao subiu fica marcado como
 * pendente e e reenviado na proxima sincronizacao.
 */
class Repository(context: Context) {

    private val local = LocalStore(context.applicationContext)
    private val remote = SupabaseClient()
    private val syncMutex = Mutex()

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    val isConfigured: Boolean get() = remote.isConfigured

    private var session: Session? = null

    suspend fun bootstrap() {
        val stored = local.readSession()
        val cached = local.readExpenses()
        session = stored
        _state.value = _state.value.copy(
            loading = false,
            signedIn = stored != null,
            email = stored?.user?.email.orEmpty(),
            expenses = cached,
        )
        if (stored != null) sync()
    }

    suspend fun signIn(email: String, password: String): Result<Unit> = runCatching {
        val newSession = remote.signIn(email, password)
        session = newSession
        local.writeSession(newSession)
        _state.value = _state.value.copy(
            signedIn = true,
            email = newSession.user?.email ?: email.trim(),
            error = null,
        )
        sync()
    }

    suspend fun signOut() {
        session = null
        local.writeSession(null)
        local.writeExpenses(emptyList())
        _state.value = AppState(loading = false, signedIn = false)
    }

    suspend fun add(amountCents: Long, description: String) {
        val entry = StoredExpense(
            expense = Expense(
                id = UUID.randomUUID().toString(),
                amountCents = amountCents,
                description = description.trim(),
                createdAt = OffsetDateTime.now(ZoneOffset.UTC).toString(),
                createdBy = _state.value.email,
            ),
            pending = true,
        )
        val updated = (listOf(entry) + _state.value.expenses).sortedByDescending { it.expense.createdAt }
        _state.value = _state.value.copy(expenses = updated)
        local.writeExpenses(updated)
        sync()
    }

    suspend fun remove(id: String) {
        val current = _state.value.expenses
        val target = current.firstOrNull { it.expense.id == id } ?: return
        val updated = if (target.pending) {
            // Nunca chegou ao servidor: basta sumir daqui.
            current.filterNot { it.expense.id == id }
        } else {
            current.map { if (it.expense.id == id) it.copy(pendingDelete = true) else it }
        }
        _state.value = _state.value.copy(expenses = updated)
        local.writeExpenses(updated)
        sync()
    }

    /**
     * Empurra o que esta pendente e depois puxa a lista do servidor.
     * Chamada com frequencia (abertura do app, cada lancamento, pull-to-refresh);
     * o mutex garante que duas sincronizacoes nao se atropelem.
     */
    suspend fun sync() {
        if (session == null || !remote.isConfigured) return
        if (syncMutex.isLocked) return

        syncMutex.withLock {
            _state.value = _state.value.copy(syncing = true)
            try {
                for (item in _state.value.expenses.filter { it.pending && !it.pendingDelete }) {
                    withAuth { token ->
                        remote.insertExpense(
                            token,
                            NewExpense(
                                id = item.expense.id,
                                amountCents = item.expense.amountCents,
                                description = item.expense.description,
                                createdAt = item.expense.createdAt,
                                createdBy = item.expense.createdBy,
                            ),
                        )
                    }
                }

                for (item in _state.value.expenses.filter { it.pendingDelete }) {
                    withAuth { token -> remote.deleteExpense(token, item.expense.id) }
                }

                val remoteList = withAuth { token -> remote.listExpenses(token) }
                val fresh = remoteList.map { StoredExpense(it) }
                _state.value = _state.value.copy(expenses = fresh, syncing = false, error = null)
                local.writeExpenses(fresh)
            } catch (e: SupabaseException) {
                // Offline ou servidor fora: seguimos com o que esta em disco.
                _state.value = _state.value.copy(syncing = false, error = e.message)
            }
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    /**
     * Executa a chamada com o token atual. Se o token expirou (401), renova
     * uma vez e repete. Se a renovacao falhar, a sessao acabou de verdade.
     */
    private suspend fun <T> withAuth(block: suspend (String) -> T): T {
        val current = session ?: throw SupabaseException("sessao expirada", 401)
        return try {
            block(current.accessToken)
        } catch (e: SupabaseException) {
            if (e.status != 401) throw e
            val renewed = try {
                remote.refresh(current.refreshToken)
            } catch (refreshError: SupabaseException) {
                signOut()
                throw SupabaseException("sessao expirada, entre de novo", 401)
            }
            session = renewed
            local.writeSession(renewed)
            block(renewed.accessToken)
        }
    }
}
