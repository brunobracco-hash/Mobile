package com.bracco.pdf2word

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.bracco.pdf2word.databinding.ActivityMainBinding
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileInputStream
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var selectedUri: Uri? = null
    private var lastResult: ConversionResult? = null

    private val pickPdf = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) onPdfSelected(uri)
    }

    private val saveDocx =
        registerForActivityResult(ActivityResultContracts.CreateDocument(DOCX_MIME)) { uri ->
            if (uri != null) exportTo(uri)
        }

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.buttonPick.setOnClickListener {
            pickPdf.launch(arrayOf("application/pdf"))
        }
        binding.buttonConvert.setOnClickListener { startConversion() }
        binding.buttonCancel.setOnClickListener { ConversionService.cancel(this) }
        binding.buttonSave.setOnClickListener {
            val result = lastResult ?: return@setOnClickListener
            saveDocx.launch(result.fileName)
        }
        binding.buttonShare.setOnClickListener { shareResult() }
        binding.buttonNew.setOnClickListener {
            ConversionState.reset()
            lastResult = null
            render(ConversionStatus.Idle)
        }

        askNotificationPermission()
        handleIncomingIntent(intent)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                ConversionState.status.collectLatest { render(it) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    /** Aceita PDFs abertos ou compartilhados por outros apps. */
    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        val uri = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            else -> null
        } ?: return
        onPdfSelected(uri)
    }

    private fun onPdfSelected(uri: Uri) {
        try {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) {
            // Nem todo provedor concede permissao persistente; a leitura imediata continua valendo.
        }
        selectedUri = uri
        binding.textSelected.text = getString(R.string.selected_file, describe(uri))
        binding.buttonConvert.isEnabled = true
    }

    private fun describe(uri: Uri): String {
        var name = uri.lastPathSegment ?: getString(R.string.unknown_file)
        var size = -1L
        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) cursor.getString(nameIndex)?.let { name = it }
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                }
            }
        } catch (e: Throwable) {
            // segue com o nome cru
        }
        return if (size > 0) "$name (${formatSize(size)})" else name
    }

    private fun startConversion() {
        val uri = selectedUri
        if (uri == null) {
            toast(getString(R.string.pick_first))
            return
        }
        if (ConversionState.isRunning) {
            toast(getString(R.string.already_running))
            return
        }
        lastResult = null
        ConversionState.update(ConversionStatus.Running(ConversionStatus.Phase.COPYING))
        ConversionService.start(this, uri, currentOptions())
    }

    private fun currentOptions() = ConversionOptions(
        forceOcr = binding.switchForceOcr.isChecked,
        joinLines = binding.switchJoinLines.isChecked,
        pageBreaks = binding.switchPageBreaks.isChecked,
        pageMarkers = binding.switchPageMarkers.isChecked,
        ocrDpi = when (binding.radioDpi.checkedRadioButtonId) {
            R.id.dpi_low -> 150
            R.id.dpi_high -> 300
            else -> 200
        }
    )

    private fun render(status: ConversionStatus) {
        when (status) {
            is ConversionStatus.Idle -> {
                binding.groupProgress.visibility = View.GONE
                binding.groupResult.visibility = View.GONE
                binding.cardOptions.visibility = View.VISIBLE
                binding.buttonConvert.visibility = View.VISIBLE
                binding.buttonConvert.isEnabled = selectedUri != null
            }

            is ConversionStatus.Running -> {
                binding.groupProgress.visibility = View.VISIBLE
                binding.groupResult.visibility = View.GONE
                binding.cardOptions.visibility = View.GONE
                binding.buttonConvert.visibility = View.GONE
                binding.textProgress.text = when (status.phase) {
                    ConversionStatus.Phase.COPYING -> getString(R.string.phase_copying)
                    ConversionStatus.Phase.ANALYZING -> getString(R.string.phase_analyzing)
                    ConversionStatus.Phase.WRITING -> getString(R.string.phase_writing)
                    ConversionStatus.Phase.CONVERTING ->
                        if (status.total > 0) {
                            getString(R.string.phase_page, status.page, status.total)
                        } else {
                            getString(R.string.phase_analyzing)
                        }
                }
                binding.textProgressDetail.text =
                    if (status.ocrPages > 0) getString(R.string.ocr_pages, status.ocrPages) else ""
                if (status.total > 0 && status.page > 0) {
                    binding.progress.isIndeterminate = false
                    binding.progress.max = status.total
                    binding.progress.setProgressCompat(status.page, true)
                } else {
                    binding.progress.isIndeterminate = true
                }
            }

            is ConversionStatus.Done -> {
                lastResult = status.result
                binding.groupProgress.visibility = View.GONE
                binding.cardOptions.visibility = View.GONE
                binding.buttonConvert.visibility = View.GONE
                binding.groupResult.visibility = View.VISIBLE
                binding.textResultTitle.text = getString(R.string.result_title)
                binding.textResult.text = getString(
                    R.string.result_details,
                    status.result.fileName,
                    formatSize(status.result.sizeBytes),
                    status.result.pages,
                    status.result.ocrPages,
                    status.result.paragraphs,
                    formatDuration(status.result.elapsedMs)
                )
            }

            is ConversionStatus.Failed -> {
                binding.groupProgress.visibility = View.GONE
                binding.groupResult.visibility = View.VISIBLE
                binding.cardOptions.visibility = View.VISIBLE
                binding.buttonConvert.visibility = View.VISIBLE
                binding.buttonConvert.isEnabled = selectedUri != null
                binding.textResultTitle.text = getString(R.string.result_failed)
                binding.textResult.text = status.message
                binding.buttonSave.visibility = View.GONE
                binding.buttonShare.visibility = View.GONE
            }

            is ConversionStatus.Cancelled -> {
                binding.groupProgress.visibility = View.GONE
                binding.groupResult.visibility = View.GONE
                binding.cardOptions.visibility = View.VISIBLE
                binding.buttonConvert.visibility = View.VISIBLE
                binding.buttonConvert.isEnabled = selectedUri != null
                toast(getString(R.string.cancelled))
            }
        }

        if (status is ConversionStatus.Done) {
            binding.buttonSave.visibility = View.VISIBLE
            binding.buttonShare.visibility = View.VISIBLE
        }
    }

    private fun exportTo(target: Uri) {
        val result = lastResult ?: return
        try {
            val source = File(result.outputPath)
            contentResolver.openOutputStream(target)?.use { output ->
                FileInputStream(source).use { input ->
                    input.copyTo(output, 1 shl 16)
                }
            } ?: throw IllegalStateException(getString(R.string.error_cannot_write_file))
            toast(getString(R.string.saved))
        } catch (e: Throwable) {
            toast(getString(R.string.error_io, e.message ?: ""))
        }
    }

    private fun shareResult() {
        val result = lastResult ?: return
        try {
            val uri = FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                File(result.outputPath)
            )
            val share = Intent(Intent.ACTION_SEND)
                .setType(DOCX_MIME)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, result.fileName)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(Intent.createChooser(share, getString(R.string.share_with)))
        } catch (e: Throwable) {
            toast(getString(R.string.error_io, e.message ?: ""))
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun formatSize(bytes: Long): String = when {
        bytes >= 1024L * 1024L -> String.format(Locale.getDefault(), "%.1f MB", bytes / 1048576.0)
        bytes >= 1024L -> String.format(Locale.getDefault(), "%.0f KB", bytes / 1024.0)
        else -> "$bytes B"
    }

    private fun formatDuration(millis: Long): String {
        val totalSeconds = millis / 1000
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return if (minutes > 0) "${minutes}min ${seconds}s" else "${seconds}s"
    }

    companion object {
        private const val DOCX_MIME =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
}
