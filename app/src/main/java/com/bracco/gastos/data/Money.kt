package com.bracco.gastos.data

import java.text.NumberFormat
import java.util.Locale

private val BR = Locale("pt", "BR")

/** 1250 -> "R$ 12,50" */
fun formatBrl(cents: Long): String =
    NumberFormat.getCurrencyInstance(BR).format(cents / 100.0)

/** 1250 -> "12,50" (sem simbolo, para caber em espacos apertados) */
fun formatAmount(cents: Long): String =
    NumberFormat.getNumberInstance(BR).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }.format(cents / 100.0)

/**
 * Converte os digitos crus digitados pelo usuario em centavos.
 * O campo funciona da direita para a esquerda: "5" -> R$ 0,05, "50" -> R$ 0,50,
 * "1250" -> R$ 12,50. Nao ha virgula para digitar.
 */
fun digitsToCents(digits: String): Long =
    digits.filter { it.isDigit() }.takeLast(12).toLongOrNull() ?: 0L
