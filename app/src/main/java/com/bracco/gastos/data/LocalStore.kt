package com.bracco.gastos.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import java.io.File

/**
 * Guarda em disco a lista de lancamentos e a sessao do usuario.
 * Simples de proposito: dois arquivos JSON. O volume de dados de uma casa
 * cabe folgado em memoria, entao nao ha ganho em usar banco local aqui.
 */
class LocalStore(context: Context) {

    private val dir = context.filesDir
    private val expensesFile = File(dir, "expenses.json")
    private val sessionFile = File(dir, "session.json")
    private val mutex = Mutex()

    suspend fun readExpenses(): List<StoredExpense> = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (!expensesFile.exists()) return@withLock emptyList()
            runCatching {
                json.decodeFromString<List<StoredExpense>>(expensesFile.readText())
            }.getOrDefault(emptyList())
        }
    }

    suspend fun writeExpenses(items: List<StoredExpense>) = withContext(Dispatchers.IO) {
        mutex.withLock {
            runCatching { expensesFile.writeText(json.encodeToString(items)) }
        }
        Unit
    }

    suspend fun readSession(): Session? = withContext(Dispatchers.IO) {
        if (!sessionFile.exists()) return@withContext null
        runCatching { json.decodeFromString<Session>(sessionFile.readText()) }.getOrNull()
    }

    suspend fun writeSession(session: Session?) = withContext(Dispatchers.IO) {
        runCatching {
            if (session == null) sessionFile.delete()
            else sessionFile.writeText(json.encodeToString(session))
        }
        Unit
    }
}
