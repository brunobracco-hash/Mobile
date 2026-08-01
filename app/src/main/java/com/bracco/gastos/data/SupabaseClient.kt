package com.bracco.gastos.data

import com.bracco.gastos.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

val json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

/**
 * Cliente minimo para a API REST do Supabase (GoTrue para login,
 * PostgREST para os dados). Nao usamos o SDK oficial de proposito: sao
 * meia duzia de chamadas HTTP e assim o app fica pequeno e previsivel.
 */
class SupabaseClient(
    private val baseUrl: String = BuildConfig.SUPABASE_URL,
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
) {
    val isConfigured: Boolean get() = baseUrl.isNotBlank() && anonKey.isNotBlank()

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun Request.Builder.commonHeaders() = apply {
        header("apikey", anonKey)
        header("Content-Type", "application/json")
    }

    private fun execute(request: Request): String {
        try {
            http.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw SupabaseException(errorMessage(response.code, body), response.code)
                }
                return body
            }
        } catch (e: SupabaseException) {
            throw e
        } catch (e: IOException) {
            throw SupabaseException("sem conexao", 0)
        }
    }

    private fun errorMessage(code: Int, body: String): String {
        // O Supabase devolve {"msg": ...} no auth e {"message": ...} no PostgREST.
        val parsed = runCatching {
            val map = json.parseToJsonElement(body) as? JsonObject
            listOf("msg", "message", "error_description", "error")
                .firstNotNullOfOrNull { key -> (map?.get(key) as? JsonPrimitive)?.content }
        }.getOrNull()
        return parsed ?: "erro HTTP $code"
    }

    // ---------------------------------------------------------------- auth

    suspend fun signIn(email: String, password: String): Session = withContext(Dispatchers.IO) {
        val payload = json.encodeToString(PasswordGrant(email.trim(), password))
        val request = Request.Builder()
            .url("$baseUrl/auth/v1/token?grant_type=password")
            .commonHeaders()
            .post(payload.toRequestBody(JSON_MEDIA))
            .build()
        json.decodeFromString<Session>(execute(request))
    }

    suspend fun refresh(refreshToken: String): Session = withContext(Dispatchers.IO) {
        val payload = json.encodeToString(RefreshGrant(refreshToken))
        val request = Request.Builder()
            .url("$baseUrl/auth/v1/token?grant_type=refresh_token")
            .commonHeaders()
            .post(payload.toRequestBody(JSON_MEDIA))
            .build()
        json.decodeFromString<Session>(execute(request))
    }

    // ---------------------------------------------------------------- dados

    suspend fun listExpenses(accessToken: String): List<Expense> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(
                "$baseUrl/rest/v1/expenses" +
                    "?select=id,amount_cents,description,created_at,created_by" +
                    "&deleted=eq.false&order=created_at.desc&limit=1000"
            )
            .commonHeaders()
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()
        json.decodeFromString<List<Expense>>(execute(request))
    }

    suspend fun insertExpense(accessToken: String, expense: NewExpense) = withContext(Dispatchers.IO) {
        val payload = json.encodeToString(listOf(expense))
        val request = Request.Builder()
            .url("$baseUrl/rest/v1/expenses")
            .commonHeaders()
            .header("Authorization", "Bearer $accessToken")
            .header("Prefer", "return=minimal,resolution=merge-duplicates")
            .post(payload.toRequestBody(JSON_MEDIA))
            .build()
        execute(request)
        Unit
    }

    suspend fun deleteExpense(accessToken: String, id: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/rest/v1/expenses?id=eq.$id")
            .commonHeaders()
            .header("Authorization", "Bearer $accessToken")
            .header("Prefer", "return=minimal")
            .patch(json.encodeToString(DeleteFlag()).toRequestBody(JSON_MEDIA))
            .build()
        execute(request)
        Unit
    }
}
