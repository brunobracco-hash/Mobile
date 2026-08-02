plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bracco.pdf2word"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.bracco.pdf2word"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        resourceConfigurations += listOf("pt", "pt-rBR", "en")
    }

    signingConfigs {
        create("app") {
            storeFile = file(providers.gradleProperty("P2W_STORE_FILE").get())
            storePassword = providers.gradleProperty("P2W_STORE_PASSWORD").get()
            keyAlias = providers.gradleProperty("P2W_KEY_ALIAS").get()
            keyPassword = providers.gradleProperty("P2W_KEY_PASSWORD").get()
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("app")
        }
        release {
            // Desligado de proposito: PDFBox e ML Kit usam bastante reflexao e o
            // ganho de tamanho nao compensa o risco de quebrar a conversao.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("app")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE",
                "META-INF/LICENSE.txt",
                "META-INF/NOTICE",
                "META-INF/NOTICE.txt",
                "META-INF/*.kotlin_module"
            )
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // OCR offline (modelo embarcado no APK, nao precisa de internet)
    implementation("com.google.mlkit:text-recognition:16.0.1")

    // Leitura da camada de texto de PDFs digitais
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
}
