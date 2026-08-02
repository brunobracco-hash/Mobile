package com.bracco.pdf2word

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Estatisticas finais de uma conversao. */
data class ConversionResult(
    val outputPath: String,
    val fileName: String,
    val pages: Int,
    val ocrPages: Int,
    val paragraphs: Int,
    val characters: Long,
    val sizeBytes: Long,
    val elapsedMs: Long
)

sealed class ConversionStatus {
    object Idle : ConversionStatus()

    /** [page] e [total] valem 0 enquanto o total ainda nao e conhecido. */
    data class Running(
        val phase: Phase,
        val page: Int = 0,
        val total: Int = 0,
        val ocrPages: Int = 0
    ) : ConversionStatus()

    data class Done(val result: ConversionResult) : ConversionStatus()
    data class Failed(val message: String) : ConversionStatus()
    object Cancelled : ConversionStatus()

    enum class Phase { COPYING, ANALYZING, CONVERTING, WRITING }
}

/**
 * Estado compartilhado entre o servico de conversao e a tela.
 * Simples e suficiente: so existe uma conversao por vez.
 */
object ConversionState {
    private val _status = MutableStateFlow<ConversionStatus>(ConversionStatus.Idle)
    val status: StateFlow<ConversionStatus> = _status

    fun update(value: ConversionStatus) {
        _status.value = value
    }

    fun reset() {
        _status.value = ConversionStatus.Idle
    }

    val isRunning: Boolean
        get() = _status.value is ConversionStatus.Running
}
