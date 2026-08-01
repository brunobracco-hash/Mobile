package com.bracco.gastos.data

import java.text.NumberFormat
import java.util.Locale

private val BR = Locale("pt", "BR")

/**
 * 1400 -> "R$ 14", 1250 -> "R$ 12,50".
 *
 * Os centavos so aparecem quando existem. O app hoje so aceita reais
 * inteiros, mas lancamentos antigos podem ter centavos, e esconde-los
 * arredondaria valores ja gravados.
 */
fun formatBrl(cents: Long): String =
    NumberFormat.getCurrencyInstance(BR).apply {
        if (cents % 100 == 0L) {
            minimumFractionDigits = 0
            maximumFractionDigits = 0
        }
    }.format(cents / 100.0)

/** 1400 -> "14", 120000 -> "1.200" (sem simbolo, para o campo de entrada) */
fun formatWholeReais(cents: Long): String =
    NumberFormat.getIntegerInstance(BR).format(cents / 100)

/**
 * Converte os digitos digitados em centavos, tratando tudo como reais
 * inteiros: "14" -> R$ 14. Nao ha centavos para digitar.
 */
fun digitsToCents(digits: String): Long =
    (digits.filter { it.isDigit() }.takeLast(7).toLongOrNull() ?: 0L) * 100L
