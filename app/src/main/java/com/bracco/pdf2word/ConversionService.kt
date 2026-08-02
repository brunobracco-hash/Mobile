package com.bracco.pdf2word

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.OpenableColumns
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.IntentCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Roda a conversao em primeiro plano (com notificacao) para que PDFs grandes
 * continuem sendo processados mesmo com a tela desligada ou o app em segundo plano.
 */
class ConversionService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private var lastNotificationAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            job?.cancel()
            return START_NOT_STICKY
        }

        val uri = intent?.let { IntentCompat.getParcelableExtra(it, EXTRA_URI, Uri::class.java) }
        if (uri == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (job?.isActive == true) {
            return START_NOT_STICKY
        }

        val options = ConversionOptions.readFrom(intent)
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(getString(R.string.notif_preparing), 0, 0, true),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            }
        )

        job = scope.launch { runConversion(uri, options) }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        job?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun runConversion(uri: Uri, options: ConversionOptions) {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pdf2word:conversion")
        wakeLock.setReferenceCounted(false)
        wakeLock.acquire(MAX_WAKELOCK_MS)

        val workDir = File(cacheDir, "work").apply { mkdirs() }
        val inputFile = File(workDir, "input.pdf")
        val outputDir = File(filesDir, "out").apply { mkdirs() }

        try {
            outputDir.listFiles()?.forEach { it.delete() }

            val displayName = resolveDisplayName(uri)
            val baseName = sanitizeFileName(displayName.substringBeforeLast('.', displayName))
            val output = File(outputDir, "$baseName.docx")

            ConversionState.update(ConversionStatus.Running(ConversionStatus.Phase.COPYING))
            notify(getString(R.string.notif_reading), 0, 0, true)
            copyToCache(uri, inputFile)

            ConversionState.update(ConversionStatus.Running(ConversionStatus.Phase.ANALYZING))
            notify(getString(R.string.notif_analyzing), 0, 0, true)

            val converter = PdfToDocxConverter(applicationContext, options) { page, total, ocrPages ->
                ConversionState.update(
                    ConversionStatus.Running(
                        phase = ConversionStatus.Phase.CONVERTING,
                        page = page,
                        total = total,
                        ocrPages = ocrPages
                    )
                )
                maybeNotifyProgress(page, total)
            }

            val result = converter.convert(inputFile, output, baseName)
            ConversionState.update(ConversionStatus.Done(result))
            notifyFinished(
                getString(R.string.notif_done_title),
                getString(R.string.notif_done_text, result.fileName, result.pages)
            )
        } catch (e: CancellationException) {
            ConversionState.update(ConversionStatus.Cancelled)
            cancelFinalNotification()
        } catch (e: Throwable) {
            Log.e(TAG, "Falha na conversao", e)
            val message = when (e) {
                is PdfToDocxConverter.ConversionException -> e.message
                is IOException -> getString(R.string.error_io, e.message ?: "")
                is OutOfMemoryError -> getString(R.string.error_memory)
                else -> e.message
            } ?: getString(R.string.error_generic)
            ConversionState.update(ConversionStatus.Failed(message))
            notifyFinished(getString(R.string.notif_failed_title), message)
        } finally {
            inputFile.delete()
            try {
                if (wakeLock.isHeld) wakeLock.release()
            } catch (e: Throwable) {
                Log.w(TAG, "wakelock: ${e.message}")
            }
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    /**
     * Copia o PDF escolhido para o cache do app em blocos.
     * Nao ha limite de tamanho: nada e carregado inteiro na memoria.
     */
    private suspend fun copyToCache(uri: Uri, destination: File) {
        val input = contentResolver.openInputStream(uri)
            ?: throw ConversionException(getString(R.string.error_cannot_read_file))
        input.use { source ->
            FileOutputStream(destination).use { sink ->
                val buffer = ByteArray(1 shl 16)
                var copied = 0L
                while (true) {
                    val read = source.read(buffer)
                    if (read <= 0) break
                    sink.write(buffer, 0, read)
                    copied += read
                    if (copied % (8L shl 20) < buffer.size.toLong()) {
                        currentCoroutineContext().ensureActive()
                    }
                }
                sink.flush()
                sink.fd.sync()
            }
        }
        if (destination.length() == 0L) {
            throw ConversionException(getString(R.string.error_empty_file))
        }
    }

    private class ConversionException(message: String) : Exception(message)

    private fun resolveDisplayName(uri: Uri): String {
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (index >= 0) {
                            val name = cursor.getString(index)
                            if (!name.isNullOrBlank()) return name
                        }
                    }
                }
        } catch (e: Throwable) {
            Log.w(TAG, "display name: ${e.message}")
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "documento"
    }

    private fun sanitizeFileName(name: String): String {
        val cleaned = name.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1F]"), "_").trim()
        val trimmed = if (cleaned.length > 80) cleaned.substring(0, 80) else cleaned
        return trimmed.ifBlank { "documento" }
    }

    // ---------- notificacoes ----------

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel_name),
            NotificationManager.IMPORTANCE_LOW
        )
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(
        text: String,
        progress: Int,
        max: Int,
        indeterminate: Boolean
    ): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val cancelIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ConversionService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(max, progress, indeterminate)
            .setContentIntent(contentIntent)
            .addAction(0, getString(R.string.action_cancel), cancelIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun notify(text: String, progress: Int, max: Int, indeterminate: Boolean) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        try {
            manager.notify(NOTIFICATION_ID, buildNotification(text, progress, max, indeterminate))
        } catch (e: SecurityException) {
            Log.w(TAG, "sem permissao de notificacao: ${e.message}")
        }
    }

    private fun maybeNotifyProgress(page: Int, total: Int) {
        val now = System.currentTimeMillis()
        if (now - lastNotificationAt < NOTIFICATION_INTERVAL_MS && page != total) return
        lastNotificationAt = now
        notify(getString(R.string.notif_page, page, total), page, total, total <= 0)
    }

    private fun notifyFinished(title: String, text: String) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(R.drawable.ic_notification)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()
        try {
            manager.notify(RESULT_NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "sem permissao de notificacao: ${e.message}")
        }
    }

    private fun cancelFinalNotification() {
        getSystemService(NotificationManager::class.java)?.cancel(RESULT_NOTIFICATION_ID)
    }

    companion object {
        private const val TAG = "ConversionService"
        private const val CHANNEL_ID = "conversion"
        private const val NOTIFICATION_ID = 1001
        private const val RESULT_NOTIFICATION_ID = 1002
        private const val NOTIFICATION_INTERVAL_MS = 700L
        private const val MAX_WAKELOCK_MS = 6L * 60L * 60L * 1000L

        const val ACTION_CANCEL = "com.bracco.pdf2word.CANCEL"
        private const val EXTRA_URI = "pdf_uri"

        fun start(context: Context, uri: Uri, options: ConversionOptions) {
            val intent = Intent(context, ConversionService::class.java)
                .putExtra(EXTRA_URI, uri)
            options.writeTo(intent)
            context.startForegroundService(intent)
        }

        fun cancel(context: Context) {
            context.startService(
                Intent(context, ConversionService::class.java).setAction(ACTION_CANCEL)
            )
        }
    }
}
