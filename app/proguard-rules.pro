# O app roda sem minificacao (isMinifyEnabled = false), entao este arquivo
# existe apenas para satisfazer a configuracao do Gradle. Se um dia a
# minificacao for ligada, as regras do kotlinx.serialization entram aqui.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
