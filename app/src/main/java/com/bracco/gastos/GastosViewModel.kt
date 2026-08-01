package com.bracco.gastos

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.bracco.gastos.data.Repository
import kotlinx.coroutines.launch

class GastosViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = Repository(app)

    val state = repo.state
    val isConfigured: Boolean get() = repo.isConfigured

    init {
        viewModelScope.launch { repo.bootstrap() }
    }

    fun signIn(email: String, password: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            val result = repo.signIn(email, password)
            onDone(result.exceptionOrNull()?.message)
        }
    }

    fun signOut() {
        viewModelScope.launch { repo.signOut() }
    }

    fun add(amountCents: Long, description: String) {
        viewModelScope.launch { repo.add(amountCents, description) }
    }

    fun remove(id: String) {
        viewModelScope.launch { repo.remove(id) }
    }

    fun sync() {
        viewModelScope.launch { repo.sync() }
    }

    fun clearError() = repo.clearError()
}
