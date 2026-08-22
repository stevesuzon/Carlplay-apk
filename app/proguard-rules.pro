# Garde uniquement l'interface JavaScript indispensable au WebView.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.stevesuzon.carlplay.MainActivity$AndroidStatus { *; }

# Renforcement R8 : noms de classes/methodes moins lisibles dans un APK decompile.
-allowaccessmodification
-repackageclasses 'a'
-adaptclassstrings
-renamesourcefileattribute SourceFile
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
