package com.bracco.gastos.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Um lancamento de gasto. O valor e sempre guardado em centavos (Long) para
 * nunca sofrer erro de arredondamento de ponto flutuante.
 */
@Serializable
data class Expense(
    val id: String,
    @SerialName("amount_cents") val amountCents: Long,
    val description: String = "",
    @SerialName("created_at") val createdAt: String,
    @SerialName("created_by") val createdBy: String = "",
)

/** Corpo enviado ao criar um lancamento (sem campos que o banco preenche). */
@Serializable
data class NewExpense(
    val id: String,
    @SerialName("amount_cents") val amountCents: Long,
    val description: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("created_by") val createdBy: String,
)

/** Estado local de um lancamento: ja sincronizado ou ainda na fila. */
@Serializable
data class StoredExpense(
    val expense: Expense,
    val pending: Boolean = false,
    val pendingDelete: Boolean = false,
)

@Serializable
data class Session(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long = 3600,
    val user: SessionUser? = null,
)

@Serializable
data class SessionUser(
    val id: String,
    val email: String = "",
)

@Serializable
data class PasswordGrant(
    val email: String,
    val password: String,
)

@Serializable
data class RefreshGrant(
    @SerialName("refresh_token") val refreshToken: String,
)

@Serializable
data class DeleteFlag(
    val deleted: Boolean = true,
)

class SupabaseException(message: String, val status: Int = 0) : Exception(message)
